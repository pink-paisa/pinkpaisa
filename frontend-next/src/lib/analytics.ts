export type AnalyticsConsent = "granted" | "denied" | "unknown";

export type PinkPaisaAnalyticsEvent =
  | "quiz_start"
  | "quiz_complete"
  | "generate_lead"
  | "view_item"
  | "affiliate_cta_click"
  | "affiliate_outbound_click"
  | "workshop_enquiry"
  | "begin_checkout"
  | "purchase";

export type AnalyticsEventParams = Record<string, string | number | boolean | null | undefined>;

const CONSENT_KEY = "pinkpaisa_analytics_consent_v1";
const PENDING_EVENTS_KEY = "pinkpaisa_pending_analytics_events_v1";
const MAX_PENDING_EVENTS = 50;
export const ANALYTICS_CONSENT_EVENT = "pinkpaisa:analytics-consent";
type PendingAnalyticsEvent = { event: PinkPaisaAnalyticsEvent; params: AnalyticsEventParams };
let memoryPendingEvents: PendingAnalyticsEvent[] = [];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === "undefined") return "unknown";
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

export function setAnalyticsConsent(consent: Exclude<AnalyticsConsent, "unknown">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, consent);
    if (consent === "denied") window.sessionStorage.removeItem(PENDING_EVENTS_KEY);
  } catch {
    // The in-memory event still keeps this page consistent when storage is blocked.
  }
  if (consent === "denied") memoryPendingEvents = [];
  window.gtag?.("consent", "update", {
    analytics_storage: consent,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: consent }));
}

export function trackAnalyticsEvent(event: PinkPaisaAnalyticsEvent, params: AnalyticsEventParams = {}) {
  if (typeof window === "undefined" || getAnalyticsConsent() !== "granted") return false;
  if (typeof window.gtag !== "function") {
    const next = { event, params };
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(PENDING_EVENTS_KEY) || "[]");
      const queue = Array.isArray(stored) ? stored.slice(-(MAX_PENDING_EVENTS - 1)) : [];
      queue.push(next);
      window.sessionStorage.setItem(PENDING_EVENTS_KEY, JSON.stringify(queue));
    } catch {
      memoryPendingEvents = [...memoryPendingEvents.slice(-(MAX_PENDING_EVENTS - 1)), next];
    }
    return true;
  }
  window.gtag("event", event, params);
  return true;
}

export function flushPendingAnalyticsEvents() {
  if (typeof window === "undefined" || getAnalyticsConsent() !== "granted" || typeof window.gtag !== "function") return 0;
  let queued: PendingAnalyticsEvent[] = [];
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(PENDING_EVENTS_KEY) || "[]");
    if (Array.isArray(stored)) queued = stored;
    window.sessionStorage.removeItem(PENDING_EVENTS_KEY);
  } catch {
    // Fall back to the in-memory queue below when session storage is blocked.
  }
  queued = [...queued, ...memoryPendingEvents].slice(-MAX_PENDING_EVENTS);
  memoryPendingEvents = [];
  queued.forEach(({ event, params }) => window.gtag?.("event", event, params));
  return queued.length;
}
