const AdminSettings = require("../models/AdminSettings");

const AFFILIATE_DATA_SETTINGS_KEY = "affiliate-data";
const AFFILIATE_DATA_MODES = new Set(["manual_only", "creators_api"]);
const AFFILIATE_MARKETPLACES = new Set(["amazon_in", "amazon_us"]);

const DEFAULT_AFFILIATE_DATA_SETTINGS = {
  affiliate_data_mode: "manual_only",
  affiliate_data_marketplaces: ["amazon_in"],
  affiliate_creators_api_last_health_check_at: null,
  affiliate_creators_api_health_status: "unchecked",
  affiliate_creators_api_last_error: null,
};

function parseBoolean(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function normalizeMarketplaces(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((entry) => entry.trim());

  const marketplaces = list
    .map((entry) => String(entry || "").trim().toLowerCase().replace(/[.\s-]+/g, "_"))
    .map((entry) => {
      if (["amazon_in", "in", "india", "amazonindia"].includes(entry)) return "amazon_in";
      if (["amazon_us", "amazon_com", "us", "usa", "united_states", "amazon"].includes(entry)) return "amazon_us";
      return entry;
    })
    .filter((entry) => AFFILIATE_MARKETPLACES.has(entry));

  return [...new Set(marketplaces)].length ? [...new Set(marketplaces)] : ["amazon_in"];
}

function normalizeAffiliateDataSettings(settings = {}) {
  const mode = AFFILIATE_DATA_MODES.has(String(settings.affiliate_data_mode || ""))
    ? String(settings.affiliate_data_mode)
    : DEFAULT_AFFILIATE_DATA_SETTINGS.affiliate_data_mode;

  const healthStatus = ["unchecked", "ok", "failed"].includes(String(settings.affiliate_creators_api_health_status || ""))
    ? String(settings.affiliate_creators_api_health_status)
    : DEFAULT_AFFILIATE_DATA_SETTINGS.affiliate_creators_api_health_status;

  return {
    affiliate_data_mode: mode,
    affiliate_data_marketplaces: normalizeMarketplaces(settings.affiliate_data_marketplaces),
    affiliate_creators_api_last_health_check_at: settings.affiliate_creators_api_last_health_check_at || null,
    affiliate_creators_api_health_status: healthStatus,
    affiliate_creators_api_last_error: settings.affiliate_creators_api_last_error || null,
  };
}

function getCreatorsApiEnvStatus(env = process.env) {
  const enabled = parseBoolean(env.AMAZON_CREATORS_API_ENABLED, false);
  const accessKey = String(env.AMAZON_CREATORS_API_ACCESS_KEY || "").trim();
  const secretKey = String(env.AMAZON_CREATORS_API_SECRET_KEY || "").trim();
  const marketplaces = normalizeMarketplaces(env.AMAZON_CREATORS_API_MARKETPLACES || "amazon_in");
  const missing = [];

  if (!enabled) missing.push("AMAZON_CREATORS_API_ENABLED=true");
  if (!accessKey) missing.push("AMAZON_CREATORS_API_ACCESS_KEY");
  if (!secretKey) missing.push("AMAZON_CREATORS_API_SECRET_KEY");

  return {
    enabled,
    configured: enabled && !missing.length,
    missing,
    marketplaces,
  };
}

function buildAffiliateDataSettingsResponse(settings = {}) {
  const normalized = normalizeAffiliateDataSettings(settings);
  const creators_api_env = getCreatorsApiEnvStatus();
  return {
    ...normalized,
    creators_api_env,
    creators_api_ready: creators_api_env.configured
      && normalized.affiliate_creators_api_health_status === "ok",
  };
}

async function getAffiliateDataSettings() {
  let settings = await AdminSettings.findOne({ key: AFFILIATE_DATA_SETTINGS_KEY }).lean();
  if (!settings) {
    settings = await AdminSettings.create({ key: AFFILIATE_DATA_SETTINGS_KEY });
    settings = settings.toObject();
  }
  return buildAffiliateDataSettingsResponse(settings);
}

module.exports = {
  AFFILIATE_DATA_SETTINGS_KEY,
  DEFAULT_AFFILIATE_DATA_SETTINGS,
  buildAffiliateDataSettingsResponse,
  getAffiliateDataSettings,
  getCreatorsApiEnvStatus,
  normalizeAffiliateDataSettings,
  normalizeMarketplaces,
};
