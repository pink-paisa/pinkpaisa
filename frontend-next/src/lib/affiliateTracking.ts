import { API_URL } from "@/lib/api";

export type AffiliateTrackableProduct = {
  id: string;
  affiliate_asin?: string | null;
  affiliate_marketplace?: string | null;
  category?: string | null;
  campaign_label?: string | null;
};

type AffiliateEventType = "product_view" | "cta_click" | "outbound_click";
const CTA_EXPERIMENT_NAME = "affiliate_cta_text_v1";
const CTA_EXPERIMENT_STORAGE_KEY = "pinkpaisa_affiliate_cta_variant";
const FIRST_TOUCH_STORAGE_KEY = "pinkpaisa_affiliate_first_touch";
const CTA_VARIANTS = ["view_on_amazon", "check_price_on_amazon"] as const;
export type AffiliateCtaVariant = typeof CTA_VARIANTS[number];
type UtmParams = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
};

function getDeviceType() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}

function readCurrentUtmParams(): UtmParams {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get("utm_source") || undefined,
    utm_medium: params.get("utm_medium") || undefined,
    utm_campaign: params.get("utm_campaign") || undefined,
    utm_content: params.get("utm_content") || undefined,
  };
}

function hasUtmParams(params: UtmParams) {
  return Boolean(params.utm_source || params.utm_medium || params.utm_campaign || params.utm_content);
}

function getStoredUtmParams(): UtmParams {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(FIRST_TOUCH_STORAGE_KEY) || "{}");
    return {
      utm_source: parsed.utm_source || undefined,
      utm_medium: parsed.utm_medium || undefined,
      utm_campaign: parsed.utm_campaign || undefined,
      utm_content: parsed.utm_content || undefined,
    };
  } catch {
    return {};
  }
}

export function persistAffiliateAttribution() {
  if (typeof window === "undefined") return;
  const current = readCurrentUtmParams();
  if (!hasUtmParams(current)) return;

  try {
    if (hasUtmParams(getStoredUtmParams())) return;
    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, JSON.stringify({
      ...current,
      landing_path: `${window.location.pathname}${window.location.search}`,
      captured_at: new Date().toISOString(),
    }));
  } catch {
    // Attribution should never break page rendering.
  }
}

function getUtmParams() {
  const current = readCurrentUtmParams();
  if (hasUtmParams(current)) {
    persistAffiliateAttribution();
    return current;
  }
  return getStoredUtmParams();
}

export function buildAffiliateOutboundQuery() {
  const params = new URLSearchParams();
  Object.entries(getUtmParams()).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export function getAffiliateCtaExperiment(): { experiment_name: string; experiment_variant: AffiliateCtaVariant } {
  if (typeof window === "undefined") {
    return { experiment_name: CTA_EXPERIMENT_NAME, experiment_variant: "check_price_on_amazon" };
  }

  try {
    const existing = window.localStorage.getItem(CTA_EXPERIMENT_STORAGE_KEY);
    if (CTA_VARIANTS.includes(existing as AffiliateCtaVariant)) {
      return { experiment_name: CTA_EXPERIMENT_NAME, experiment_variant: existing as AffiliateCtaVariant };
    }

    const nextVariant: AffiliateCtaVariant = Math.random() < 0.5 ? "view_on_amazon" : "check_price_on_amazon";
    window.localStorage.setItem(CTA_EXPERIMENT_STORAGE_KEY, nextVariant);
    return { experiment_name: CTA_EXPERIMENT_NAME, experiment_variant: nextVariant };
  } catch {
    return { experiment_name: CTA_EXPERIMENT_NAME, experiment_variant: "check_price_on_amazon" };
  }
}

export function trackAffiliateEvent(product: AffiliateTrackableProduct, eventType: AffiliateEventType) {
  if (typeof window === "undefined" || !product?.id) return;

  const payload = {
    event_type: eventType,
    product_id: product.id,
    asin: product.affiliate_asin || undefined,
    marketplace: product.affiliate_marketplace || undefined,
    category: product.category || undefined,
    campaign_label: product.campaign_label || undefined,
    referrer: document.referrer || undefined,
    device_type: getDeviceType(),
    ...getAffiliateCtaExperiment(),
    ...getUtmParams(),
  };
  const url = `${API_URL.replace(/\/$/, "")}/affiliate-events`;
  const body = JSON.stringify(payload);

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  void fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
