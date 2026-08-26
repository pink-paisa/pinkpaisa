// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UnsubscribePage from "../../pages/unsubscribe";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  router: {
    isReady: true,
    query: { token: "signed-email-token" } as Record<string, string>,
    replace: vi.fn(async () => true),
  },
}));

vi.mock("next/router", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/components/Navbar", () => ({ default: () => <div /> }));
vi.mock("@/components/Footer", () => ({ default: () => <div /> }));
vi.mock("@/components/SeoHead", () => ({ default: () => null }));

describe("unsubscribe URL privacy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.apiFetch.mockResolvedValue({ unsubscribed: true });
    mocks.router.query = { token: "signed-email-token" };
    mocks.router.replace.mockClear();
  });

  it("moves the token to session state, cleans the URL, and still submits the exact token", async () => {
    render(<UnsubscribePage />);

    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith("/unsubscribe", undefined, { shallow: true }));
    expect(sessionStorage.getItem("pinkpaisa_unsubscribe_token")).toBe("signed-email-token");

    fireEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith(
      "/marketing/unsubscribe",
      expect.objectContaining({ body: JSON.stringify({ token: "signed-email-token" }) }),
    ));
    expect(await screen.findByText(/have been unsubscribed/i)).toBeInTheDocument();
    expect(sessionStorage.getItem("pinkpaisa_unsubscribe_token")).toBeNull();
  });
});
