import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "./client";

describe("Supabase compatibility CSRF protection", () => {
  beforeEach(() => {
    document.cookie = "pinkpaisa_csrf=signed-token; path=/";
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "listing-1" }),
    })));
  });

  it("adds the CSRF header to legacy admin mutations", async () => {
    await supabase
      .from("pink_pages_listings")
      .update({ status: "active" })
      .eq("id", "listing-1");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/pink-pages/listings/listing-1"),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        headers: expect.objectContaining({ "X-CSRF-Token": "signed-token" }),
      }),
    );
  });
});
