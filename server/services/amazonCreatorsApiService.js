const Product = require("../models/Product");
const AdminSettings = require("../models/AdminSettings");
const logger = require("../utils/logger");
const {
  AFFILIATE_DATA_SETTINGS_KEY,
  buildAffiliateDataSettingsResponse,
  getAffiliateDataSettings,
  getCreatorsApiEnvStatus,
  normalizeMarketplaces,
} = require("../utils/affiliateDataSettings");

const APPROVED_API_SOURCE = "creators_api";
const DEFAULT_REFRESH_BATCH_SIZE = 25;
const DEFAULT_DATA_TTL_HOURS = 24;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRefreshBatchSize() {
  return Math.min(parsePositiveInt(process.env.AMAZON_CREATORS_API_REFRESH_BATCH_SIZE, DEFAULT_REFRESH_BATCH_SIZE), 100);
}

function getDataTtlMs() {
  const hours = parsePositiveInt(process.env.AMAZON_CREATORS_API_DATA_TTL_HOURS || process.env.AMAZON_CREATORS_API_REFRESH_INTERVAL_HOURS, DEFAULT_DATA_TTL_HOURS);
  return hours * 60 * 60 * 1000;
}

function normalizeCurrency(marketplace) {
  return marketplace === "amazon_us" ? "USD" : "INR";
}

function isCreatorsApiAdapterImplemented() {
  return false;
}

function getCreatorsApiDisabledReason({ envStatus, healthOk, adapterImplemented }) {
  if (!adapterImplemented) return "Creators API product refresh is not implemented yet. Keep Manual Only active.";
  if (!envStatus.configured) return `Creators API mode requires configuration: ${envStatus.missing.join(", ")}`;
  if (!healthOk) return "Run a successful Creators API readiness check before enabling Creators API mode.";
  return null;
}

function buildCreatorsApiReadiness({ settings, envStatus = getCreatorsApiEnvStatus() }) {
  const normalizedSettings = buildAffiliateDataSettingsResponse(settings || {});
  const modeEnabled = normalizedSettings.affiliate_data_mode === APPROVED_API_SOURCE;
  const healthOk = normalizedSettings.affiliate_creators_api_health_status === "ok";
  const adapterImplemented = isCreatorsApiAdapterImplemented();
  const disabledReason = getCreatorsApiDisabledReason({ envStatus, healthOk, adapterImplemented });
  const creatorsCanEnable = !disabledReason;
  const currentMode = modeEnabled && creatorsCanEnable ? APPROVED_API_SOURCE : "manual_only";
  const creatorsCanRefresh = currentMode === APPROVED_API_SOURCE;
  const message = creatorsCanRefresh
    ? "Creators API mode is ready"
    : creatorsCanEnable
      ? "Creators API is ready to enable. Manual Only remains active until an admin enables it."
      : disabledReason || "Creators API mode is not ready. Keep Manual Only active.";

  return {
    ready: creatorsCanRefresh,
    current_mode: currentMode,
    manual_available: true,
    creators_adapter_implemented: adapterImplemented,
    creators_env_configured: envStatus.configured,
    creators_health_status: normalizedSettings.affiliate_creators_api_health_status,
    creators_can_enable: creatorsCanEnable,
    creators_can_refresh: creatorsCanRefresh,
    disabled_reason: disabledReason,
    mode_enabled: modeEnabled,
    env_configured: envStatus.configured,
    health_ok: healthOk,
    adapter_implemented: adapterImplemented,
    missing: envStatus.missing,
    message,
  };
}

function buildAffiliateDataModeResponse(settings = {}) {
  const base = buildAffiliateDataSettingsResponse(settings);
  const readiness = buildCreatorsApiReadiness({ settings: base });
  return {
    ...base,
    requested_affiliate_data_mode: base.affiliate_data_mode,
    affiliate_data_mode: readiness.current_mode,
    current_mode: readiness.current_mode,
    manual_available: readiness.manual_available,
    creators_adapter_implemented: readiness.creators_adapter_implemented,
    creators_env_configured: readiness.creators_env_configured,
    creators_health_status: readiness.creators_health_status,
    creators_can_enable: readiness.creators_can_enable,
    creators_can_refresh: readiness.creators_can_refresh,
    disabled_reason: readiness.disabled_reason,
    creators_api_ready: readiness.creators_can_refresh,
    creators_api_readiness: readiness,
  };
}

