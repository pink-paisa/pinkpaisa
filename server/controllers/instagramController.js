const crypto = require("crypto");
const {
  createInstagramConnectStart,
  disconnectInstagramConnection,
  getInstagramConnectionSummary,
} = require("../services/instagramConnectionService");
const { exchangeAuthCodeForToken } = require("../services/instagramPublishService");
const { ingestCommunityEvents } = require("../services/social/socialGrowthTeamService");

function getFrontendAdminUrl(status, message = "") {
  const rawBaseUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:8080").trim();
  const params = new URLSearchParams();
  if (status) params.set("instagram", status);
  if (message) params.set("message", message);

  try {
    const url = new URL(rawBaseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.endsWith("/admin") ? pathname : `${pathname || ""}/admin`;
    url.search = params.toString();
    url.hash = "";
    return url.toString();
  } catch (_error) {
    const fallbackBase = rawBaseUrl.replace(/\/+$/, "");
    const adminBase = fallbackBase.endsWith("/admin") ? fallbackBase : `${fallbackBase}/admin`;
    return `${adminBase}?${params.toString()}`;
  }
}

const getInstagramConnectionController = async (_req, res) => {
  try {
    const connection = await getInstagramConnectionSummary();
    res.json(connection);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const startInstagramConnectController = async (req, res) => {
  try {
    const result = await createInstagramConnectStart({ actor: req.user });
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const instagramConnectCallbackController = async (req, res) => {
  try {
    if (req.query.error) {
      return res.redirect(getFrontendAdminUrl("error", req.query.error_description || req.query.error));
    }
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code || !state) {
      return res.redirect(getFrontendAdminUrl("error", "Missing Instagram callback code or state"));
    }
    await exchangeAuthCodeForToken({ code, state });
    return res.redirect(getFrontendAdminUrl("connected", "Instagram connected successfully"));
  } catch (error) {
    return res.redirect(getFrontendAdminUrl("error", error.message));
  }
};

const disconnectInstagramController = async (_req, res) => {
  try {
    const connection = await disconnectInstagramConnection();
    res.json({ message: "Instagram connection removed", connection });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const verifyInstagramWebhookController = (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const suppliedToken = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const configuredToken = String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "");
  if (!configuredToken || mode !== "subscribe" || !suppliedToken || !challenge) {
    return res.status(403).json({ message: "Instagram webhook verification failed" });
  }
  const supplied = Buffer.from(suppliedToken);
  const configured = Buffer.from(configuredToken);
  if (supplied.length !== configured.length || !crypto.timingSafeEqual(supplied, configured)) {
    return res.status(403).json({ message: "Instagram webhook verification failed" });
  }
  return res.status(200).type("text/plain").send(challenge);
};

const receiveInstagramWebhookController = async (req, res) => {
  try {
    const instagramGrowthService = require("../services/instagramGrowthService");
    const appSecret = String(process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "").trim();
    if (!appSecret) {
      return res.status(503).json({ message: "Meta webhook signature verification is not configured" });
    }
    const signature = String(req.headers["x-hub-signature-256"] || "");
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from("");
    if (!rawBody.length || !instagramGrowthService.verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      return res.status(401).json({ message: "Meta webhook signature is invalid" });
    }
    const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const deliveryId = String(req.headers["x-hub-delivery"] || req.headers["x-request-id"] || "").trim() || null;
    const events = instagramGrowthService.normalizeMetaWebhookEvents(req.body || {}).map((event) => ({
      ...event,
      webhook_signature_verified: true,
      event_payload_hash: payloadHash,
      webhook_delivery_id: deliveryId,
    }));
    const accepted = await ingestCommunityEvents(events);
    return res.status(200).json({ received: true, accepted: accepted.length });
  } catch (error) {
    (req.log || console).error({ err: error }, "Meta webhook ingestion failed");
    return res.status(error.statusCode || 500).json({ message: "Meta webhook ingestion failed" });
  }
};

module.exports = {
  disconnectInstagramController,
  getInstagramConnectionController,
  instagramConnectCallbackController,
  startInstagramConnectController,
  receiveInstagramWebhookController,
  verifyInstagramWebhookController,
};
