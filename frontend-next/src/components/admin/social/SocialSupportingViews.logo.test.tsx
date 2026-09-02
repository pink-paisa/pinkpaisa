import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SocialSettingsView } from "./SocialSupportingViews";
import { DEFAULT_SOCIAL_SETTINGS, EMPTY_READINESS } from "./types";

const completeContract = {
  ...DEFAULT_SOCIAL_SETTINGS.brandLogoContract,
  referenceChecksumSha256: "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9",
  readinessStatus: "VERIFIED",
};

describe("SocialSettingsView approved logo policy", () => {
  it("shows the fixed approved badge fallback and immutable contract details", () => {
    render(<SocialSettingsView
      settings={{ ...DEFAULT_SOCIAL_SETTINGS, brandLogoContract: completeContract }}
      readiness={EMPTY_READINESS}
      loading={false}
      saving={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
    />);

    expect(screen.getByRole("img", { name: /Approved Pink Paisa 512 pixel profile badge/i })).toHaveAttribute("src", "/pink-paisa-logo.png");
    expect(screen.getByText("Approved 512 badge")).toBeVisible();
    expect(screen.getByText("Ready for AI generation")).toBeVisible();
    expect(screen.getByText("pink-paisa-profile-badge-v1")).toBeVisible();
    expect(screen.getByText("pink-paisa-mandatory-ai-baked-v1")).toBeVisible();
    expect(screen.getByText("v1")).toBeVisible();
    expect(screen.getByText(completeContract.referenceChecksumSha256)).toBeVisible();
    expect(screen.getByText(/adaptive safe corner, locked per draft/i)).toBeVisible();
    expect(screen.getByText(/180–240px accepted/i)).toBeVisible();
    expect(screen.getByRole("switch", { name: /logo required on every new image/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /logo required on every new image/i })).toBeDisabled();
  });

  it("surfaces a blocker when the server contract is not ready", () => {
    render(<SocialSettingsView
      settings={DEFAULT_SOCIAL_SETTINGS}
      readiness={EMPTY_READINESS}
      loading={false}
      saving={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
    />);

    expect(screen.getByText("Logo setup incomplete")).toBeVisible();
    expect(screen.getByText("Generation must remain blocked")).toBeVisible();
  });

  it("does not present the stored preflight policy as a live verification", () => {
    render(<SocialSettingsView
      settings={{
        ...DEFAULT_SOCIAL_SETTINGS,
        brandLogoContract: {
          ...completeContract,
          readinessStatus: "VERIFY_BEFORE_GENERATION",
        },
      }}
      readiness={EMPTY_READINESS}
      loading={false}
      saving={false}
      onChange={vi.fn()}
      onSave={vi.fn()}
    />);

    expect(screen.getByText("Logo setup incomplete")).toBeVisible();
    expect(screen.queryByText("Ready for AI generation")).not.toBeInTheDocument();
  });
});
