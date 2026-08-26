import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeDraft } from "./adapters";
import { SocialAudioLibrary } from "./SocialAudioLibrary";

vi.mock("@/lib/api", () => ({
  API_URL: "",
  apiFetch: vi.fn(async () => ({ items: [] })),
}));

describe("SocialAudioLibrary video format copy", () => {
  it("offers format-aware audio selection for a Video Feed", async () => {
    const draft = normalizeDraft({
      _id: "video-feed-audio",
      status: "NEEDS_REVIEW",
      current_package: { primary_recommendation: { format: "VIDEO_FEED" } },
    });
    if (!draft) throw new Error("The Video Feed fixture must normalize");

    render(<SocialAudioLibrary draft={draft} onApplyToReel={vi.fn()} />);

    expect(screen.getByText("Licensed social-video audio")).toBeVisible();
    expect(screen.getByText("Audio for this Video Feed draft")).toBeVisible();
    expect(screen.getByRole("button", { name: "Select & rebuild Video Feed" })).toBeDisabled();
    expect(await screen.findByText(/Reels and Video Feeds remain silent/)).toBeVisible();
  });
});
