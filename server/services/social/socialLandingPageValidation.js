const { validateLandingPage } = require("./socialCompliance");

function allowedLandingHosts(settings = {}) {
  const hosts = new Set(["pinkpaisa.in", "www.pinkpaisa.in"]);
  try {
    hosts.add(new URL(settings.brand_profile?.website_base_url || "https://pinkpaisa.in").hostname.toLowerCase());
  } catch (_error) {
    // The settings validator reports malformed base URLs before this service runs.
  }
  return hosts;
}

function resolvedLandingUrl(value, settings = {}) {
  validateLandingPage(value);
  const base = settings.brand_profile?.website_base_url || "https://pinkpaisa.in";
  const url = new URL(value, base);
  if (url.protocol !== "https:" || !allowedLandingHosts(settings).has(url.hostname.toLowerCase())) {
    const error = new Error("Live landing-page validation is restricted to approved Pink Paisa HTTPS hosts");
    error.code = "social_landing_page_host_not_allowed";
    throw error;
  }
  return url;
}

async function validatePinkPaisaLandingPage(value, { settings = {}, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  if (!value) return { valid: true, skipped: "no_destination" };
  const url = resolvedLandingUrl(value, settings);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs || 8000), 1000), 15000));
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "PinkPaisa-Social-Validator/1.0" } });
    if ([405, 501].includes(response.status)) {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "PinkPaisa-Social-Validator/1.0", Range: "bytes=0-0" } });
    }
    if (response.status >= 200 && response.status < 400) {
      const location = response.headers?.get?.("location");
      if (location) resolvedLandingUrl(location, settings);
      return { valid: true, status: response.status, url: url.toString(), checked_at: new Date().toISOString() };
    }
    const error = new Error(`The recommended landing page returned HTTP ${response.status}`);
    error.code = "social_landing_page_unavailable";
    error.statusCode = 409;
    throw error;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("The recommended landing page health check timed out");
      timeoutError.code = "social_landing_page_timeout";
      timeoutError.statusCode = 409;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { allowedLandingHosts, resolvedLandingUrl, validatePinkPaisaLandingPage };
