// @vitest-environment jsdom
import type { PropsWithChildren } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PhonepeReturn from "@/pages/PhonepeReturn";

const mocks = vi.hoisted(() => ({
  clearCart: vi.fn(),
  customerFetch: vi.fn(),
  trackAnalyticsEvent: vi.fn(() => true),
  router: {
    isReady: true,
    query: {} as Record<string, string>,
    replace: vi.fn(async () => true),
    push: vi.fn(async () => true),
  },
}));

vi.mock("next/router", () => ({ useRouter: () => mocks.router }));
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({ clearCart: mocks.clearCart }),
}));
vi.mock("@/contexts/CustomerAuthContext", () => ({
  customerFetch: mocks.customerFetch,
}));
vi.mock("@/lib/analytics", () => ({
  trackAnalyticsEvent: mocks.trackAnalyticsEvent,
}));
vi.mock("@/components/Navbar", () => ({ default: () => <div /> }));
vi.mock("@/components/Footer", () => ({ default: () => <div /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: PropsWithChildren) => <div>{children}</div> },
}));

describe("PhonePe return verification capability", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.clearCart.mockClear();
    mocks.customerFetch.mockReset();
    mocks.router.query = {};
    mocks.router.replace.mockClear();
    mocks.router.push.mockClear();
    mocks.customerFetch.mockResolvedValue({
      verified: true,
      status: "COMPLETED",
      order_id: "order-a",
      order_summary: { order_number: "PP-1", total: 1500 },
      receipt_token: "receipt-a",
    });
  });

  it("reads the high-entropy secret from session storage and sends it only in a header", async () => {
    sessionStorage.setItem("phonepe_pending_order", JSON.stringify({
      merchant_order_id: "merchant-a",
      verification_secret: "guest-verification-secret",
    }));

    render(<PhonepeReturn />);

    await waitFor(() => expect(mocks.customerFetch).toHaveBeenCalledWith(
      "/phonepe/verify-payment",
      {
        method: "POST",
        headers: { "X-Payment-Verification-Secret": "guest-verification-secret" },
        body: JSON.stringify({ merchant_order_id: "merchant-a" }),
      },
    ));
    expect(await screen.findByText("Payment Successful!")).toBeInTheDocument();
    expect(sessionStorage.getItem("phonepe_pending_order")).toBeNull();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it("cleans a legacy merchant ID from the URL before owner-session verification", async () => {
    mocks.router.query = { merchantOrderId: "legacy-merchant" };

    render(<PhonepeReturn />);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(
      "/phonepe-return",
      undefined,
      { shallow: true },
    ));
    await waitFor(() => expect(mocks.customerFetch).toHaveBeenCalledWith(
      "/phonepe/verify-payment",
      {
        method: "POST",
        headers: {},
        body: JSON.stringify({ merchant_order_id: "legacy-merchant" }),
      },
    ));
  });
});
