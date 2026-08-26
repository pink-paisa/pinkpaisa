import { describe, expect, it } from "vitest";
import { normalizeDraft } from "./adapters";

describe("Social Manager media URL portability", () => {
  it("routes historical loopback upload URLs through the current frontend proxy", () => {
    const draft = normalizeDraft({
      _id: "draft-1",
      status: "NEEDS_REVIEW",
      assets: [{
        _id: "asset-1",
        role: "FINAL_COMPOSED",
        url: "http://localhost:5001/uploads/generated/campaigns/old-final.png?revision=1",
        original_asset_url: "http://127.0.0.1:5000/uploads/generated/campaigns/old-original.png",
      }],
    });

    expect(draft?.assets[0].url).toBe("/uploads/generated/campaigns/old-final.png?revision=1");
    expect(draft?.assets[0].finalUrl).toBe("/uploads/generated/campaigns/old-final.png?revision=1");
    expect(draft?.assets[0].originalUrl).toBe("/uploads/generated/campaigns/old-original.png");
  });

  it("leaves public provider URLs unchanged", () => {
    const draft = normalizeDraft({
      _id: "draft-2",
      status: "NEEDS_REVIEW",
      assets: [{
        _id: "asset-2",
        role: "FINAL_COMPOSED",
        url: "https://media.pinkpaisa.in/social/final.png",
      }],
    });

    expect(draft?.assets[0].url).toBe("https://media.pinkpaisa.in/social/final.png");
  });
});
