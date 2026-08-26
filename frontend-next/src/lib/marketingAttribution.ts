import { sanitizeAnalyticsLocation, sanitizeAnalyticsPath } from "@/lib/privacySafeUrl";

export type MarketingTouch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  fbclid?: string;
  landing_path?: string;
  referrer?: string;
  captured_at?: string;
};

export type MarketingAttribution = {
  first_touch: MarketingTouch;
  last_touch: MarketingTouch;
};

const FIRST_TOUCH_KEY = "pinkpaisa_marketing_first_touch_v1";
const LAST_TOUCH_KEY = "pinkpaisa_marketing_last_touch_v1";
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;

function safeParse(value: string | null): MarketingTouch {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function currentTouch(): MarketingTouch {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const touch: MarketingTouch = {
    landing_path: sanitizeAnalyticsPath(`${window.location.pathname}${window.location.search}`).slice(0, 500),
    referrer: document.referrer ? sanitizeAnalyticsLocation(document.referrer).slice(0, 500) : undefined,
    captured_at: new Date().toISOString(),
  };
  CAMPAIGN_KEYS.forEach((key) => {
    const value = params.get(key)?.trim();
    if (value) touch[key] = value.slice(0, key === "gclid" || key === "fbclid" ? 240 : 160);
  });
  return touch;
}

function hasCampaignTouch(touch: MarketingTouch) {
  return CAMPAIGN_KEYS.some((key) => Boolean(touch[key]));
}

export function persistMarketingAttribution(): MarketingAttribution {
  if (typeof window === "undefined") return { first_touch: {}, last_touch: {} };
  const touch = currentTouch();
  try {
    const first = safeParse(window.localStorage.getItem(FIRST_TOUCH_KEY));
    const priorLast = safeParse(window.localStorage.getItem(LAST_TOUCH_KEY));
    const last = hasCampaignTouch(touch) || !priorLast.captured_at
      ? touch
      : {
          ...priorLast,
          landing_path: touch.landing_path,
          captured_at: touch.captured_at,
        };
    if (!first.captured_at) window.localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(touch));
    window.localStorage.setItem(LAST_TOUCH_KEY, JSON.stringify(last));
    return { first_touch: first.captured_at ? first : touch, last_touch: last };
  } catch {
    // Attribution must never block the customer journey.
    return { first_touch: touch, last_touch: touch };
  }
}

export function getMarketingAttribution(): MarketingAttribution {
  if (typeof window === "undefined") return { first_touch: {}, last_touch: {} };
  try {
    const first = safeParse(window.localStorage.getItem(FIRST_TOUCH_KEY));
    const last = safeParse(window.localStorage.getItem(LAST_TOUCH_KEY));
    if (!first.captured_at || !last.captured_at) return persistMarketingAttribution();
    return { first_touch: first, last_touch: last };
  } catch {
    const touch = currentTouch();
    return { first_touch: touch, last_touch: touch };
  }
}
