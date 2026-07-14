const crypto = require("crypto");
const AffiliateEvent = require("../models/AffiliateEvent");
const Product = require("../models/Product");
const { getClientIp } = require("../middleware/requestGuards");
const { validateAmazonAffiliateUrl } = require("../services/amazonAffiliateCompliance");

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

function readAttributionFromRequest(req) {
  const direct = req.query || {};
  let referrer = {};
  try {
    const parsed = new URL(String(req.headers.referer || ""));
    referrer = Object.fromEntries(parsed.searchParams.entries());
  } catch {
    referrer = {};
  }
  return {
    utm_source: direct.utm_source || referrer.utm_source,
    utm_medium: direct.utm_medium || referrer.utm_medium,
    utm_campaign: direct.utm_campaign || referrer.utm_campaign,
    utm_content: direct.utm_content || referrer.utm_content,
  };
}

async function persistAffiliateEvent(req, product, eventType, payload = {}) {
  const userAgent = String(req.headers["user-agent"] || "");
  const ipHash = hashValue(getClientIp(req));
  const userAgentHash = hashValue(userAgent);
  const dedupeKey = buildDedupeKey({ eventType, productId: product._id.toString(), ipHash, userAgentHash });
  const duplicate = await AffiliateEvent.findOne({
    dedupe_key: dedupeKey,
    createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
  }).select("_id").lean();
  if (duplicate) return { tracked: false, deduped: true, event: null };

  const event = await AffiliateEvent.create({
    event_type: eventType,
    product_id: product._id,
    asin: product.affiliate_asin || null,
    marketplace: product.affiliate_marketplace || null,
    category: product.category || null,
    campaign_label: normalizeString(payload.campaign_label || product.campaign_label, 120),
    utm_source: normalizeString(payload.utm_source, 120),
    utm_medium: normalizeString(payload.utm_medium, 120),
    utm_campaign: normalizeString(payload.utm_campaign, 160),
    utm_content: normalizeString(payload.utm_content, 160),
    referrer: normalizeString(payload.referrer || req.headers.referer, 500),
    device_type: normalizeString(payload.device_type, 40) || detectDevice(userAgent),
    user_agent_hash: userAgentHash,
    ip_hash: ipHash,
    is_bot: BOT_RE.test(userAgent),
    dedupe_key: dedupeKey,
    experiment_name: normalizeString(payload.experiment_name, 120),
    experiment_variant: normalizeString(payload.experiment_variant, 120),
  });
  return { tracked: true, deduped: false, event };
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

    const result = await persistAffiliateEvent(req, product, eventType, req.body || {});
    res.status(result.tracked ? 201 : 200).json({
      tracked: result.tracked,
      deduped: result.deduped,
      id: result.event?._id?.toString?.() || null,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const redirectAffiliateOutbound = async (req, res) => {
  try {
    const selector = String(req.params.product || "").trim();
    const product = await Product.findOne({
      ...(selector.match(/^[0-9a-fA-F]{24}$/) ? { _id: selector } : { slug: selector }),
      is_affiliate: true,
      affiliate_compliance_status: "compliant",
      status: "active",
      is_visible: true,
      archived_at: null,
    }).lean();
    if (!product) return res.status(404).send("Affiliate product not found");
    const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
      marketplace: product.affiliate_marketplace,
      requireConfiguredTag: true,
    });
    if (!validation.isValid) return res.status(409).send("Affiliate link is under review");
    await persistAffiliateEvent(req, product, "outbound_click", {
      ...readAttributionFromRequest(req),
      referrer: req.headers.referer,
    }).catch(() => null);
    return res.redirect(302, validation.normalizedUrl);
  } catch (err) {
    return res.status(400).send(err.message || "Affiliate redirect failed");
  }
};

module.exports = {
  recordAffiliateEvent,
  redirectAffiliateOutbound,
  _private: {
    buildDedupeKey,
    detectDevice,
    readAttributionFromRequest,
  },
};
