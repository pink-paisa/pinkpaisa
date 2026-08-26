const BLOCKED_CLARITY_PREFIXES = [
  "/admin",
  "/vendor",
  "/account",
  "/cart",
  "/checkout",
  "/order-confirmation",
  "/phonepe-return",
  "/workshop-booking",
  "/workshop-booking-confirmation",
  "/unsubscribe",
  "/pink-pages/submit",
];

const RESET_PASSWORD_PATTERN = /\/reset-password(?:\/|$)/i;
const SAFE_TAG_VALUE_PATTERN = /[^a-zA-Z0-9 _.-]/g;

export function getPathname(asPath = "") {
  const value = String(asPath || "/");
  try {
    return new URL(value, "https://pinkpaisa.local").pathname || "/";
  } catch {
    return value.split("?")[0].split("#")[0] || "/";
  }
}

export function isClarityBlockedPath(asPath = "") {
  const pathname = getPathname(asPath).replace(/\/+$/, "") || "/";
  if (RESET_PASSWORD_PATTERN.test(pathname)) return true;
  return BLOCKED_CLARITY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function getSearchParams(asPath = "") {
  try {
    return new URL(String(asPath || "/"), "https://pinkpaisa.local").searchParams;
  } catch {
    return new URLSearchParams("");
  }
}

function safeTagValue(value: string | null | undefined, fallback = "") {
  const cleaned = String(value || "")
    .replace(SAFE_TAG_VALUE_PATTERN, "")
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

export function getClarityPageType(asPath = "") {
  const pathname = getPathname(asPath);
  if (pathname === "/") return "home";
  if (pathname === "/products") return "products";
  if (pathname.startsWith("/product/")) return "product";
  if (pathname.startsWith("/wellness")) return "wellness";
  if (pathname.startsWith("/instagram")) return "instagram";
  if (pathname.startsWith("/blogs")) return "blog";
  if (pathname.startsWith("/financial-calculator")) return "calculator";
  if (pathname.startsWith("/affiliate-disclosure") || pathname.startsWith("/privacy")) return "legal";
  if (pathname.startsWith("/pink-pages")) return "directory";
  if (pathname.startsWith("/workshops")) return "workshops";
  if (pathname.startsWith("/predictions") || pathname.startsWith("/quiz")) return "engagement";
  return "public";
}

export function isAffiliateClarityPath(asPath = "") {
  const pathname = getPathname(asPath);
  return pathname === "/products" || pathname.startsWith("/product/") || pathname.startsWith("/wellness") || pathname.startsWith("/instagram");
}

export function getClarityTags(asPath = "") {
  const params = getSearchParams(asPath);
  return {
    page_type: getClarityPageType(asPath),
    affiliate_flow: isAffiliateClarityPath(asPath) ? "true" : "false",
    traffic_source: safeTagValue(params.get("utm_source"), "direct"),
  };
}

export function getClarityProjectId() {
  const projectId = String(process.env.NEXT_PUBLIC_MICROSOFT_CLARITY_PROJECT_ID || "").trim();
  return /^[a-zA-Z0-9]+$/.test(projectId) ? projectId : "";
}

export function isClarityEnabled() {
  return process.env.NEXT_PUBLIC_MICROSOFT_CLARITY_ENABLED === "true" && Boolean(getClarityProjectId());
}
