// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAnalyticsConsent } from "@/lib/analytics";
import GoogleAnalytics from "./GoogleAnalytics";

const routerState = vi.hoisted(() => ({ asPath: "/start-here" }));

vi.mock("next/router", () => ({
  useRouter: () => routerState,
}));

vi.mock("next/script", () => ({
  default: ({ onLoad, onReady }: { onLoad?: () => void; onReady?: () => void }) => (
    <button
      data-testid="ga-script"
      onClick={() => {
        onLoad?.();
        onReady?.();
      }}
    />
  ),
}));

function pageViewCalls() {
  return vi.mocked(window.gtag!).mock.calls.filter(
    ([command, event]) => command === "event" && event === "page_view",
  );
}

describe("GoogleAnalytics", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GA4_MEASUREMENT_ID", "G-PINKPAISA1");
    window.localStorage.clear();
    window.gtag = vi.fn();
    routerState.asPath = "/start-here";
    setAnalyticsConsent("granted");
  });

  it("emits one initial page view even when Script invokes both callbacks, then one per route", async () => {
    const { rerender } = render(<GoogleAnalytics />);

    fireEvent.click(await screen.findByTestId("ga-script"));
    await waitFor(() => expect(pageViewCalls()).toHaveLength(1));

    fireEvent.click(screen.getByTestId("ga-script"));
    rerender(<GoogleAnalytics />);
    await waitFor(() => expect(pageViewCalls()).toHaveLength(1));

    routerState.asPath = "/wealthness-quiz";
    rerender(<GoogleAnalytics />);
    await waitFor(() => expect(pageViewCalls()).toHaveLength(2));

    expect(pageViewCalls().map((call) => call[2])).toEqual([
      expect.objectContaining({ page_path: "/start-here" }),
      expect.objectContaining({ page_path: "/wealthness-quiz" }),
    ]);
  });

  it("never sends receipt, unsubscribe, or arbitrary query values to GA4", async () => {
    routerState.asPath = "/start-here?utm_source=instagram&token=email-secret&t=receipt-secret&merchantOrderId=merchant-secret";
    window.history.replaceState({}, "", routerState.asPath);
    render(<GoogleAnalytics />);

    fireEvent.click(await screen.findByTestId("ga-script"));
    await waitFor(() => expect(pageViewCalls()).toHaveLength(1));

    const payload = pageViewCalls()[0][2] as Record<string, string>;
    expect(payload.page_path).toBe("/start-here?utm_source=instagram");
    expect(payload.page_location).toContain("/start-here?utm_source=instagram");
    expect(JSON.stringify(payload)).not.toContain("email-secret");
    expect(JSON.stringify(payload)).not.toContain("receipt-secret");
    expect(JSON.stringify(payload)).not.toContain("merchant-secret");
  });

  it("loads on a public receipt route but sends only its sanitized location", async () => {
    routerState.asPath = "/workshop-booking-confirmation/booking-a?t=signed-receipt-token&merchantOrderId=merchant-secret&utm_source=email";
    window.history.replaceState({}, "", routerState.asPath);
    render(<GoogleAnalytics />);

    fireEvent.click(await screen.findByTestId("ga-script"));
    await waitFor(() => expect(pageViewCalls()).toHaveLength(1));

    const payload = pageViewCalls()[0][2] as Record<string, string>;
    expect(payload.page_path).toBe("/workshop-booking-confirmation/booking-a?utm_source=email");
    expect(payload.page_location).toContain("/workshop-booking-confirmation/booking-a?utm_source=email");
    expect(JSON.stringify(payload)).not.toContain("signed-receipt-token");
    expect(JSON.stringify(payload)).not.toContain("merchant-secret");
  });
});
