import { SocialAsset, SocialDraft, SocialGenerationRun, SocialReadiness } from "./types";

export type DraftWorkflowAction =
  | "save"
  | "submit-review"
  | "generate-creative"
  | "approve-and-schedule"
  | "schedule"
  | "retry-generation-run"
  | "complete-manual-action"
  | "view-calendar"
  | "view-results"
  | "none";

export type DraftWorkflow = {
  primaryAction: DraftWorkflowAction;
  label: string;
  blockers: string[];
  recoveryActions: DraftWorkflowAction[];
};

const generatingStatuses = new Set(["PUBLISHING"]);

export const deriveDraftWorkflow = (
  draft: SocialDraft | null,
  readiness: SocialReadiness,
  dirty: boolean,
  generationRun: SocialGenerationRun | null = null,
): DraftWorkflow => {
  if (!draft) return { primaryAction: "none", label: "No draft selected", blockers: [], recoveryActions: [] };
  if (dirty) return { primaryAction: "save", label: "Save & recheck", blockers: [], recoveryActions: [] };

  const status = String(draft.status || "").toUpperCase();
  const blockers = [...(readiness.blockers || [])];
  if (generatingStatuses.has(status)) {
    return { primaryAction: "none", label: status === "PUBLISHING" ? "Publishing in progress" : "Generation in progress", blockers, recoveryActions: [] };
  }
  if (status === "DRAFT") {
    return { primaryAction: "generate-creative", label: "Generate required creative revision", blockers, recoveryActions: [] };
  }
  if (status === "REJECTED") {
    return { primaryAction: "submit-review", label: "Submit for review", blockers, recoveryActions: [] };
  }
  if (status === "NEEDS_REVIEW") {
    return { primaryAction: "approve-and-schedule", label: "Approve & schedule", blockers, recoveryActions: [] };
  }
  if (status === "APPROVED") {
    return { primaryAction: "schedule", label: "Schedule", blockers, recoveryActions: [] };
  }
  if (status === "SCHEDULED") {
    return { primaryAction: "view-calendar", label: "View scheduled post", blockers: [], recoveryActions: [] };
  }
  if (status === "PUBLISHED") {
    return { primaryAction: "view-results", label: "View results", blockers: [], recoveryActions: [] };
  }
  if (status === "FAILED") {
    const stage = String(draft.lastError?.stage || "").toUpperCase();
    const publication = draft.publication || {};
    const publicationStatus = String(publication.status || "").toUpperCase();
    const retryAt = String(publication.retry_scheduled_for || publication.next_retry_at || "");
    const outcomeUncertain = Boolean(publication.outcome_uncertain) || stage === "PUBLISH_OUTCOME_UNCERTAIN" || publicationStatus === "UNCERTAIN";
    const openManualAction = (draft.manualActions || []).some((action) => ["OPEN", "IN_PROGRESS"].includes(String(action.status).toUpperCase()));
    if (outcomeUncertain) {
      return { primaryAction: "complete-manual-action", label: "Manual Instagram reconciliation required", blockers, recoveryActions: [] };
    }
    if (["PUBLISHING", "PUBLISHING_READINESS"].includes(stage) || ["FAILED", "BLOCKED"].includes(publicationStatus)) {
      if (retryAt) return { primaryAction: "none", label: "Publishing retry scheduled", blockers, recoveryActions: [] };
      if (openManualAction || stage === "PUBLISHING_READINESS") {
        return { primaryAction: "complete-manual-action", label: "Complete required publishing action", blockers, recoveryActions: [] };
      }
      return { primaryAction: "none", label: "Publishing failed — review recovery details", blockers, recoveryActions: [] };
    }
    const runStatus = String(generationRun?.status || "").toUpperCase();
    if (["FAILED", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION"].includes(runStatus)) {
      const imageFailure = runStatus === "FAILED_IMAGE_GENERATION" || ["GENERATING_IMAGES", "VALIDATING_IMAGES"].includes(stage);
      const complianceFailure = runStatus === "FAILED_COMPLIANCE" || ["CHECKING_COMPLIANCE", "REVISING_CONTENT"].includes(stage);
      return {
        primaryAction: "retry-generation-run",
        label: imageFailure ? "Retry image generation" : complianceFailure ? "Retry compliance revision" : "Retry generation",
        blockers,
        recoveryActions: [],
      };
    }
    return { primaryAction: "none", label: "Review recorded failure", blockers, recoveryActions: [] };
  }
  return { primaryAction: "none", label: "No action available", blockers, recoveryActions: [] };
};

const assetMode = (asset: SocialAsset) => String(asset.visualMode || asset.provenance?.visual_mode || "").toUpperCase();

const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

export const AI_NATIVE_FULL_GRAPHIC_LABEL = "Artwork & text · AI-native — No overlay";

export const isAiNativeFullGraphicAsset = (asset: SocialAsset | null | undefined): boolean => {
  if (!asset || assetMode(asset) !== "FULL_AI_GRAPHIC") return false;
  const provenance = record(asset.provenance);
  const overlay = record(provenance.overlay);
  const contractVersion = Number(
    provenance.full_ai_graphic_contract_version
      ?? provenance.fullAiGraphicContractVersion,
  );
  const overlayMethod = String(overlay.method || "").trim().toLowerCase();
  const aiTextValue = overlay.image_ai_used_for_text
    ?? overlay.imageAiUsedForText
    ?? provenance.image_ai_used_for_text
    ?? provenance.imageAiUsedForText;
  const imageAiUsedForText = aiTextValue === true
    || aiTextValue === 1
    || String(aiTextValue || "").trim().toLowerCase() === "true";

  return contractVersion === 2 || (overlayMethod === "none" && imageAiUsedForText);
};

const assetCreativeStyle = (asset: SocialAsset) => {
  const provenance = record(asset.provenance);
  const baseImage = record(provenance.base_image);
  const overlay = record(provenance.overlay);
  const style = record(provenance.creative_style || baseImage.creative_style || overlay.creative_style);
  return String(style.id || style.direction || "").toUpperCase();
};

export const provenanceLabels = (draft: SocialDraft): string[] => {
  const assets = draft.assets || [];
  const image = assets.find((asset) => asset.provider || asset.role === "ORIGINAL_AI_VISUAL") || assets[0];
  const labels: string[] = [];
  if (image?.provider) labels.push(`Artwork · AI — ${image.provider}${image.model ? `/${image.model}` : ""}`);

  const mode = String(draft.visualMode || assetMode(image || {} as SocialAsset)).toUpperCase();
  if (mode === "AI_ARTWORK_ONLY") labels.push("Artwork · AI — No overlay");
  if (mode === "AI_VISUAL_WITH_EXACT_OVERLAY") labels.push("Text · Verified overlay");
  if (mode === "FULL_AI_GRAPHIC") {
    if (assets.some(isAiNativeFullGraphicAsset)) labels.push(AI_NATIVE_FULL_GRAPHIC_LABEL);
    else labels.push("Headline · AI-rendered and validated", "Brand elements · Overlay");
  }
  if (mode === "MANUAL_TEMPLATE") labels.push("Legacy · Manual template");
  const creativeStyle = assets.map(assetCreativeStyle).find(Boolean);
  if (creativeStyle === "EDITORIAL_ICON_GRID") labels.push("Style · Editorial icon grid");
  if (creativeStyle === "BOLD_EDITORIAL_COLLAGE") labels.push("Style · Bold editorial collage");
  if (draft.primary.verifiedProductId) labels.push("Product · Authentic catalogue image");
  if (["REEL", "VIDEO_FEED"].includes(String(draft.primary.format).toUpperCase())) labels.push("Video · FFmpeg assembled");
  return [...new Set(labels)];
};

export const actionableDraftCount = (drafts: SocialDraft[]) => drafts.filter((draft) => [
  "NEEDS_REVIEW",
  "FAILED",
].includes(String(draft.status).toUpperCase())).length;