async function persistHealthCheck(result) {
  const settings = await AdminSettings.findOneAndUpdate(
    { key: AFFILIATE_DATA_SETTINGS_KEY },
    {
      $set: {
        affiliate_creators_api_last_health_check_at: new Date(),
        affiliate_creators_api_health_status: result.ok ? "ok" : "failed",
        affiliate_creators_api_last_error: result.ok ? null : result.message,
      },
    },
    { new: true, upsert: true, lean: true }
  );
  return buildAffiliateDataModeResponse(settings);
}

async function runCreatorsApiHealthCheck() {
  const envStatus = getCreatorsApiEnvStatus();
  const result = !envStatus.configured
    ? {
      ok: false,
      status: "not_configured",
      message: `Missing Creators API configuration: ${envStatus.missing.join(", ")}`,
    }
    : !isCreatorsApiAdapterImplemented()
      ? {
        ok: false,
        status: "not_implemented",
        message: "Creators API product refresh is not implemented yet. Keep affiliate data mode on manual only.",
      }
      : {
        ok: true,
        status: "configuration_ready",
        message: "Creators API credentials are configured.",
      };

  const settings = await persistHealthCheck(result);
  return { ...result, settings };
}

async function fetchCreatorsApiProductData() {
  return {
    ok: false,
    status: "not_implemented",
    message: "Creators API product refresh is not implemented until approved API access and official endpoint details are available.",
  };
}

function normalizeCreatorsApiProductData(apiData = {}, product = {}, now = new Date()) {
  const ttlMs = getDataTtlMs();
  const expiresAt = apiData.expires_at ? new Date(apiData.expires_at) : new Date(now.getTime() + ttlMs);
  const imageUrl = String(apiData.image_url || apiData.featured_image || "").trim() || null;
  const price = Number(apiData.price || 0);
  const salePrice = apiData.sale_price == null || apiData.sale_price === "" ? null : Number(apiData.sale_price);
  const normalizedSalePrice = Number.isFinite(salePrice) && salePrice >= 0 ? salePrice : null;
  const normalizedPrice = Number.isFinite(price) && price >= 0 ? price : 0;

  return {
    title: String(apiData.title || product.title || "").trim() || product.title,
    image_url: imageUrl,
    price: normalizedPrice,
    sale_price: normalizedSalePrice,
    effective_price: normalizedSalePrice ?? normalizedPrice,
    mrp: apiData.mrp == null || apiData.mrp === "" ? null : Number(apiData.mrp),
    currency: String(apiData.currency || normalizeCurrency(product.affiliate_marketplace)).trim().toUpperCase(),
    fetched_at: now,
    expires_at: expiresAt,
  };
}

function applyCreatorsApiDataToProduct(product, normalizedData) {
  if (!product || !normalizedData) return product;
  if (normalizedData.image_url) {
    product.featured_image = normalizedData.image_url;
    product.images = [normalizedData.image_url];
    product.image_items = [{ url: normalizedData.image_url, alt: product.title, position: 0 }];
  }
  product.price = normalizedData.price;
  product.sale_price = normalizedData.sale_price;
  product.effective_price = normalizedData.effective_price;
  product.mrp = Number.isFinite(normalizedData.mrp) && normalizedData.mrp >= 0 ? normalizedData.mrp : null;
  product.stock_quantity = 0;
  product.affiliate_data_source = APPROVED_API_SOURCE;
  product.affiliate_data_last_refreshed_at = normalizedData.fetched_at;
  product.affiliate_data_expires_at = normalizedData.expires_at;
  product.affiliate_api_error = null;
  product.attributes = {
    ...(product.attributes && typeof product.attributes === "object" ? product.attributes : {}),
    affiliate_api_currency: normalizedData.currency,
  };
  return product;
}

