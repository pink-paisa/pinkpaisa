import { describe, expect, it } from "vitest";
import { isClarityBlockedPath } from "@/lib/microsoftClarity";
import {
  isAnalyticsBlockedPath,
  sanitizeAnalyticsLocation,
  sanitizeAnalyticsPath,
} from "@/lib/privacySafeUrl";

describe("privacy-safe analytics URLs", () => {
  it("retains only allowlisted campaign parameters", () => {
    const value = sanitizeAnalyticsPath(
      "/start-here?utm_source=instagram&utm_campaign=launch&token=email-secret&t=receipt-secret&merchantOrderId=merchant-secret&unexpected=value#private",
    );
    expect(value).toBe("/start-here?utm_source=instagram&utm_campaign=launch");
    expect(value).not.toContain("secret");
    expect(value).not.toContain("unexpected");
  });

  it("removes credentials, fragments, and non-allowlisted query data from absolute locations", () => {
    const value = sanitizeAnalyticsLocation(
      "https://user:password@pinkpaisa.in/unsubscribe?token=signed-email-token&utm_medium=email#receipt",
    );
    expect(value).toBe("https://pinkpaisa.in/unsubscribe?utm_medium=email");
  });

  it("blocks receipt and unsubscribe pages from Clarity", () => {
    expect(isClarityBlockedPath("/workshop-booking-confirmation/booking-a?t=secret")).toBe(true);
    expect(isClarityBlockedPath("/unsubscribe?token=secret")).toBe(true);
  });

  it("keeps consented GA4 available on sanitized public receipts while blocking private workspaces", () => {
    expect(isAnalyticsBlockedPath("/workshop-booking-confirmation/booking-a?t=secret")).toBe(false);
    expect(isAnalyticsBlockedPath("/order-confirmation/order-a?t=secret")).toBe(false);
    expect(isAnalyticsBlockedPath("/phonepe-return?merchantOrderId=secret")).toBe(false);
    expect(isAnalyticsBlockedPath("/admin?section=analytics")).toBe(true);
    expect(isAnalyticsBlockedPath("/account/orders/order-a")).toBe(true);
  });
});
