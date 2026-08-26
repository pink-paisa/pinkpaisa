// @vitest-environment jsdom
import type { PropsWithChildren } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkshopBookingConfirmation from "@/pages/WorkshopBookingConfirmation";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  trackAnalyticsEvent: vi.fn(),
  router: {
    isReady: true,
    query: {
      bookingId: "booking-a",
      t: "signed-receipt-token",
      merchantOrderId: "merchant-a",
    } as Record<string, string>,
    replace: vi.fn(async () => true),
  },
}));

vi.mock("next/router", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/analytics", () => ({ trackAnalyticsEvent: mocks.trackAnalyticsEvent }));
vi.mock("@/components/Navbar", () => ({ default: () => <div /> }));
vi.mock("@/components/Footer", () => ({ default: () => <div /> }));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: PropsWithChildren) => <div>{children}</div> },
}));

describe("workshop receipt URL privacy", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.router.query = {
      bookingId: "booking-a",
      t: "signed-receipt-token",
      merchantOrderId: "merchant-a",
    };
    mocks.router.replace.mockClear();
    mocks.apiFetch.mockResolvedValue({
      id: "booking-a",
      workshop_title: "Money confidence",
      full_name: "A Guest",
      team_size: 2,
      payment_status: "paid",
      booking_status: "confirmed",
      delivery_mode: "Online",
      total: 1500,
    });
  });

  it("moves receipt credentials into session state, cleans the URL, and keeps receipt access working", async () => {
    render(<WorkshopBookingConfirmation />);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(
      "/workshop-booking-confirmation/booking-a",
      undefined,
      { shallow: true },
    ));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/workshop-bookings/booking-a",
      { headers: { "X-Workshop-Receipt-Token": "signed-receipt-token" } },
    ));
    expect(await screen.findByText("Workshop Booking Confirmed!")).toBeInTheDocument();
  });

  it("verifies a pending guest payment with the session-only payment capability", async () => {
    mocks.router.query = { bookingId: "booking-a" };
    sessionStorage.setItem("phonepe_pending_workshop_booking", JSON.stringify({
      booking_id: "booking-a",
      merchant_order_id: "merchant-a",
      verification_secret: "workshop-verification-secret",
      receipt_token: "signed-receipt-token",
    }));
    let bookingReads = 0;
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/phonepe/verify-payment") {
        return {
          verified: true,
          status: "COMPLETED",
          booking_id: "booking-a",
        };
      }
      bookingReads += 1;
      return {
        id: "booking-a",
        workshop_title: "Money confidence",
        full_name: "A Guest",
        team_size: 2,
        payment_status: bookingReads > 1 ? "paid" : "pending",
        booking_status: bookingReads > 1 ? "confirmed" : "draft",
        delivery_mode: "Online",
        total: 1500,
      };
    });

    render(<WorkshopBookingConfirmation />);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/phonepe/verify-payment",
      {
        method: "POST",
        headers: { "X-Payment-Verification-Secret": "workshop-verification-secret" },
        body: JSON.stringify({ merchant_order_id: "merchant-a" }),
      },
    ));
    expect(await screen.findByText("Workshop Booking Confirmed!")).toBeInTheDocument();
  });
});
