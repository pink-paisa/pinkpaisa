const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const mongoose = require("mongoose");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { seedVendorDemoData } = require("./utils/vendorSeed");
const { seedCommerceData } = require("./utils/commerceSeed");
const { seedCategoryTree } = require("./utils/categorySeed");
const { startMarketingAgentWorker } = require("./services/marketingAgentOrchestrator");
const { startDailyBatchScheduler } = require("./services/dailyBatchScheduler");
const { createCorsOptions, createRateLimiter, securityHeaders } = require("./middleware/requestGuards");
const { csrfProtection } = require("./middleware/csrf");
const { assertEmailConfigForProduction } = require("./utils/email");

const app = express();
const PORT = process.env.PORT || 5000;
const shouldBootstrapSeedData =
  process.env.NODE_ENV !== "production" || String(process.env.ALLOW_BOOTSTRAP_SEEDING || "").toLowerCase() === "true";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  const startedAt = Date.now();
  req.id = requestId;
  req.log = logger.child({ reqId: requestId, method: req.method, path: req.originalUrl });
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    req.log.info(
      {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "request completed"
    );
  });

  next();
});

app.use(securityHeaders);
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const authLimiter = createRateLimiter({
  keyPrefix: "auth",
  max: 20,
  message: "Too many authentication requests. Please wait a bit and try again.",
});
const paymentLimiter = createRateLimiter({
  keyPrefix: "phonepe",
  max: 25,
  message: "Too many payment requests. Please wait a bit and try again.",
});
const affiliateEventLimiter = createRateLimiter({
  keyPrefix: "affiliate-events",
  max: 120,
  message: "Too many affiliate tracking requests. Please wait a bit and try again.",
});
const adminWriteLimiter = createRateLimiter({
  keyPrefix: "admin-write",
  max: 120,
  message: "Too many admin requests. Please wait a bit and try again.",
});
const uploadLimiter = createRateLimiter({
  keyPrefix: "uploads",
  max: 40,
  message: "Too many upload requests. Please wait a bit and try again.",
});
const instagramLimiter = createRateLimiter({
  keyPrefix: "instagram",
  max: 80,
  message: "Too many Instagram requests. Please wait a bit and try again.",
});

app.use("/api/auth", authLimiter, require("./routes/auth"));
app.use(csrfProtection);
app.use("/api/account", require("./routes/account"));
app.use("/api/users", require("./routes/users"));
app.use("/api/wishlist", require("./routes/wishlist"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/delivery-partners", require("./routes/deliveryPartners"));
app.use("/api/blogs", require("./routes/blogs"));
app.use("/api/workshops", require("./routes/workshops"));
app.use("/api/products", require("./routes/products"));
app.use("/api/affiliate-products", adminWriteLimiter, require("./routes/affiliateProducts"));
app.use("/api/affiliate-events", affiliateEventLimiter, require("./routes/affiliateEvents"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/virtual-products", require("./routes/virtualProducts"));
app.use("/api/pink-pages", require("./routes/pinkPages"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/settlements", require("./routes/settlements"));
app.use("/api/workshop-bookings", require("./routes/workshopBookings"));
app.use("/api/polls", require("./routes/polls"));
app.use("/api/poll-votes", require("./routes/polls"));
app.use("/api/poll-comments", require("./routes/polls"));
app.use("/api/quote-requests", require("./routes/quoteRequests"));
app.use("/api/phonepe", paymentLimiter, require("./routes/phonepe"));
app.use("/api/uploads", uploadLimiter, require("./routes/uploads"));
app.use("/api/vendors", require("./routes/vendors"));
app.use("/api/admin/analytics", require("./routes/adminAnalytics"));
app.use("/api/admin/amazon-reports", adminWriteLimiter, require("./routes/adminAmazonReports"));
app.use("/api/admin/backups", adminWriteLimiter, require("./routes/adminBackups"));
app.use("/api/admin", adminWriteLimiter, require("./routes/adminSettings"));
app.use("/api/vendor-products", require("./routes/vendorProducts"));
app.use("/api/vendor-orders", require("./routes/vendorOrders"));
app.use("/api/marketing-campaigns", adminWriteLimiter, require("./routes/marketingCampaigns"));
app.use("/api/instagram", instagramLimiter, require("./routes/instagram"));

app.get("/api/health", (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? "ok" : "degraded",
    db: dbStatusMap[dbState] || "unknown",
    uptime_seconds: Math.round(process.uptime()),
    version: require("./package.json").version,
  });
});
app.use((_req, res) => res.status(404).json({ message: "Route not found" }));
app.use((err, req, res, _next) => {
  (req?.log || logger).error({ err }, "request failed");
  res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
});

async function bootstrapApplication() {
  assertEmailConfigForProduction();
  await connectDB();

  if (shouldBootstrapSeedData) {
    await seedVendorDemoData().catch((err) => logger.error({ err }, "vendor seed failed"));
    await seedCommerceData().catch((err) => logger.error({ err }, "commerce seed failed"));
    await seedCategoryTree().catch((err) => logger.error({ err }, "category seed failed"));
  } else {
    logger.info("bootstrap seeding skipped");
  }

  startMarketingAgentWorker();
  startDailyBatchScheduler();

  const server = app.listen(PORT, () => logger.info({ port: PORT }, "server listening"));

  const shutdown = async (signal) => {
    logger.info({ signal }, "shutting down");

    await new Promise((resolve) => {
      server.close(() => {
        logger.info("http server closed");
        resolve();
      });
    });

    await mongoose.connection.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

bootstrapApplication().catch((err) => {
  logger.error({ err }, "server bootstrap failed");
  process.exit(1);
});
