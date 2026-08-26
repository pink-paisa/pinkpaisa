// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  trackAnalyticsEvent,
} from "@/lib/analytics";
import {
  getMarketingAttribution,
  persistMarketingAttribution,
} from "@/lib/marketingAttribution";
import {
  buildAffiliateOutboundQuery,
  getAffiliateCtaExperiment,
} from "@/lib/affiliateTracking";

describe("consent-aware growth analytics", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    window.gtag = vi.fn();
  });

  it("does not emit events before consent and emits after explicit consent", () => {
    expect(getAnalyticsConsent()).toBe("unknown");
    expect(trackAnalyticsEvent("quiz_start", { quiz_name: "wealthness" })).toBe(false);
    expect(window.gtag).not.toHaveBeenCalledWith("event", "quiz_start", expect.anything());

    setAnalyticsConsent("granted");
    expect(getAnalyticsConsent()).toBe("granted");
    expect(trackAnalyticsEvent("quiz_start", { quiz_name: "wealthness" })).toBe(true);
    expect(window.gtag).toHaveBeenCalledWith("event", "quiz_start", { quiz_name: "wealthness" });
  });

  it("keeps first touch stable while refreshing last touch", () => {
    window.history.replaceState({}, "", "/quiz?utm_source=instagram&utm_medium=social&utm_campaign=launch");
    persistMarketingAttribution();
    window.history.replaceState({}, "", "/instagram/picks?utm_source=email&utm_medium=email&utm_campaign=roadmap");
    persistMarketingAttribution();
    const attribution = getMarketingAttribution();
    expect(attribution.first_touch.utm_source).toBe("instagram");
    expect(attribution.first_touch.utm_campaign).toBe("launch");
    expect(attribution.last_touch.utm_source).toBe("email");
    expect(attribution.last_touch.utm_campaign).toBe("roadmap");
  });

  it("does not erase campaign attribution on internal navigation", () => {
    window.history.replaceState({}, "", "/start-here?utm_source=instagram&utm_medium=organic_social&utm_campaign=bio");
    persistMarketingAttribution();
    window.history.replaceState({}, "", "/quiz");
    persistMarketingAttribution();
    const attribution = getMarketingAttribution();
    expect(attribution.last_touch.utm_source).toBe("instagram");
    expect(attribution.last_touch.utm_campaign).toBe("bio");
    expect(attribution.last_touch.landing_path).toBe("/quiz");
  });

  it("propagates the CTA experiment through the authoritative redirect query", () => {
    window.localStorage.setItem("pinkpaisa_affiliate_cta_variant", "view_on_amazon");
    window.history.replaceState({}, "", "/products?utm_source=instagram&utm_campaign=weekly-picks");
    const experiment = getAffiliateCtaExperiment();
    const query = new URLSearchParams(buildAffiliateOutboundQuery());
    expect(experiment.experiment_variant).toBe("view_on_amazon");
    expect(query.get("experiment_name")).toBe("affiliate_cta_text_v1");
    expect(query.get("experiment_variant")).toBe("view_on_amazon");
    expect(query.get("utm_campaign")).toBe("weekly-picks");
  });
});
