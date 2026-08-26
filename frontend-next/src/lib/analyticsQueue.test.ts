// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingAnalyticsEvents,
  setAnalyticsConsent,
  trackAnalyticsEvent,
} from "@/lib/analytics";

describe("durable consented analytics event queue", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.gtag = undefined;
  });

  it("queues an authoritative purchase until GA4 becomes ready", () => {
    setAnalyticsConsent("granted");
    expect(trackAnalyticsEvent("purchase", {
      transaction_id: "workshop:booking-a",
      value: 1500,
      currency: "INR",
    })).toBe(true);

    window.gtag = vi.fn();
    expect(flushPendingAnalyticsEvents()).toBe(1);
    expect(window.gtag).toHaveBeenCalledWith("event", "purchase", {
      transaction_id: "workshop:booking-a",
      value: 1500,
      currency: "INR",
    });
    expect(flushPendingAnalyticsEvents()).toBe(0);
  });

  it("does not queue events before analytics consent", () => {
    setAnalyticsConsent("denied");
    expect(trackAnalyticsEvent("begin_checkout", { value: 1000 })).toBe(false);
    window.gtag = vi.fn();
    expect(flushPendingAnalyticsEvents()).toBe(0);
  });
});
