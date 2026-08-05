export const CANONICAL_SITE_URL = "https://pinkpaisa.in";

export function normalizeSiteUrl(value?: string | null) {
  const rawValue = String(value || CANONICAL_SITE_URL).trim().replace(/\/+$/, "");
  if (!rawValue) return CANONICAL_SITE_URL;

  try {
    const url = new URL(rawValue);
    if (url.hostname.toLowerCase() === "www.pinkpaisa.in") {
      url.hostname = "pinkpaisa.in";
    }
    if (url.hostname.toLowerCase() === "pinkpaisa.in") {
      url.protocol = "https:";
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawValue.replace(/^https?:\/\/www\.pinkpaisa\.in$/i, CANONICAL_SITE_URL);
  }
}

export function absoluteSiteUrl(path?: string | null, siteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL)) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname.toLowerCase() === "www.pinkpaisa.in") {
        url.hostname = "pinkpaisa.in";
        url.protocol = "https:";
        return url.toString();
      }
      return path;
    } catch {
      return path;
    }
  }
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
