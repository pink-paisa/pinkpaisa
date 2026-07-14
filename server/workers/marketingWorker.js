const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const connectDB = require("../config/db");
const logger = require("../utils/logger");
const { startMarketingAgentWorker } = require("../services/marketingAgentOrchestrator");
const { startDailyBatchScheduler } = require("../services/dailyBatchScheduler");

async function start() {
  await connectDB();
  startMarketingAgentWorker();
  startDailyBatchScheduler();
  logger.info("dedicated marketing worker ready");
}

async function shutdown(signal) {
  logger.info({ signal }, "marketing worker shutting down");
  await mongoose.connection.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((error) => {
  logger.error({ err: error }, "marketing worker failed to start");
  process.exit(1);
});
