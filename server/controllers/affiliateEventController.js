const crypto = require("crypto");
const AffiliateEvent = require("../models/AffiliateEvent");
const Product = require("../models/Product");
const { getClientIp } = require("../middleware/requestGuards");

const EVENT_TYPES = new Set(["product_view", "cta_click", "outbound_click"]);
const DEDUPE_WINDOW_MS = 30 * 1000;
const BOT_RE = /(bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegrambot|slurp|bingpreview|headless|lighthouse)/i;

function hashValue(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeString(value, max = 240) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function detectDevice(userAgent = "") {
  const ua = String(userAgent).toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  if (ua) return "desktop";
  return "unknown";
}

function buildDedupeKey({ eventType, productId, ipHash, userAgentHash }) {
  const bucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  return hashValue([eventType, productId || "unknown", ipHash || "unknown", userAgentHash || "unknown", bucket].join(":"));
}

const recordAffiliateEvent = async (req, res) => {
  try {
    const eventType = normalizeString(req.body.event_type, 40);
    if (!EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ message: "Invalid affiliate event type" });
    }

    const productId = normalizeString(req.body.product_id || req.body.productId, 80);
    let product = null;
    if (productId?.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findOne({
        _id: productId,
        is_affiliate: true,
        affiliate_compliance_status: "compliant",
        status: "active",
        is_visible: true,
      }).lean();
    }
    if (!product) return res.status(404).json({ message: "Affiliate product not found" });

    const userAgent = String(req.headers["user-agent"] || "");
    const ipHash = hashValue(getClientIp(req));
    const userAgentHash = hashValue(userAgent);
    const dedupeKey = buildDedupeKey({ eventType, productId: product._id.toString(), ipHash, userAgentHash });
    const duplicate = await AffiliateEvent.findOne({
      dedupe_key: dedupeKey,
      createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
    }).select("_id").lean();

    if (duplicate) {
      return res.json({ tracked: false, deduped: true });
    }

    const event = await AffiliateEvent.create({
      event_type: eventType,
      product_id: product._id,
      asin: product.affiliate_asin || null,
      marketplace: product.affiliate_marketplace || null,
      category: product.category || null,
      campaign_label: normalizeString(req.body.campaign_label || product.campaign_label, 120),
      utm_source: normalizeString(req.body.utm_source, 120),
      utm_medium: normalizeString(req.body.utm_medium, 120),
      utm_campaign: normalizeString(req.body.utm_campaign, 160),
      utm_content: normalizeString(req.body.utm_content, 160),
      referrer: normalizeString(req.body.referrer || req.headers.referer, 500),
      device_type: normalizeString(req.body.device_type, 40) || detectDevice(userAgent),
      user_agent_hash: userAgentHash,
      ip_hash: ipHash,
      is_bot: BOT_RE.test(userAgent),
      dedupe_key: dedupeKey,
      experiment_name: normalizeString(req.body.experiment_name, 120),
      experiment_variant: normalizeString(req.body.experiment_variant, 120),
    });

    res.status(201).json({ tracked: true, deduped: false, id: event._id.toString() });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  recordAffiliateEvent,
  _private: {
    buildDedupeKey,
    detectDevice,
  },
};
