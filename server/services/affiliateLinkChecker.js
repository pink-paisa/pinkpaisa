const axios = require("axios");
const { validateAmazonAffiliateUrl } = require("./amazonAffiliateCompliance");

const AUTO_PAUSE_FAILURE_THRESHOLD = 3;
const INDETERMINATE_HTTP_STATUSES = new Set([429, 503]);

function isReachableStatus(status) {
  return status >= 200 && status < 400;
}

async function requestAffiliateUrl(url, method = "head") {
  const response = await axios.request({
    url,
    method,
    maxRedirects: 3,
    timeout: 10000,
    responseType: method === "get" ? "stream" : "json",
    validateStatus: () => true,
    headers: {
      "User-Agent": "PinkPaisaAffiliateLinkChecker/1.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (response.data && typeof response.data.destroy === "function") {
    response.data.destroy();
  }

  return response;
}

async function checkAffiliateProductLink(product) {
  const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
    marketplace: product.affiliate_marketplace,
    requireConfiguredTag: true,
  });

  if (!validation.isValid) {
    return {
      ok: false,
      status: "failed",
      failure_reason: `Compliance validation failed: ${validation.flags.join(", ")}`,
      validation,
    };
  }

  let response;
  try {
    response = await requestAffiliateUrl(validation.normalizedUrl, "head");
    if (response.status === 405 || response.status === 403) {
      response = await requestAffiliateUrl(validation.normalizedUrl, "get");
    }
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      failure_reason: error.message || "Affiliate link request failed",
      validation,
    };
  }

  if (!isReachableStatus(response.status)) {
    if (INDETERMINATE_HTTP_STATUSES.has(response.status)) {
      return {
        ok: false,
        status: "indeterminate",
        retry: true,
        http_status: response.status,
        failure_reason: `Amazon temporarily returned HTTP ${response.status}; retry is required`,
        validation,
      };
    }
    return {
      ok: false,
      status: "failed",
      http_status: response.status,
      failure_reason: `Amazon returned HTTP ${response.status}`,
      validation,
    };
  }

  return {
    ok: true,
    status: "ok",
    http_status: response.status,
    failure_reason: null,
    validation,
  };
}

async function persistAffiliateLinkCheck(product, result) {
  const now = new Date();
  product.affiliate_link_last_checked_at = now;
  product.affiliate_link_check_status = result.status || (result.ok ? "ok" : "failed");
  product.affiliate_link_failure_reason = result.failure_reason || null;

  if (result.ok) {
    product.affiliate_link_failure_count = 0;
  } else if (result.status === "indeterminate") {
    // Amazon throttling or temporary unavailability is not evidence that a
    // product link is permanently broken. Keep its failure count unchanged so
    // a transient response can never auto-pause a sellable product.
  } else {
    product.affiliate_link_failure_count = Number(product.affiliate_link_failure_count || 0) + 1;
    if (product.affiliate_link_failure_count >= AUTO_PAUSE_FAILURE_THRESHOLD) {
      product.status = "inactive";
      product.is_visible = false;
      product.affiliate_compliance_status = "paused";
      product.affiliate_link_check_status = "paused";
      product.affiliate_compliance_flags = Array.from(new Set([
        ...(product.affiliate_compliance_flags || []),
        "link_check_failed",
      ]));
    }
  }

  await product.save();
  return product;
}

module.exports = {
  AUTO_PAUSE_FAILURE_THRESHOLD,
  INDETERMINATE_HTTP_STATUSES,
  checkAffiliateProductLink,
  persistAffiliateLinkCheck,
};
