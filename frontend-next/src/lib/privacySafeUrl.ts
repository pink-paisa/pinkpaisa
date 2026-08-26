const ANALYTICS_QUERY_ALLOWLIST = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
] as const;

const ANALYTICS_QUERY_ALLOWLIST_SET = new Set<string>(ANALYTICS_QUERY_ALLOWLIST);
const BLOCKED_ANALYTICS_PREFIXES = ["/admin", "/vendor", "/account", "/auth"];
const RESET_PASSWORD_PATTERN = /\/reset-password(?:\/|$)/i;

function safeBaseUrl() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://pinkpaisa.local";
}

function parseUrl(value: string) {
  try {
    return new URL(String(value || "/"), safeBaseUrl());
  } catch {
    return new URL("/", safeBaseUrl());
  }
}

function sanitizedSearch(source: URLSearchParams) {
  const safe = new URLSearchParams();
  source.forEach((rawValue, key) => {
    if (!ANALYTICS_QUERY_ALLOWLIST_SET.has(key)) return;
    const limit = key === "gclid" || key === "fbclid" ? 240 : 160;
    const value = rawValue.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit);
    if (value) safe.append(key, value);
  });
  return safe.toString();
}

/**
 * Returns the page path that analytics and attribution may receive. Only known
 * campaign parameters are retained; receipt, unsubscribe, payment, auth, and
 * arbitrary query values are deliberately discarded, along with fragments.
 */
export function sanitizeAnalyticsPath(value: string) {
  const url = parseUrl(value);
  const search = sanitizedSearch(url.searchParams);
  return `${url.pathname || "/"}${search ? `?${search}` : ""}`;
}

/** Returns an absolute analytics location without credentials or unsafe query data. */
export function sanitizeAnalyticsLocation(value: string) {
  const url = parseUrl(value);
  return `${url.origin}${sanitizeAnalyticsPath(url.href)}`;
}

/**
 * GA4 is disabled on private/authenticated workspaces, but remains available on
 * consented public checkout and receipt pages after their URLs are sanitized.
 */
export function isAnalyticsBlockedPath(value: string) {
  const pathname = parseUrl(value).pathname.replace(/\/+$/, "") || "/";
  if (RESET_PASSWORD_PATTERN.test(pathname)) return true;
  return BLOCKED_ANALYTICS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export { ANALYTICS_QUERY_ALLOWLIST };