async function refreshAffiliateProductFromCreatorsApi(productOrId) {
  const product = typeof productOrId === "string"
    ? await Product.findOne({ _id: productOrId, is_affiliate: true, source_type: "admin" })
    : productOrId;

  if (!product) return { ok: false, status: "not_found", message: "Affiliate product not found", product: null };

  const settings = await getAffiliateDataSettings();
  const readiness = buildCreatorsApiReadiness({ settings });
  if (!readiness.ready) {
    product.affiliate_api_error = readiness.message;
    await product.save();
    return { ok: false, status: "not_ready", message: readiness.message, product };
  }

  if (!product.affiliate_asin || !product.affiliate_marketplace) {
    product.affiliate_api_error = "ASIN and marketplace are required before Creators API refresh.";
    await product.save();
    return { ok: false, status: "missing_product_key", message: product.affiliate_api_error, product };
  }

  if (!normalizeMarketplaces(settings.affiliate_data_marketplaces).includes(product.affiliate_marketplace)) {
    product.affiliate_api_error = `Creators API refresh is not enabled for ${product.affiliate_marketplace}.`;
    await product.save();
    return { ok: false, status: "marketplace_disabled", message: product.affiliate_api_error, product };
  }

  const apiResult = await fetchCreatorsApiProductData({
    asin: product.affiliate_asin,
    marketplace: product.affiliate_marketplace,
  });

  if (!apiResult.ok) {
    product.affiliate_api_error = apiResult.message;
    await product.save();
    return { ok: false, status: apiResult.status || "api_error", message: apiResult.message, product };
  }

  applyCreatorsApiDataToProduct(product, normalizeCreatorsApiProductData(apiResult.data, product));
  await product.save();
  return { ok: true, status: "refreshed", message: "Creators API data refreshed", product };
}

async function refreshAffiliateProductsFromCreatorsApi({ productIds = [], limit = getRefreshBatchSize() } = {}) {
  const settings = await getAffiliateDataSettings();
  const readiness = buildCreatorsApiReadiness({ settings });
  if (!readiness.creators_can_refresh) {
    return {
      skipped: true,
      status: "not_ready",
      reason: readiness.disabled_reason || readiness.message,
      message: readiness.disabled_reason || readiness.message,
      requested: 0,
      refreshed: 0,
      failed: 0,
      results: [],
      readiness,
    };
  }

  const filter = {
    is_affiliate: true,
    source_type: "admin",
    affiliate_asin: { $nin: [null, ""] },
    affiliate_marketplace: { $nin: [null, ""] },
  };
  if (Array.isArray(productIds) && productIds.length) {
    filter._id = { $in: productIds };
  } else {
    filter.status = "active";
    filter.affiliate_compliance_status = "compliant";
  }

  const products = await Product.find(filter)
    .sort({ affiliate_data_last_refreshed_at: 1, affiliate_sort_order: 1, createdAt: -1 })
    .limit(limit);

  const results = [];
  for (const product of products) {
    try {
      results.push(await refreshAffiliateProductFromCreatorsApi(product));
    } catch (error) {
      product.affiliate_api_error = error.message || "Creators API refresh failed";
      await product.save();
      logger.error({ err: error, productId: product._id }, "creators api product refresh failed");
      results.push({ ok: false, status: "error", message: product.affiliate_api_error, product });
    }
  }

  return {
    requested: products.length,
    refreshed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

async function runDueCreatorsApiRefresh({ limit = getRefreshBatchSize() } = {}) {
  const settings = await getAffiliateDataSettings();
  const readiness = buildCreatorsApiReadiness({ settings });
  if (!readiness.creators_can_refresh) {
    return { skipped: true, reason: readiness.disabled_reason || readiness.message, requested: 0, refreshed: 0, failed: 0 };
  }
  const summary = await refreshAffiliateProductsFromCreatorsApi({ limit });
  logger.info({ requested: summary.requested, refreshed: summary.refreshed, failed: summary.failed }, "creators api affiliate refresh completed");
  return summary;
}

module.exports = {
  APPROVED_API_SOURCE,
  applyCreatorsApiDataToProduct,
  buildAffiliateDataModeResponse,
  buildCreatorsApiReadiness,
  fetchCreatorsApiProductData,
  isCreatorsApiAdapterImplemented,
  normalizeCreatorsApiProductData,
  refreshAffiliateProductFromCreatorsApi,
  refreshAffiliateProductsFromCreatorsApi,
  runCreatorsApiHealthCheck,
  runDueCreatorsApiRefresh,
  _private: {
    buildCreatorsApiReadiness,
    getDataTtlMs,
    isCreatorsApiAdapterImplemented,
    normalizeCreatorsApiProductData,
  },
};
