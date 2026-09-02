import {
  DEFAULT_SOCIAL_SETTINGS,
  EMPTY_READINESS,
  SocialAlternative,
  SocialAnalyticsAttributionRow,
  SocialAnalyticsBaseline,
  SocialAnalyticsRefreshConnection,
  SocialAnalyticsSummary,
  SocialAsset,
  SocialAuditEvent,
  SocialCommunityItem,
  SocialConnection,
  SocialConnectionsSnapshot,
  SocialDraft,
  SocialDraftStatus,
  SocialFormat,
  SocialGeneratedContentCleanupPreview,
  SocialGeneratedContentCleanupResult,
  SocialGenerationRequest,
  SocialGenerationRun,
  SocialRegenerationRequest,
  SocialMetricSnapshot,
  SocialManualAction,
  SocialReadiness,
  SocialRecommendation,
  SocialSettings,
  SocialSignal,
  SocialSource,
  SocialVisualMode,
  SocialVisualModeResolution,
  SocialWorkSummary,
  SocialWeeklyPlan,
  SocialWeeklyResearch,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const object = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};

const unwrapData = (value: unknown) => {
  const root = object(value);
  return Object.prototype.hasOwnProperty.call(root, "data") ? root.data : value;
};

const first = (source: UnknownRecord, keys: string[]) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const string = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);

const portableMediaUrl = (value: unknown) => {
  const raw = string(value).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (["localhost", "127.0.0.1", "::1"].includes(hostname) && parsed.pathname.startsWith("/uploads/")) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Relative media URLs are already portable across local port changes.
  }
  return raw;
};

const number = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const boolean = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
};

const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const strings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => string(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
};

const numberMap = (value: unknown): Record<string, number> => Object.fromEntries(
  Object.entries(object(value))
    .map(([key, raw]) => [key, number(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null),
);

const visualMode = (value: unknown, fallback: SocialVisualMode = "AI_VISUAL_WITH_EXACT_OVERLAY"): SocialVisualMode => {
  const normalized = string(value).trim().toUpperCase();
  return ["AI_VISUAL_WITH_EXACT_OVERLAY", "AI_ARTWORK_ONLY", "FULL_AI_GRAPHIC"].includes(normalized)
    ? normalized as SocialVisualMode
    : fallback;
};

const storedVisualMode = (value: unknown): SocialAsset["visualMode"] => {
  const normalized = string(value).toUpperCase();
  return normalized === "MANUAL_TEMPLATE" ? "MANUAL_TEMPLATE" : visualMode(normalized);
};

const normalizeVisualModeResolution = (value: unknown, fallback?: SocialVisualMode): SocialVisualModeResolution | null => {
  const resolution = object(value);
  if (!Object.keys(resolution).length && !fallback) return null;
  const requested = visualMode(first(resolution, ["requested", "requested_mode", "requestedMode"]), fallback);
  const effective = visualMode(first(resolution, ["effective", "effective_mode", "effectiveMode"]), fallback || requested);
  return {
    requested,
    effective,
    eligible: boolean(first(resolution, ["eligible"]), requested === effective),
    reasons: strings(first(resolution, ["reasons", "reason_codes", "reasonCodes"])),
  };
};

const dateString = (value: unknown): string | null => {
  const result = string(value).trim();
  return result || null;
};

const normalizeSource = (value: unknown): SocialSource => {
  const source = object(value);
  return {
    id: string(first(source, ["id", "_id"])) || undefined,
    title: string(first(source, ["title", "source_title", "sourceTitle"]), "Untitled source"),
    url: string(first(source, ["url", "source_url", "sourceUrl"])),
    publisher: string(first(source, ["publisher", "domain", "publisher_domain", "publisherDomain"])),
    publishedAt: dateString(first(source, ["published_at", "publishedAt", "publication_date", "publicationDate"])),
    accessedAt: dateString(first(source, ["accessed_at", "accessedAt"])),
    claimSupported: string(first(source, ["claim_supported", "claimSupported", "claim", "supports"])),
    summary: string(first(source, ["summary", "excerpt", "supporting_summary", "supportingSummary"])),
    confidence: number(first(source, ["confidence", "confidence_score", "confidenceScore"])),
    freshness: string(first(source, ["freshness", "freshness_label", "freshnessLabel"])),
    sourceType: string(first(source, ["source_type", "sourceType", "type"]), "external"),
    influenced: first(source, ["influenced", "included", "used", "influenced_decision", "influencedDecision", "used_in_final", "usedInFinal"]) === undefined
      ? null
      : boolean(first(source, ["influenced", "included", "used", "influenced_decision", "influencedDecision", "used_in_final", "usedInFinal"]), false),
    influenceReason: string(first(source, ["influence_reason", "influenceReason", "reason"])),
    relevanceToPinkPaisa: string(first(source, ["relevance_to_pink_paisa", "relevanceToPinkPaisa", "influence_reason", "influenceReason", "recommendation_paths", "recommendationPaths"])),
    validationFlags: [
      ...strings(first(source, ["validation_flags", "validationFlags", "flags", "validation_reasons", "validationReasons"])),
      ...strings(first(source, ["prompt_injection_flags", "promptInjectionFlags"])),
    ],
  };
};

const normalizeSignal = (value: unknown): SocialSignal => {
  const signal = object(value);
  return {
    id: string(first(signal, ["id", "_id"])) || undefined,
    label: string(first(signal, ["label", "title", "name", "signal_type", "signalType"]), "Signal"),
    summary: string(first(signal, ["summary", "description", "value", "signal"])),
    relevance: string(first(signal, ["relevance", "trend_relevance", "trendRelevance"])),
    freshness: string(first(signal, ["freshness", "freshness_label", "freshnessLabel"])),
    confidence: number(first(signal, ["confidence", "confidence_score", "confidenceScore"])),
    included: first(signal, ["included", "influenced", "used"]) === undefined
      ? null
      : boolean(first(signal, ["included", "influenced", "used"]), false),
    reason: string(first(signal, ["reason", "influence_reason", "influenceReason", "exclusion_reason", "exclusionReason"])),
  };
};

const normalizeRecommendation = (value: unknown): SocialRecommendation => {
  const recommendation = object(value);
  const formatContent = object(first(recommendation, ["format_content", "formatContent"]));
  const onPostCopy = object(first(recommendation, ["on_post_copy", "onPostCopy"]));
  const singleImage = object(first(recommendation, ["single_image", "singleImage"]));
  const carousel = object(first(recommendation, ["carousel"]));
  const story = object(first(recommendation, ["story"]));
  const reel = object(first(recommendation, ["reel"]));
  const visualBrief = object(first(recommendation, ["visual_brief", "visualBrief"]));
  const visualAssets = array(first(visualBrief, ["assets"])).map(object);
  const verifiedProductFactsRaw = object(first(recommendation, ["verified_product_facts", "verifiedProductFacts"]));
  const canonicalOverlay = first(formatContent, ["overlay_instructions", "overlayInstructions"]);
  const overlayInstructionsRaw = object(canonicalOverlay
    ?? first(recommendation, ["overlay_instructions", "overlayInstructions"])
    ?? first(singleImage, ["overlay_instructions", "overlayInstructions"]));
  const visualConceptRaw = object(first(recommendation, ["visual_concept", "visualConcept"]));
  const utm = object(first(recommendation, ["utm_parameters", "utmParameters", "utm"]));
  const scoreBreakdownRaw = object(first(recommendation, ["score_breakdown", "scoreBreakdown"]));
  const scoreBreakdown = Object.fromEntries(
    Object.entries(scoreBreakdownRaw)
      .map(([key, value]) => [key, number(value)])
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
  const directScore = number(first(recommendation, ["score", "total_score", "totalScore"]));
  const score = directScore ?? number(first(scoreBreakdownRaw, ["total", "total_score", "final", "final_score"]));

  return {
    internalTitle: string(first(recommendation, ["internal_title", "internalTitle", "title"])),
    whyToday: string(first(formatContent, ["why_today", "whyToday"]) ?? first(recommendation, ["why_today", "whyToday", "rationale"])),
    objective: string(first(formatContent, ["objective"]) ?? first(recommendation, ["objective"]), "EDUCATION"),
    format: string(first(formatContent, ["format"]) ?? first(recommendation, ["format"])),
    formatReason: string(first(formatContent, ["format_reason", "formatReason"]) ?? first(recommendation, ["format_reason", "formatReason", "format_selection_reason", "formatSelectionReason"])),
    postType: string(first(formatContent, ["post_type", "postType"]) ?? first(recommendation, ["post_type", "postType"])),
    contentPillar: string(first(formatContent, ["content_pillar", "contentPillar"]) ?? first(recommendation, ["content_pillar", "contentPillar", "pillar"])),
    targetAudienceSegment: string(first(formatContent, ["target_audience", "targetAudience"]) ?? first(recommendation, ["target_audience_segment", "targetAudienceSegment", "target_audience", "targetAudience", "audience"])),
    topic: string(first(recommendation, ["topic"])),
    verifiedProductId: string(first(verifiedProductFactsRaw, ["id"]) ?? first(formatContent, ["verified_product_id", "verifiedProductId"]) ?? first(recommendation, ["verified_product_id", "verifiedProductId"])),
    verifiedProductTitle: string(first(verifiedProductFactsRaw, ["title"]) ?? first(formatContent, ["verified_product_title", "verifiedProductTitle"]) ?? first(recommendation, ["verified_product_title", "verifiedProductTitle"])),
    verifiedProductFacts: Object.keys(verifiedProductFactsRaw).length ? {
      id: string(first(verifiedProductFactsRaw, ["id"])),
      title: string(first(verifiedProductFactsRaw, ["title"])),
      brand: string(first(verifiedProductFactsRaw, ["brand"])),
      category: string(first(verifiedProductFactsRaw, ["category"])),
      subcategory: string(first(verifiedProductFactsRaw, ["subcategory", "sub_category", "subCategory"])),
      asin: string(first(verifiedProductFactsRaw, ["asin"])),
      imageUrl: string(first(verifiedProductFactsRaw, ["image_url", "imageUrl"])),
      description: string(first(verifiedProductFactsRaw, ["description"])),
      affiliateUrl: string(first(verifiedProductFactsRaw, ["affiliate_url", "affiliateUrl"])),
      landingPage: string(first(verifiedProductFactsRaw, ["landing_page", "landingPage"])),
    } : null,
    formatContent,
    visualBrief,
    hooks: strings(first(formatContent, ["hook_options", "hookOptions"]) ?? first(recommendation, ["hooks", "hook_options", "hookOptions", "hook"])),
    headline: string(first(formatContent, ["selected_headline", "selectedHeadline", "cover_headline", "coverHeadline"])
      ?? first(onPostCopy, ["headline"])
      ?? first(recommendation, ["selected_headline", "selectedHeadline", "cover_headline", "coverHeadline"])
      ?? first(singleImage, ["headline", "selected_headline", "selectedHeadline"])),
    supportingCopy: string(first(formatContent, ["supporting_text", "supportingText", "interaction_copy", "interactionCopy"])
      ?? first(onPostCopy, ["supporting_copy", "supportingCopy"])
      ?? first(recommendation, ["supporting_text", "supportingText", "interaction_copy", "interactionCopy"])
      ?? first(singleImage, ["supporting_text", "supportingText"])),
    slides: array(first(formatContent, ["slides"]) ?? first(carousel, ["slides"]) ?? first(recommendation, ["slides"]) ?? first(onPostCopy, ["slides"])).map((slideValue, index) => {
      const slide = object(slideValue);
      return {
        slideNumber: number(first(slide, ["slide_number", "slideNumber"])) ?? index + 1,
        headline: string(first(slide, ["headline", "title"])),
        body: string(first(slide, ["body", "copy"])),
        visualInstruction: string(first(slide, ["visual_instruction", "visualInstruction", "visual"])
          ?? first(slide, ["image_prompt", "imagePrompt"])),
        imagePrompt: string(first(slide, ["image_prompt", "imagePrompt"]) ?? first(slide, ["visual_instruction", "visualInstruction", "visual"])),
        overlayInstructions: string(first(slide, ["overlay_instructions", "overlayInstructions"])),
      };
    }),
    storyFrames: array(first(formatContent, ["frames"]) ?? first(story, ["frames", "story_frames", "storyFrames"]) ?? first(recommendation, ["frames", "story_frames", "storyFrames"]) ?? first(onPostCopy, ["story_frames", "storyFrames"])).map(object),
    reelScenes: array(first(formatContent, ["scenes"]) ?? first(reel, ["scenes", "reel_scenes", "reelScenes"]) ?? first(recommendation, ["scenes", "reel_scenes", "reelScenes"]) ?? first(onPostCopy, ["reel_scenes", "reelScenes"])).map(object),
    caption: string(first(formatContent, ["caption"]) ?? first(recommendation, ["caption"])),
    cta: string(first(formatContent, ["cta"]) ?? first(recommendation, ["cta", "call_to_action", "callToAction"])),
    hashtags: strings(first(formatContent, ["hashtags"]) ?? first(recommendation, ["hashtags"])),
    visualConcept: Object.fromEntries(
      Object.entries(visualConceptRaw).map(([key, item]) => [key, string(item)]),
    ),
    imageGenerationPrompt: string(first(formatContent, ["image_prompt", "imagePrompt", "cover_image_prompt", "coverImagePrompt"])
      ?? first(visualAssets[0] || {}, ["image_prompt", "imagePrompt", "prompt"])
      ?? first(recommendation, ["image_generation_prompt", "imageGenerationPrompt", "image_prompt", "imagePrompt", "cover_image_prompt", "coverImagePrompt", "visual_prompt", "visualPrompt"])
      ?? first(singleImage, ["image_prompt", "imagePrompt"])
      ?? first(visualBrief, ["image_prompt", "imagePrompt", "prompt"])),
    negativeVisualInstructions: strings(first(formatContent, ["negative_visual_instructions", "negativeVisualInstructions"])
      ?? first(recommendation, ["negative_visual_instructions", "negativeVisualInstructions"])
      ?? first(visualBrief, ["negative_visual_instructions", "negativeVisualInstructions", "avoid"])),
    overlayInstructions: Object.fromEntries(Object.entries(overlayInstructionsRaw).map(([key, item]) => [key, string(item)])),
    altText: string(first(formatContent, ["alt_text", "altText"]) ?? first(recommendation, ["alt_text", "altText"])),
    financialDisclaimer: string(first(formatContent, ["financial_disclaimer", "financialDisclaimer"]) ?? first(recommendation, ["financial_disclaimer", "financialDisclaimer", "disclaimer"])),
    affiliateDisclosure: string(first(formatContent, ["affiliate_disclosure", "affiliateDisclosure"]) ?? first(recommendation, ["affiliate_disclosure", "affiliateDisclosure"])),
    recommendedLandingPage: string(first(formatContent, ["recommended_landing_page", "recommendedLandingPage"]) ?? first(recommendation, ["recommended_landing_page", "recommendedLandingPage", "landing_page", "landingPage"])),
    utmParameters: {
      source: string(first(utm, ["source", "utm_source", "utmSource"]), "instagram"),
      medium: string(first(utm, ["medium", "utm_medium", "utmMedium"]), "organic_social"),
      campaign: string(first(utm, ["campaign", "utm_campaign", "utmCampaign"])),
      content: string(first(utm, ["content", "utm_content", "utmContent"])),
    },
    sources: array(first(recommendation, ["sources", "research_sources", "researchSources"])).map(normalizeSource),
    confidence: number(first(recommendation, ["confidence", "confidence_score", "confidenceScore"])),
    riskFlags: strings(first(recommendation, ["risk_flags", "riskFlags", "risks"])),
    scoreBreakdown,
    score,
    rationale: string(first(recommendation, ["selection_rationale", "selectionRationale", "rationale"])),
  };
};

const normalizeAsset = (value: unknown): SocialAsset => {
  const asset = object(value);
  const provenance = object(first(asset, ["provenance"]));
  const original = object(first(asset, ["original_visual", "originalVisual", "ai_visual", "aiVisual"]) ?? first(provenance, ["base_image", "baseImage", "original_visual", "originalVisual"]));
  const finalComposed = object(first(asset, ["final_composed", "finalComposed", "composed_asset", "composedAsset"]));
  const generationAttempt = object(first(asset, ["image_generation", "imageGeneration", "generation"])
    ?? first(provenance, ["image_generation", "imageGeneration", "image_generation_attempt", "imageGenerationAttempt"]));
  const checklistFlags = array(first(asset, ["validation_checklist", "validationChecklist"]))
    .map(object)
    .filter((check) => string(first(check, ["status"])).toUpperCase() !== "PASS")
    .map((check) => string(first(check, ["label", "key", "details"])))
    .filter(Boolean);
  return {
    id: string(first(asset, ["id", "_id"])) || undefined,
    type: string(first(asset, ["type", "asset_type", "assetType"]), "creative"),
    role: string(first(asset, ["role", "asset_role", "assetRole"]), "FINAL_COMPOSED"),
    slideNumber: number(first(asset, ["slide_number", "slideNumber"])),
    url: portableMediaUrl(first(finalComposed, ["url", "public_url", "publicUrl"]) ?? first(asset, ["url", "public_url", "publicUrl", "asset_url", "assetUrl"])),
    previewUrl: portableMediaUrl(first(finalComposed, ["preview_url", "previewUrl", "url"]) ?? first(asset, ["preview_url", "previewUrl", "thumbnail_url", "thumbnailUrl", "url", "public_url"])),
    originalUrl: portableMediaUrl(first(original, ["url", "source_url", "sourceUrl", "public_url", "publicUrl", "original_asset_url", "originalAssetUrl"])
      ?? first(asset, ["original_asset_url", "originalAssetUrl", "original_url", "originalUrl"])),
    finalUrl: portableMediaUrl(first(finalComposed, ["url", "public_url", "publicUrl"]) ?? first(asset, ["final_url", "finalUrl", "url", "public_url", "publicUrl"])),
    aspectRatio: string(first(asset, ["aspect_ratio", "aspectRatio"]), "4:5"),
    width: number(first(asset, ["width"])),
    height: number(first(asset, ["height"])),
    mediaKind: string(first(asset, ["media_kind", "mediaKind"]), "IMAGE"),
    mimeType: string(first(asset, ["mime_type", "mimeType"])),
    durationSeconds: number(first(asset, ["duration_seconds", "durationSeconds"])),
    renderer: string(first(asset, ["renderer"]) ?? first(finalComposed, ["renderer"])),
    visualMode: storedVisualMode(first(asset, ["visual_mode", "visualMode"])),
    provider: string(first(asset, ["image_provider", "imageProvider"]) ?? first(generationAttempt, ["provider"]) ?? first(original, ["provider"])),
    model: string(first(asset, ["image_model", "imageModel"]) ?? first(generationAttempt, ["model"]) ?? first(original, ["model"])),
    responseId: string(first(asset, ["image_response_id", "imageResponseId", "provider_response_id", "providerResponseId"])
      ?? first(generationAttempt, ["response_id", "responseId"])
      ?? first(original, ["response_id", "responseId"])),
    prompt: string(first(asset, ["image_prompt", "imagePrompt"])
      ?? first(generationAttempt, ["prompt", "image_prompt", "imagePrompt"])
      ?? first(original, ["prompt"])),
    generationStatus: string(first(asset, ["image_generation_status", "imageGenerationStatus"])
      ?? first(generationAttempt, ["status", "generation_status", "generationStatus"])
      ?? first(original, ["status", "generation_status", "generationStatus"])),
    generationAttempts: number(first(asset, ["image_attempt_count", "imageAttemptCount", "image_retry_number", "imageRetryNumber"])
      ?? first(generationAttempt, ["attempt_count", "attemptCount", "attempts"])) ?? 0,
    sourceProvenance: string(first(asset, ["source_provenance", "sourceProvenance"]) ?? first(original, ["source_provenance", "sourceProvenance"])),
    provenance,
    status: string(first(asset, ["status", "validation_status", "validationStatus"]), "draft"),
    manualReviewRequired: boolean(first(asset, ["manual_review_required", "manualReviewRequired"]), false),
    manualReviewStatus: string(first(asset, ["manual_review_status", "manualReviewStatus"])),
    validationFlags: [
      ...strings(first(asset, ["validation_flags", "validationFlags", "risk_flags", "riskFlags", "manual_review_flags", "manualReviewFlags"])),
      ...checklistFlags,
    ],
  };
};

const normalizeAuditEvent = (value: unknown): SocialAuditEvent => {
  const event = object(value);
  const actor = object(first(event, ["actor", "admin", "user"]));
  return {
    id: string(first(event, ["id", "_id"])) || undefined,
    action: string(first(event, ["action", "event", "type"]), "updated"),
    actor: string(first(event, ["actor_email", "actorEmail", "admin_email", "adminEmail"]))
      || string(first(actor, ["email", "name"]))
      || "System",
    summary: string(first(event, ["summary", "description", "message", "notes"])),
    createdAt: dateString(first(event, ["created_at", "createdAt", "timestamp"])),
    metadata: object(first(event, ["metadata", "details", "changes"])),
  };
};

const normalizeMetricSnapshot = (value: unknown): SocialMetricSnapshot => {
  const snapshot = object(value);
  const metricsRaw = object(first(snapshot, ["metrics", "values", "snapshot"]));
  const metrics = Object.fromEntries(
    Object.entries(metricsRaw)
      .map(([key, item]) => [key, number(item)])
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
  return {
    id: string(first(snapshot, ["id", "_id"])) || undefined,
    source: string(first(snapshot, ["source"]), "manual"),
    capturedAt: dateString(first(snapshot, ["captured_at", "capturedAt", "created_at", "createdAt"])),
    notes: string(first(snapshot, ["notes", "provenance_note", "provenanceNote"])),
    metrics,
  };
};

const normalizeStatus = (value: unknown): SocialDraftStatus => {
  const normalized = string(value, "DRAFT").toUpperCase().replace(/[-\s]+/g, "_");
  const aliases: Record<string, SocialDraftStatus> = {
    WAITING_REVIEW: "NEEDS_REVIEW",
    IN_REVIEW: "NEEDS_REVIEW",
    APPROVED_FOR_PUBLISH: "APPROVED",
    QUEUED: "SCHEDULED",
    IMAGE_FAILED: "FAILED_IMAGE",
    COMPLIANCE_FAILED: "FAILED_COMPLIANCE",
    PUBLISH_FAILED: "FAILED_PUBLISHING",
  };
  return aliases[normalized] || normalized as SocialDraftStatus;
};

export const normalizeGenerationRun = (value: unknown): SocialGenerationRun | null => {
  const run = object(value);
  if (!Object.keys(run).length) return null;
  const usage = object(first(run, ["usage"]));
  const error = object(first(run, ["last_error", "lastError"]));
  const generationRequest = object(first(run, ["generation_request", "generationRequest"]));
  const rawStatus = string(first(run, ["status"]), "PENDING").toUpperCase().replace(/[-\s]+/g, "_");
  const status = (["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "FAILED_RESEARCH", "FAILED_GENERATION", "FAILED_IMAGE", "FAILED_COMPLIANCE", "FAILED_IMAGE_GENERATION", "FAILED_PUBLISHING"].includes(rawStatus)
    ? rawStatus
    : "FAILED") as SocialGenerationRun["status"];

  return {
    id: string(first(run, ["id", "_id"])),
    status,
    currentStage: string(first(run, ["current_stage", "currentStage"])),
    generationRequest: Object.keys(generationRequest).length ? {
      requestedFormat: string(first(generationRequest, ["requested_format", "requestedFormat"]), "AUTO_CHOOSE") as NonNullable<SocialGenerationRun["generationRequest"]>["requestedFormat"],
      requestedPostType: string(first(generationRequest, ["requested_post_type", "requestedPostType"])),
      generationScope: string(first(generationRequest, ["generation_scope", "generationScope"]), "FULL_POST") as NonNullable<SocialGenerationRun["generationRequest"]>["generationScope"],
      visualMode: string(first(generationRequest, ["visual_mode", "visualMode"]), "AI_VISUAL_WITH_EXACT_OVERLAY") as NonNullable<SocialGenerationRun["generationRequest"]>["visualMode"],
      adminInstructions: string(first(generationRequest, ["admin_instructions", "adminInstructions"])),
      verifiedProductId: string(first(generationRequest, ["verified_product_id", "verifiedProductId"])),
      requestId: string(first(generationRequest, ["request_id", "requestId"])),
    } : null,
    generationMode: string(first(run, ["generation_mode", "generationMode"])),
    fullAiGeneration: boolean(first(run, ["full_ai_generation", "fullAiGeneration"]), true),
    imageGenerationStatus: string(first(run, ["image_generation_status", "imageGenerationStatus"]), "NOT_STARTED"),
    generationDate: string(first(run, ["generation_date", "generationDate"])),
    triggerType: string(first(run, ["trigger_type", "triggerType"])),
    attemptCount: number(first(run, ["attempt_count", "attemptCount"])) ?? 0,
    retryCount: number(first(run, ["retry_count", "retryCount"])) ?? 0,
    maxAttempts: number(first(run, ["max_attempts", "maxAttempts"])) ?? 0,
    nextRetryAt: dateString(first(run, ["next_retry_at", "nextRetryAt"])),
    retryOfGenerationRunId: string(first(run, ["retry_of_generation_run_id", "retryOfGenerationRunId"])),
    supersededByGenerationRunId: string(first(run, ["superseded_by_generation_run_id", "supersededByGenerationRunId"])),
    supersededAt: dateString(first(run, ["superseded_at", "supersededAt"])),
    recoveryArchivedAt: dateString(first(run, ["recovery_archived_at", "recoveryArchivedAt"])),
    recoveryArchiveReason: string(first(run, ["recovery_archive_reason", "recoveryArchiveReason"])),
    queuedAt: dateString(first(run, ["queued_at", "queuedAt"])),
    startedAt: dateString(first(run, ["started_at", "startedAt"])),
    completedAt: dateString(first(run, ["completed_at", "completedAt", "finished_at", "finishedAt"])),
    candidateCount: number(first(run, ["candidate_count", "candidateCount"])) ?? 0,
    candidates: array(first(run, ["candidate_summaries", "candidateSummaries", "candidates"])).map((candidateValue) => {
      const candidate = object(candidateValue);
      return {
        id: string(first(candidate, ["candidate_id", "candidateId", "id"])),
        topic: string(first(candidate, ["topic"])),
        contentPillar: string(first(candidate, ["content_pillar", "contentPillar"])),
        format: string(first(candidate, ["format"])),
        totalScore: number(first(candidate, ["total_score", "totalScore", "score"])),
        disposition: string(first(candidate, ["disposition"])),
        rejectionReason: string(first(candidate, ["rejection_reason", "rejectionReason"])),
        riskFlags: strings(first(candidate, ["risk_flags", "riskFlags"])),
        hook: string(first(candidate, ["hook"])),
        objective: string(first(candidate, ["objective"])),
        targetAudience: string(first(candidate, ["target_audience", "targetAudience", "target_audience_segment", "targetAudienceSegment"])),
        whyToday: string(first(candidate, ["why_today", "whyToday"])),
      };
    }),
    stages: array(first(run, ["stage_executions", "stageExecutions", "stages"])).map((stageValue) => {
      const stage = object(stageValue);
      return {
        stage: string(first(stage, ["stage"])),
        status: string(first(stage, ["status"])),
        provider: string(first(stage, ["provider"])),
        model: string(first(stage, ["model"])),
        promptVersion: string(first(stage, ["prompt_semantic_version", "promptSemanticVersion", "runtime_prompt_version", "runtimePromptVersion", "prompt_version", "promptVersion"])),
        inputTokens: number(first(stage, ["input_tokens", "inputTokens"])) ?? 0,
        outputTokens: number(first(stage, ["output_tokens", "outputTokens"])) ?? 0,
        totalTokens: number(first(stage, ["total_tokens", "totalTokens"])) ?? 0,
        estimatedCost: number(first(stage, ["estimated_cost", "estimatedCost"])) ?? 0,
        costCurrency: string(first(stage, ["cost_currency", "costCurrency"]), "USD"),
        attemptCount: number(first(stage, ["attempt_count", "attemptCount"])) ?? 0,
        errorCode: string(first(stage, ["error_code", "errorCode"])),
        errorMessage: string(first(stage, ["error_message", "errorMessage"])),
      };
    }),
    usage: {
      inputTokens: number(first(usage, ["input_tokens", "inputTokens"])) ?? 0,
      outputTokens: number(first(usage, ["output_tokens", "outputTokens"])) ?? 0,
      totalTokens: number(first(usage, ["total_tokens", "totalTokens"])) ?? 0,
      estimatedCost: number(first(usage, ["estimated_cost", "estimatedCost"])) ?? 0,
      costCurrency: string(first(usage, ["cost_currency", "costCurrency"]), "USD"),
    },
    lastError: Object.keys(error).length ? {
      stage: string(first(error, ["stage"])),
      code: string(first(error, ["code"])),
      message: string(first(error, ["message"])),
      isRetriable: boolean(first(error, ["is_retriable", "isRetriable"]), false),
      occurredAt: dateString(first(error, ["occurred_at", "occurredAt"])),
      details: first(error, ["details"]),
    } : null,
  };
};

export const normalizeReadiness = (value: unknown): SocialReadiness => {
  const readiness = object(value);
  const legacyGenerationEnabled = boolean(
    first(readiness, ["generation_enabled", "generationEnabled"]),
    EMPTY_READINESS.generationEnabled,
  );
  return {
    generationEnabled: legacyGenerationEnabled,
    manualGenerationEnabled: boolean(
      first(readiness, ["manual_generation_enabled", "manualGenerationEnabled"]),
      legacyGenerationEnabled,
    ),
    researchMode: string(first(readiness, ["research_mode", "researchMode"]), EMPTY_READINESS.researchMode),
    aiConfigured: boolean(first(readiness, ["ai_configured", "aiConfigured"]), EMPTY_READINESS.aiConfigured),
    publishingEnabled: boolean(first(readiness, ["publishing_enabled", "publishingEnabled"]), EMPTY_READINESS.publishingEnabled),
    instagramConnected: boolean(first(readiness, ["instagram_connected", "instagramConnected"]), EMPTY_READINESS.instagramConnected),
    blockers: strings(first(readiness, ["blockers", "readiness_blockers", "readinessBlockers"])),
    warnings: strings(first(readiness, ["warnings"])),
  };
};

export const normalizeTodayResponse = (value: unknown): {
  draft: SocialDraft | null;
  previousDraft: SocialDraft | null;
  generationRun: SocialGenerationRun | null;
  readiness: SocialReadiness;
  date: string;
  timezone: string;
} => {
  const response = object(object(value).data || value);
  const draft = normalizeDraft(first(response, ["draft", "item", "today_draft", "todayDraft"]));
  const previousDraft = normalizeDraft(first(response, ["previous_draft", "previousDraft"]));
  const generationRun = normalizeGenerationRun(first(response, ["generation_run", "generationRun"]));
  if (draft) {
    const latestModelStage = [...(generationRun?.stages || [])].reverse().find((stage) => stage.model || stage.promptVersion);
    if (!draft.promptVersion) draft.promptVersion = latestModelStage?.promptVersion || "";
    if (!draft.model) draft.model = latestModelStage?.model || "";
  }
  return {
    draft,
    previousDraft,
    generationRun,
    readiness: normalizeReadiness(first(response, ["readiness"])),
    date: string(first(response, ["date", "generation_date", "generationDate"])),
    timezone: string(first(response, ["timezone"]), "Asia/Kolkata"),
  };
};

export const normalizeDraft = (value: unknown): SocialDraft | null => {
  const draft = object(value);
  if (!Object.keys(draft).length) return null;
  const packageValue = first(draft, ["current_package", "currentPackage", "result", "content_package", "contentPackage"]);
  const contentPackage = object(packageValue);
  const primaryValue = first(contentPackage, ["primary_recommendation", "primaryRecommendation", "recommendation"])
    ?? first(draft, ["primary_recommendation", "primaryRecommendation", "recommendation"]);
  const primary = normalizeRecommendation(primaryValue);
  const id = string(first(draft, ["id", "_id"]));
  if (!id && !primary.topic && !primary.internalTitle) return null;
  const alternatives = array(
    first(contentPackage, ["alternative_recommendations", "alternativeRecommendations", "alternatives"])
      ?? first(draft, ["alternative_recommendations", "alternativeRecommendations", "alternatives"]),
  ).map((item) => ({ ...normalizeRecommendation(item), id: string(first(object(item), ["id", "_id"])) || undefined } as SocialAlternative));
  const sources = array(first(draft, ["research_sources", "researchSources", "sources"])).map(normalizeSource);
  const research = object(first(draft, ["research", "research_summary", "researchSummary"]));
  const schedule = object(first(draft, ["schedule"]));
  const auditLogs = array(first(draft, ["audit_logs", "auditLogs", "audit"])).map(normalizeAuditEvent);
  const metrics = array(first(draft, ["metric_snapshots", "metricSnapshots", "metrics"])).map(normalizeMetricSnapshot);
  const manualActions = array(first(draft, ["manual_actions", "manualActions"])).map(normalizeManualAction);
  const captionContract = object(first(draft, ["caption_contract", "captionContract"]));
  const captionComponents = object(first(captionContract, ["components"]));

  return {
    id,
    status: normalizeStatus(first(draft, ["status"])),
    generationDate: string(first(draft, ["generation_date", "generationDate"]) ?? first(contentPackage, ["generation_date", "generationDate"])),
    timezone: string(first(draft, ["timezone"]) ?? first(contentPackage, ["timezone"]), "Asia/Kolkata"),
    revision: number(first(draft, ["revision"])),
    generationMode: string(first(draft, ["generation_mode", "generationMode"]), "FULL_AI"),
    visualMode: storedVisualMode(first(draft, ["visual_mode", "visualMode"])),
    fullAiReady: boolean(first(draft, ["full_ai_ready", "fullAiReady"]), false),
    visualModeResolution: normalizeVisualModeResolution(
      first(draft, ["visual_mode_resolution", "visualModeResolution"]),
      visualMode(first(draft, ["visual_mode", "visualMode"])),
    ),
    primary: {
      ...primary,
      sources: primary.sources.length ? primary.sources : sources,
    },
    captionContract: Object.keys(captionContract).length ? {
      policy: string(first(captionContract, ["policy"])),
      caption: first(captionContract, ["caption"]) === null ? null : string(first(captionContract, ["caption"])),
      checksumSha256: string(first(captionContract, ["checksum_sha256", "checksumSha256"])),
      components: {
        affiliateDisclosure: string(first(captionComponents, ["affiliate_disclosure", "affiliateDisclosure"])),
        caption: string(first(captionComponents, ["caption"])),
        cta: string(first(captionComponents, ["cta"])),
        financialDisclaimer: string(first(captionComponents, ["financial_disclaimer", "financialDisclaimer"])),
        hashtags: string(first(captionComponents, ["hashtags"])),
      },
      componentOrder: strings(first(captionContract, ["component_order", "componentOrder"])),
      length: number(first(captionContract, ["length"])) ?? 0,
      violations: strings(first(captionContract, ["violations"])),
      valid: boolean(first(captionContract, ["valid"]), false),
    } : null,
    alternatives,
    rejectedIdeas: array(first(contentPackage, ["rejected_ideas", "rejectedIdeas"]) ?? first(draft, ["rejected_ideas", "rejectedIdeas"]))
      .map((item) => {
        const rejected = object(item);
        return {
          topic: string(first(rejected, ["topic"])),
          reasonRejected: string(first(rejected, ["reason_rejected", "reasonRejected", "reason"])),
        };
      }),
    assets: array(first(draft, ["assets"])).map(normalizeAsset),
    audioTrackId: string(first(draft, ["audio_track_id", "audioTrackId"])),
    selectedAudioTrack: Object.keys(object(first(draft, ["selected_audio_track", "selectedAudioTrack"]))).length
      ? object(first(draft, ["selected_audio_track", "selectedAudioTrack"]))
      : null,
    approval: Object.keys(object(first(draft, ["approval"]))).length ? object(first(draft, ["approval"])) : null,
    schedule: Object.keys(schedule).length ? schedule : null,
    publication: Object.keys(object(first(draft, ["publication"]))).length ? object(first(draft, ["publication"])) : null,
    compliance: Object.keys(object(first(draft, ["compliance", "compliance_review", "complianceReview", "compliance_summary", "complianceSummary"]))).length
      ? object(first(draft, ["compliance", "compliance_review", "complianceReview", "compliance_summary", "complianceSummary"]))
      : null,
    generationRunId: string(first(draft, ["generation_run_id", "generationRunId"])),
    weeklyPlanId: string(first(draft, ["weekly_plan_id", "weeklyPlanId"])),
    weeklyPlanItemId: string(first(draft, ["weekly_plan_item_id", "weeklyPlanItemId", "plan_item_id", "planItemId"])),
    candidateId: string(first(draft, ["candidate_id", "candidateId"])),
    bundleId: string(first(draft, ["bundle_id", "bundleId"])),
    bundleRole: string(first(draft, ["bundle_role", "bundleRole"])),
    parentDraftId: string(first(draft, ["parent_draft_id", "parentDraftId"])),
    weeklySlotNumber: number(first(draft, ["weekly_slot_number", "weeklySlotNumber"])),
    weekStart: string(first(draft, ["week_start", "weekStart"])),
    weekEnd: string(first(draft, ["week_end", "weekEnd"])),
    lastError: Object.keys(object(first(draft, ["last_error", "lastError"]))).length ? object(first(draft, ["last_error", "lastError"])) : null,
    duplicateAnalysis: Object.keys(object(first(draft, ["duplicate_analysis", "duplicateAnalysis"]))).length
      ? object(first(draft, ["duplicate_analysis", "duplicateAnalysis"]))
      : null,
    marketAnalysis: Object.keys(object(first(draft, ["market_analysis", "marketAnalysis", "daily_analysis", "dailyAnalysis"])
      ?? first(contentPackage, ["market_analysis", "marketAnalysis", "daily_analysis", "dailyAnalysis"]))).length
      ? object(first(draft, ["market_analysis", "marketAnalysis", "daily_analysis", "dailyAnalysis"])
        ?? first(contentPackage, ["market_analysis", "marketAnalysis", "daily_analysis", "dailyAnalysis"]))
      : null,
    strategySelection: Object.keys(object(first(draft, ["strategy_selection", "strategySelection"])
      ?? first(contentPackage, ["strategy_selection", "strategySelection"]))).length
      ? object(first(draft, ["strategy_selection", "strategySelection"])
        ?? first(contentPackage, ["strategy_selection", "strategySelection"]))
      : null,
    sources: sources.length ? sources : primary.sources,
    internalSignals: array(first(research, ["internal_signals", "internalSignals"]) ?? first(draft, ["internal_signals", "internalSignals"]))
      .map(normalizeSignal),
    externalSignals: array(first(research, ["external_signals", "externalSignals", "signals"]) ?? first(draft, ["external_signals", "externalSignals"]))
      .map(normalizeSignal),
    auditLogs,
    metricSnapshots: metrics,
    manualActions,
    scheduledFor: string(first(schedule, ["scheduled_for", "scheduledFor", "publish_at", "publishAt"]) ?? first(draft, ["scheduled_for", "scheduledFor"])),
    promptVersion: string(first(draft, ["prompt_version", "promptVersion"]) ?? first(contentPackage, ["prompt_version", "promptVersion"])),
    model: string(first(draft, ["model", "ai_model", "aiModel"]) ?? first(contentPackage, ["model", "ai_model", "aiModel"])),
    createdAt: dateString(first(draft, ["created_at", "createdAt"])),
    updatedAt: dateString(first(draft, ["updated_at", "updatedAt"])),
  };
};

export const normalizeManualAction = (value: unknown): SocialManualAction => {
  const action = object(value);
  return {
    id: string(first(action, ["id", "_id"])),
    actionKey: string(first(action, ["action_key", "actionKey"])),
    actionType: string(first(action, ["action_type", "actionType"])),
    status: string(first(action, ["status"]), "OPEN").toUpperCase(),
    priority: string(first(action, ["priority"]), "MEDIUM").toUpperCase(),
    title: string(first(action, ["title"])),
    description: string(first(action, ["description"])),
    instructions: strings(first(action, ["instructions"])),
    provider: string(first(action, ["provider"])),
    draftId: string(first(action, ["draft_id", "draftId"])),
    weeklyPlanId: string(first(action, ["weekly_plan_id", "weeklyPlanId"])),
    generationRunId: string(first(action, ["generation_run_id", "generationRunId"])),
    publicationId: string(first(action, ["publication_id", "publicationId"])),
    communityItemId: string(first(action, ["community_item_id", "communityItemId"])),
    connectionHealthId: string(first(action, ["connection_health_id", "connectionHealthId"])),
    externalReferenceId: string(first(action, ["external_reference_id", "externalReferenceId"])),
    dueAt: dateString(first(action, ["due_at", "dueAt"])),
    resolutionNote: string(first(action, ["resolution_note", "resolutionNote"])),
    cancellationReason: string(first(action, ["cancellation_reason", "cancellationReason"])),
    completionSource: string(first(action, ["completion_source", "completionSource"]), "ADMIN").toUpperCase(),
    resolutionEvidence: object(first(action, ["resolution_evidence", "resolutionEvidence"])),
    createdAt: dateString(first(action, ["created_at", "createdAt"])),
    updatedAt: dateString(first(action, ["updated_at", "updatedAt"])),
  };
};

export const normalizeManualActionsResponse = (value: unknown): SocialManualAction[] => {
  const response = object(object(value).data || value);
  return array(first(response, ["items", "manual_actions", "manualActions", "results"]) ?? value)
    .map(normalizeManualAction)
    .filter((action) => Boolean(action.id));
};

export const normalizeDraftList = (value: unknown): SocialDraft[] => {
  const response = object(object(value).data || value);
  return array(first(response, ["items", "drafts", "results"]) ?? value)
    .map(normalizeDraft)
    .filter((item): item is SocialDraft => Boolean(item));
};

const connectionLabels: Record<string, string> = {
  internal_data: "Pink Paisa data",
  openai: "OpenAI",
  instagram: "Instagram / Meta",
  meta_webhooks: "Meta webhooks",
  ga4: "Google Analytics 4",
  search_console: "Search Console",
  n8n: "n8n orchestration",
  research_sources: "Research sources",
};

const normalizeConnection = (value: unknown, fallbackKey = "connection"): SocialConnection => {
  const connection = object(value);
  const key = string(first(connection, ["key", "id", "provider", "type"]), fallbackKey).toLowerCase();
  const capabilitiesValue = first(connection, ["capabilities", "capability_matrix", "capabilityMatrix"]);
  const capabilityDetail = (capability: UnknownRecord) => {
    const explanation = string(first(capability, ["detail", "message", "reason", "limitation"]));
    const requirements = strings(first(capability, ["requirements", "required_scopes", "requiredScopes"]));
    return [explanation, requirements.length ? `Requires: ${requirements.join(", ")}` : ""].filter(Boolean).join(" · ");
  };
  const capabilities = Array.isArray(capabilitiesValue)
    ? capabilitiesValue.map((item, index) => {
      const capability = object(item);
      const availableValue = first(capability, ["available", "enabled"]);
      const supportedValue = availableValue === undefined ? first(capability, ["supported"]) : availableValue;
      return {
        key: string(first(capability, ["key", "id", "name"]), `capability-${index + 1}`),
        label: string(first(capability, ["label", "name", "key"]), `Capability ${index + 1}`),
        supported: supportedValue === undefined ? null : boolean(supportedValue, false),
        status: string(first(capability, ["status"])),
        detail: capabilityDetail(capability),
      };
    })
    : Object.entries(object(capabilitiesValue)).map(([capabilityKey, capabilityValue]) => {
      const capability = object(capabilityValue);
      const scalar = typeof capabilityValue === "boolean" ? capabilityValue : undefined;
      const availableValue = first(capability, ["available", "enabled"]);
      const supportedValue = scalar ?? (availableValue === undefined ? first(capability, ["supported"]) : availableValue);
      return {
        key: capabilityKey,
        label: string(first(capability, ["label", "name"]), capabilityKey.replace(/_/g, " ")),
        supported: supportedValue === undefined ? null : boolean(supportedValue, false),
        status: string(first(capability, ["status"])),
        detail: capabilityDetail(capability),
      };
    });
  const connected = boolean(first(connection, ["connected", "is_connected", "isConnected"]), false);
  const configured = boolean(first(connection, ["configured", "is_configured", "isConfigured"]), connected);
  return {
    key,
    label: string(first(connection, ["label", "name"]), connectionLabels[key] || key.replace(/_/g, " ")),
    status: string(first(connection, ["status", "state", "health"]), connected ? "CONNECTED" : configured ? "CONFIGURED" : "NOT_CONFIGURED"),
    connected,
    configured,
    accountLabel: string(first(connection, ["account_label", "accountLabel", "instagram_username", "instagramUsername", "property_name", "propertyName", "site_url", "siteUrl"])),
    lastCheckedAt: dateString(first(connection, ["last_checked_at", "lastCheckedAt", "checked_at", "checkedAt", "last_connected_at", "lastConnectedAt"])),
    expiresAt: dateString(first(connection, ["expires_at", "expiresAt", "token_expires_at", "tokenExpiresAt"])),
    error: string(first(connection, ["error", "last_error", "lastError", "message"])),
    warnings: strings(first(connection, ["warnings"])),
    capabilities,
    metadata: connection,
  };
};

export const normalizeConnectionsResponse = (value: unknown): SocialConnectionsSnapshot => {
  const response = object(unwrapData(value));
  const connectionsValue = first(response, ["connections", "providers", "items"]);
  const connectionRoot = object(connectionsValue ?? response);
  const rows = Array.isArray(connectionsValue)
    ? connectionsValue.map((item) => ["connection", item] as const)
    : Object.entries(connectionRoot).filter(([, item]) => item && typeof item === "object" && !Array.isArray(item));
  return {
    items: rows.map(([key, item]) => normalizeConnection(item, key)),
    checkedAt: dateString(first(response, ["checked_at", "checkedAt", "generated_at", "generatedAt"])),
    blockers: strings(first(response, ["blockers"])),
    warnings: strings(first(response, ["warnings"])),
  };
};

const normalizeCandidateSummary = (value: unknown, index = 0) => {
  const candidate = object(value);
  return {
    id: string(first(candidate, ["id", "candidate_id", "candidateId"]), `candidate-${index + 1}`),
    topic: string(first(candidate, ["topic", "title"])),
    contentPillar: string(first(candidate, ["content_pillar", "contentPillar"])),
    format: string(first(candidate, ["format", "recommended_format", "recommendedFormat"])),
    totalScore: number(first(candidate, ["total_score", "totalScore", "score"])),
    disposition: string(first(candidate, ["disposition", "selection", "status"])),
    rejectionReason: string(first(candidate, ["rejection_reason", "rejectionReason", "reason_rejected", "reasonRejected"])),
    riskFlags: strings(first(candidate, ["risk_flags", "riskFlags"])),
    hook: string(first(candidate, ["hook", "selected_hook", "selectedHook"])),
    objective: string(first(candidate, ["objective"])),
    targetAudience: string(first(candidate, ["target_audience", "targetAudience", "audience_segment", "audienceSegment"])),
    whyToday: string(first(candidate, ["why_this_week", "whyThisWeek", "why_today", "whyToday"])),
    visualModeResolution: normalizeVisualModeResolution(first(candidate, ["visual_mode_resolution", "visualModeResolution"])),
  };
};

export const normalizeWeeklyPlanResponse = (value: unknown): SocialWeeklyPlan | null => {
  const response = object(unwrapData(value));
  const plan = object(first(response, ["plan", "weekly_plan", "weeklyPlan", "current"]) ?? response);
  const itemValues = array(first(plan, ["items", "posts", "selected_posts", "selectedPosts", "recommendations"]));
  const storyValues = array(first(plan, ["story_plan", "storyPlan", "stories"]));
  if (!Object.keys(plan).length || (!string(first(plan, ["id", "_id"])) && !itemValues.length)) return null;
  const sources = array(first(plan, ["sources", "research_sources", "researchSources"])).map(normalizeSource);
  const generationErrorValue = first(plan, ["generation_error", "generationError"]);
  const generationError = object(generationErrorValue);
  const configSnapshot = object(first(plan, ["config_snapshot", "configSnapshot"]));
  const contentMixValue = first(configSnapshot, ["content_mix_snapshot", "contentMixSnapshot"])
    ?? first(plan, ["content_mix_snapshot", "contentMixSnapshot"]);
  const contentMix = object(contentMixValue);
  return {
    id: string(first(plan, ["id", "_id"])),
    status: string(first(plan, ["status"]), "PLANNED").toUpperCase(),
    weekStart: string(first(plan, ["week_start", "weekStart", "start_date", "startDate"])),
    weekEnd: string(first(plan, ["week_end", "weekEnd", "end_date", "endDate"])),
    timezone: string(first(plan, ["timezone"]), "Asia/Kolkata"),
    maxFeedPosts: number(first(plan, ["max_feed_posts", "maxFeedPosts", "maximum_feed_posts", "maximumFeedPosts", "publication_maximum", "publicationMaximum"])) ?? 5,
    rationale: string(first(plan, ["rationale", "concise_rationale", "conciseRationale", "why_this_week", "whyThisWeek"])),
    version: number(first(plan, ["version"])) ?? 1,
    items: itemValues.map((itemValue, index) => {
      const item = object(itemValue);
      const recommendation = normalizeRecommendation(first(item, ["recommendation", "content", "content_package", "contentPackage"]) ?? item);
      return {
        id: string(first(item, ["id", "_id", "plan_item_id", "planItemId"]), `post-${index + 1}`),
        order: number(first(item, ["order", "sequence", "position", "slot_number", "slotNumber"])) ?? index + 1,
        status: normalizeStatus(first(item, ["status"])),
        topic: string(first(item, ["topic"]), recommendation.topic),
        internalTitle: string(first(item, ["internal_title", "internalTitle", "title"]), recommendation.internalTitle),
        objective: string(first(item, ["objective"]), recommendation.objective),
        primaryKpi: string(first(item, ["primary_kpi", "primaryKpi"])),
        secondaryKpi: string(first(item, ["secondary_kpi", "secondaryKpi"])),
        targetAudience: string(first(item, ["target_audience", "targetAudience", "audience_segment", "audienceSegment"]), recommendation.targetAudienceSegment),
        contentPillar: string(first(item, ["content_pillar", "contentPillar"]), recommendation.contentPillar),
        format: string(first(item, ["format"]), recommendation.format),
        whyThisWeek: string(first(item, ["why_this_week", "whyThisWeek", "why_today", "whyToday"]), recommendation.whyToday),
        whyThisFormat: string(first(item, ["why_this_format", "whyThisFormat", "format_reason", "formatReason"]), recommendation.formatReason),
        pinkPaisaConnection: string(first(item, ["pink_paisa_connection", "pinkPaisaConnection", "business_connection", "businessConnection"])),
        recommendedLandingPage: string(first(item, ["recommended_landing_page", "recommendedLandingPage", "landing_page", "landingPage"]), recommendation.recommendedLandingPage),
        promotionalIntensity: string(first(item, ["promotional_intensity", "promotionalIntensity"])),
        confidence: number(first(item, ["confidence", "confidence_score", "confidenceScore"])) ?? recommendation.confidence,
        riskFlags: strings(first(item, ["risk_flags", "riskFlags"])).length ? strings(first(item, ["risk_flags", "riskFlags"])) : recommendation.riskFlags,
        scheduledFor: dateString(first(item, ["scheduled_for", "scheduledFor", "suggested_publication_slot", "suggestedPublicationSlot"])),
        draftId: string(first(item, ["draft_id", "draftId", "social_draft_id", "socialDraftId"])),
        sources: array(first(item, ["sources"])).map(normalizeSource),
        visualModeResolution: normalizeVisualModeResolution(first(item, ["visual_mode_resolution", "visualModeResolution"])),
        bundleId: string(first(item, ["bundle_id", "bundleId"])),
        bundleRole: string(first(item, ["bundle_role", "bundleRole"])),
        parentCandidateId: string(first(item, ["parent_candidate_id", "parentCandidateId"])),
      };
    }),
    storyPlan: storyValues.map((itemValue, index) => {
      const item = object(itemValue);
      const recommendation = normalizeRecommendation(first(item, ["recommendation", "content", "content_package", "contentPackage"]) ?? item);
      return {
        id: string(first(item, ["id", "_id", "candidate_id", "candidateId"]), `story-${index + 1}`),
        order: number(first(item, ["order", "sequence", "position", "slot_number", "slotNumber"])) ?? index + 1,
        status: normalizeStatus(first(item, ["status"])),
        topic: string(first(item, ["topic"]), recommendation.topic),
        internalTitle: string(first(item, ["internal_title", "internalTitle", "title"]), recommendation.internalTitle),
        objective: string(first(item, ["objective"]), recommendation.objective),
        primaryKpi: string(first(item, ["primary_kpi", "primaryKpi"])),
        secondaryKpi: string(first(item, ["secondary_kpi", "secondaryKpi"])),
        targetAudience: string(first(item, ["target_audience", "targetAudience", "audience_segment", "audienceSegment"]), recommendation.targetAudienceSegment),
        contentPillar: string(first(item, ["content_pillar", "contentPillar"]), recommendation.contentPillar),
        format: "STORY",
        whyThisWeek: string(first(item, ["why_this_week", "whyThisWeek", "why_today", "whyToday"]), recommendation.whyToday),
        whyThisFormat: string(first(item, ["why_this_format", "whyThisFormat", "format_reason", "formatReason"]), recommendation.formatReason),
        pinkPaisaConnection: string(first(item, ["pink_paisa_connection", "pinkPaisaConnection", "business_connection", "businessConnection"])),
        recommendedLandingPage: string(first(item, ["recommended_landing_page", "recommendedLandingPage", "landing_page", "landingPage"]), recommendation.recommendedLandingPage),
        promotionalIntensity: string(first(item, ["promotional_intensity", "promotionalIntensity"])),
        confidence: number(first(item, ["confidence", "confidence_score", "confidenceScore"])) ?? recommendation.confidence,
        riskFlags: strings(first(item, ["risk_flags", "riskFlags"])).length ? strings(first(item, ["risk_flags", "riskFlags"])) : recommendation.riskFlags,
        scheduledFor: dateString(first(item, ["scheduled_for", "scheduledFor"])),
        draftId: string(first(item, ["draft_id", "draftId"])),
        sources: array(first(item, ["sources"])).map(normalizeSource),
        visualModeResolution: normalizeVisualModeResolution(first(item, ["visual_mode_resolution", "visualModeResolution"])),
        bundleId: string(first(item, ["bundle_id", "bundleId"])),
        bundleRole: string(first(item, ["bundle_role", "bundleRole"])),
        parentCandidateId: string(first(item, ["parent_candidate_id", "parentCandidateId"])),
        parentDraftId: string(first(item, ["parent_draft_id", "parentDraftId"])),
      };
    }),
    contentMixSnapshot: Object.keys(contentMix).length ? {
      windowWeeks: number(first(contentMix, ["window_weeks", "windowWeeks"])) ?? 4,
      historyWeeksFound: number(first(contentMix, ["history_weeks_found", "historyWeeksFound"])) ?? 0,
      historicalPosts: number(first(contentMix, ["historical_posts", "historicalPosts"])) ?? 0,
      currentWeekPosts: number(first(contentMix, ["current_week_posts", "currentWeekPosts"])) ?? 0,
      totalPosts: number(first(contentMix, ["total_posts", "totalPosts"])) ?? 0,
      counts: numberMap(first(contentMix, ["counts"])),
      targetPercentages: numberMap(first(contentMix, ["target_percentages", "targetPercentages"])),
      actualPercentages: numberMap(first(contentMix, ["actual_percentages", "actualPercentages"])),
      deltaPercentages: numberMap(first(contentMix, ["delta_percentages", "deltaPercentages"])),
      hardQuotaEnforced: boolean(first(contentMix, ["hard_quota_enforced", "hardQuotaEnforced"]), false),
      enforcement: string(first(contentMix, ["enforcement"])),
      limitation: string(first(contentMix, ["limitation"])),
    } : null,
    candidates: array(first(plan, ["candidates", "candidate_ideas", "candidateIdeas"])).map(normalizeCandidateSummary),
    sources,
    generationError: typeof generationErrorValue === "string"
      ? {
        stage: "",
        code: "",
        message: generationErrorValue,
        isRetriable: false,
        occurredAt: null,
        validationErrors: [],
      }
      : Object.keys(generationError).length
        ? {
          stage: string(first(generationError, ["stage"])),
          code: string(first(generationError, ["code"])),
          message: string(first(generationError, ["message", "error"]), "Weekly plan generation failed."),
          isRetriable: boolean(first(generationError, ["is_retriable", "isRetriable", "retriable"]), false),
          occurredAt: dateString(first(generationError, ["occurred_at", "occurredAt", "created_at", "createdAt"])),
          validationErrors: strings(first(generationError, ["validation_errors", "validationErrors", "details"])),
        }
        : null,
    createdAt: dateString(first(plan, ["created_at", "createdAt"])),
    updatedAt: dateString(first(plan, ["updated_at", "updatedAt"])),
  };
};

export const normalizeWeeklyResearchResponse = (value: unknown): SocialWeeklyResearch | null => {
  const response = object(unwrapData(value));
  const metaResearch = object(first(response, ["meta_research", "metaResearch"]));
  const metaState = string(first(metaResearch, ["state", "status"]));
  const metaErrors = array(first(metaResearch, ["errors"])).map((entry) => {
    const error = object(entry);
    const code = string(first(error, ["code"]));
    const message = string(first(error, ["message", "error"]));
    return [code, message].filter(Boolean).join(": ");
  }).filter(Boolean);
  const digestValue = ["digest", "research", "weekly_research", "weeklyResearch"]
    .find((key) => Object.prototype.hasOwnProperty.call(response, key));
  const digest = object(digestValue ? response[digestValue] : response);
  if (!Object.keys(digest).length) return null;
  return {
    id: string(first(digest, ["id", "_id"])),
    weekStart: string(first(digest, ["week_start", "weekStart"])),
    weekEnd: string(first(digest, ["week_end", "weekEnd"])),
    status: ["PARTIAL", "UNAVAILABLE", "ERROR", "NOT_CONFIGURED"].includes(metaState.toUpperCase())
      ? metaState.toUpperCase()
      : string(first(digest, ["status"]), "READY"),
    summary: string(first(digest, ["summary", "concise_summary", "conciseSummary", "recommended_content_direction", "recommendedContentDirection"])),
    marketSignals: array(first(digest, ["market_signals", "marketSignals", "external_signals", "externalSignals"])).map(normalizeSignal),
    internalSignals: array(first(digest, ["internal_signals", "internalSignals"])).map(normalizeSignal),
    audienceQuestions: strings(first(digest, ["audience_questions", "audienceQuestions", "current_audience_questions", "currentAudienceQuestions"])),
    audienceThemes: strings(first(digest, ["audience_themes", "audienceThemes", "emotional_themes", "emotionalThemes"])),
    hashtagObservations: strings(first(digest, ["hashtag_observations", "hashtagObservations"])),
    competitorObservations: strings(first(digest, ["competitor_observations", "competitorObservations"])),
    topicsToAvoid: strings(first(digest, ["topics_to_avoid", "topicsToAvoid"])),
    sources: array(first(digest, ["sources", "research_sources", "researchSources"])).map(normalizeSource),
    generatedAt: dateString(first(digest, ["generated_at", "generatedAt", "created_at", "createdAt"])),
    error: string(first(digest, ["error", "last_error", "lastError"])),
    metaState,
    metaMessage: string(first(metaResearch, ["message", "summary"])),
    metaErrors,
  };
};

export const normalizeAnalyticsSummaryResponse = (value: unknown): SocialAnalyticsSummary | null => {
  const response = object(unwrapData(value));
  const summaryKey = ["summary", "analytics"].find((key) => Object.prototype.hasOwnProperty.call(response, key));
  const summary = object(summaryKey ? response[summaryKey] : response);
  const summaryFields = ["range_label", "rangeLabel", "metrics", "totals", "rates", "attribution", "baselines", "posts", "published_posts", "publishedPosts"];
  if (!Object.keys(summary).length || !summaryFields.some((key) => Object.prototype.hasOwnProperty.call(summary, key))) return null;
  const numericRecord = (entry: unknown) => Object.fromEntries(Object.entries(object(entry))
    .map(([key, item]) => [key, number(item)])
    .filter((row): row is [string, number] => row[1] !== null));
  const normalizeBaseline = (entry: unknown): SocialAnalyticsBaseline | null => {
    const baseline = object(entry);
    const observedValue = number(first(baseline, ["observed_value", "observedValue"]));
    const baselineValue = number(first(baseline, ["baseline_value", "baselineValue"]));
    const delta = number(first(baseline, ["delta"]));
    const sampleSize = number(first(baseline, ["sample_size", "sampleSize"]));
    if (observedValue === null || baselineValue === null || delta === null || sampleSize === null) return null;
    return {
      postId: string(first(baseline, ["post_id", "postId", "draft_id", "draftId"])),
      metric: string(first(baseline, ["metric", "metric_name", "metricName"])),
      baseline: string(first(baseline, ["baseline", "baseline_name", "baselineName"])),
      observedValue,
      baselineValue,
      delta,
      ratio: number(first(baseline, ["ratio"])),
      sampleSize,
    };
  };
  const normalizeAttributionRow = (entry: unknown): SocialAnalyticsAttributionRow => {
    const row = object(entry);
    return {
      date: dateString(first(row, ["date"])),
      source: string(first(row, ["source", "session_source", "sessionSource"]), "instagram"),
      medium: string(first(row, ["medium", "session_medium", "sessionMedium"]), "organic_social"),
      campaign: string(first(row, ["campaign", "session_campaign_name", "sessionCampaignName"])),
      content: string(first(row, ["content", "session_manual_ad_content", "sessionManualAdContent"])),
      landingPage: string(first(row, ["landing_page", "landingPage", "landing_page_plus_query_string", "landingPagePlusQueryString"])),
      eventName: string(first(row, ["event_name", "eventName"])),
      metrics: numericRecord(first(row, ["metrics", "values"])),
    };
  };
  const topLevelBaselines = array(first(summary, ["baselines", "baseline_comparisons", "baselineComparisons", "comparisons"]))
    .map(normalizeBaseline)
    .filter((baseline): baseline is SocialAnalyticsBaseline => Boolean(baseline));
  const attributionValue = object(first(summary, ["attribution", "ga4_attribution", "ga4Attribution"]));
  const attribution = Object.keys(attributionValue).length ? {
    provider: string(first(attributionValue, ["provider"]), "GA4"),
    source: string(first(attributionValue, ["source"]), "instagram"),
    medium: string(first(attributionValue, ["medium"]), "organic_social"),
    metrics: numericRecord(first(attributionValue, ["metrics", "totals"])),
    attributionRows: array(first(attributionValue, ["attribution_rows", "attributionRows", "rows"])).map(normalizeAttributionRow),
    conversionEventRows: array(first(attributionValue, ["conversion_event_rows", "conversionEventRows", "conversion_rows", "conversionRows"])).map(normalizeAttributionRow),
    capturedAt: dateString(first(attributionValue, ["captured_at", "capturedAt", "refreshed_at", "refreshedAt"])),
    periodStart: dateString(first(attributionValue, ["period_start", "periodStart"])),
    periodEnd: dateString(first(attributionValue, ["period_end", "periodEnd"])),
  } : null;
  const posts = array(first(summary, ["posts", "published_posts", "publishedPosts", "items"])).map((postValue, index) => {
    const post = object(postValue);
    const postId = string(first(post, ["id", "_id", "draft_id", "draftId"]), `published-${index + 1}`);
    const postAttribution = object(first(post, ["attribution", "ga4_attribution", "ga4Attribution"]));
    const embeddedBaselines = array(first(post, ["baseline_comparisons", "baselineComparisons", "baselines"]))
      .map(normalizeBaseline)
      .filter((baseline): baseline is SocialAnalyticsBaseline => Boolean(baseline))
      .map((baseline) => ({ ...baseline, postId: baseline.postId || postId }));
    return {
      id: postId,
      title: string(first(post, ["title", "internal_title", "internalTitle", "topic"]), `Published post ${index + 1}`),
      format: string(first(post, ["format"])),
      contentPillar: string(first(post, ["content_pillar", "contentPillar"])),
      publishedAt: dateString(first(post, ["published_at", "publishedAt"])),
      permalink: string(first(post, ["permalink", "instagram_permalink", "instagramPermalink"])),
      metrics: numericRecord(first(post, ["metrics", "latest_metrics", "latestMetrics"])),
      attribution: Object.keys(postAttribution).length ? {
        metrics: numericRecord(first(postAttribution, ["metrics", "totals"])),
        landingPages: strings(first(postAttribution, ["landing_pages", "landingPages"])),
        matchedRows: number(first(postAttribution, ["matched_rows", "matchedRows"])) ?? 0,
      } : null,
      baselines: embeddedBaselines.length ? embeddedBaselines : topLevelBaselines.filter((baseline) => baseline.postId === postId),
      learningSummary: string(first(post, ["learning_summary", "learningSummary", "analysis"])),
    };
  });
  return {
    rangeLabel: string(first(summary, ["range_label", "rangeLabel", "period"]), "Current reporting window"),
    refreshedAt: dateString(first(summary, ["refreshed_at", "refreshedAt", "generated_at", "generatedAt"])),
    metrics: numericRecord(first(summary, ["metrics", "totals"])),
    rates: numericRecord(first(summary, ["rates", "normalized_rates", "normalizedRates"])),
    attribution,
    baselines: topLevelBaselines.length ? topLevelBaselines : posts.flatMap((post) => post.baselines),
    posts,
    learnings: strings(first(summary, ["learnings", "learning_summary", "learningSummary", "recommendations"])),
    warnings: strings(first(summary, ["warnings"])),
  };
};

export const normalizeAnalyticsRefreshConnections = (value: unknown): SocialAnalyticsRefreshConnection[] => {
  const response = object(unwrapData(value));
  const connectionValue = first(response, ["connections", "providers", "results"]);
  const rows = Array.isArray(connectionValue)
    ? connectionValue
    : Object.entries(object(connectionValue)).map(([provider, connection]) => ({ provider, ...object(connection) }));
  return rows.map((entry) => {
    const connection = object(entry);
    return {
      provider: string(first(connection, ["provider", "key", "name"]), "Analytics provider"),
      status: string(first(connection, ["status", "state"]), "UNKNOWN").toUpperCase(),
      message: string(first(connection, ["message", "error", "detail"])),
    };
  });
};

export const normalizeCommunityItem = (value: unknown): SocialCommunityItem => {
  const response = object(unwrapData(value));
  const item = object(first(response, ["item", "community_item", "communityItem"]) ?? response);
  const recommendation = object(first(item, ["reply_recommendation", "replyRecommendation", "recommendation"]));
  const approval = object(first(item, ["approval"]));
  const sendIntent = object(first(item, ["send_intent", "sendIntent"]));
  const sendReconciliation = object(first(item, ["send_reconciliation", "sendReconciliation"]));
  const availableActions = object(first(item, ["available_actions", "availableActions"]));
  const author = object(first(item, ["author", "from"]));
  return {
    id: string(first(item, ["id", "_id"])),
    sourceType: string(first(item, ["source_type", "sourceType", "channel", "type"]), "COMMENT"),
    status: string(first(item, ["status"]), "OPEN"),
    classification: string(first(item, ["classification", "category", "intent"]), "UNCLASSIFIED"),
    authorLabel: string(first(item, ["author_label", "authorLabel", "username"]) ?? first(author, ["username", "name"]), "Instagram user"),
    message: string(first(item, ["message", "text", "body", "comment"])),
    permalink: string(first(item, ["permalink", "url"])),
    receivedAt: dateString(first(item, ["received_at", "receivedAt", "created_at", "createdAt"])),
    confidence: number(first(recommendation, ["confidence"]) ?? first(item, ["confidence"])),
    riskFlags: strings(first(recommendation, ["risk_flags", "riskFlags"]) ?? first(item, ["risk_flags", "riskFlags"])),
    suggestedReply: string(first(recommendation, ["suggested_reply", "suggestedReply", "reply"]) ?? first(item, ["suggested_reply", "suggestedReply"])),
    approvedReply: string(first(approval, ["approved_reply", "approvedReply"])),
    approvedReplyChecksum: string(first(approval, ["approved_reply_checksum", "approvedReplyChecksum"])),
    recommendationStatus: string(first(recommendation, ["status", "decision"]) ?? first(item, ["recommendation_status", "recommendationStatus"])),
    sendIntentStatus: string(first(sendIntent, ["status"]) ?? first(item, ["send_intent_status", "sendIntentStatus"])),
    sendIntent: Object.keys(sendIntent).length ? sendIntent : null,
    escalationReason: string(first(recommendation, ["escalation_reason", "escalationReason"]) ?? first(item, ["escalation_reason", "escalationReason"])),
    escalationState: string(first(item, ["escalation_state", "escalationState"]), "NONE").toUpperCase(),
    escalationAcknowledgedAt: dateString(first(item, ["escalation_acknowledged_at", "escalationAcknowledgedAt"])),
    escalationResolvedAt: dateString(first(item, ["escalation_resolved_at", "escalationResolvedAt"])),
    sendReconciliation: Object.keys(sendReconciliation).length ? sendReconciliation : null,
    availableActions: {
      approveAndSend: boolean(first(availableActions, ["approve_and_send", "approveAndSend"]), false),
      reconcileSend: boolean(first(availableActions, ["reconcile_send", "reconcileSend"]), false),
      acknowledgeEscalation: boolean(first(availableActions, ["acknowledge_escalation", "acknowledgeEscalation"]), false),
      resolveEscalation: boolean(first(availableActions, ["resolve_escalation", "resolveEscalation"]), false),
    },
    relatedMediaTitle: string(first(item, ["related_media_title", "relatedMediaTitle", "media_title", "mediaTitle"])),
    metadata: item,
  };
};

export const normalizeCommunityResponse = (value: unknown): SocialCommunityItem[] => {
  const unwrapped = unwrapData(value);
  const response = object(unwrapped);
  return array(first(response, ["items", "community_items", "communityItems", "results"]) ?? unwrapped).map(normalizeCommunityItem);
};

export const normalizeWorkSummary = (value: unknown): SocialWorkSummary => {
  const response = object(unwrapData(value));
  const counts = object(first(response, ["counts"]));
  const countFor = (key: string) => {
    const section = object(first(response, [key]));
    return number(first(counts, [key]) ?? first(section, ["actionable_count", "actionableCount"])) ?? 0;
  };
  const content = object(first(response, ["content"]));
  const results = object(first(response, ["results"]));
  const normalizeFailureItem = (entry: unknown) => {
    const item = object(entry);
    return {
      type: string(first(item, ["type"])),
      id: string(first(item, ["id", "_id"])),
      draftId: string(first(item, ["draft_id", "draftId"])),
      generationRunId: string(first(item, ["generation_run_id", "generationRunId"])),
      publicationId: string(first(item, ["publication_id", "publicationId"])),
      weeklyPlanId: string(first(item, ["weekly_plan_id", "weeklyPlanId"])),
      status: string(first(item, ["status"])),
      code: string(first(item, ["code", "error_code", "errorCode"])),
      message: string(first(item, ["message", "error_message", "errorMessage"])),
      occurredAt: dateString(first(item, ["occurred_at", "occurredAt", "updated_at", "updatedAt"])),
      recoveryAvailable: boolean(first(item, ["recovery_available", "recoveryAvailable"]), false),
    };
  };
  return {
    counts: {
      strategy: countFor("strategy"),
      content: countFor("content"),
      results: countFor("results"),
      community: countFor("community"),
      setup: countFor("setup"),
    },
    breakdown: {
      strategy: object(first(response, ["strategy"])),
      content,
      results,
      community: object(first(response, ["community"])),
      setup: object(first(response, ["setup"])),
    },
    terminalFailures: {
      content: array(first(content, ["terminal_failure_items", "terminalFailureItems"])).map(normalizeFailureItem).filter((item) => Boolean(item.id)),
      results: array(first(results, ["terminal_failure_items", "terminalFailureItems"])).map(normalizeFailureItem).filter((item) => Boolean(item.id)),
    },
    terminalFailuresTruncated: {
      content: boolean(first(content, ["terminal_failure_items_truncated", "terminalFailureItemsTruncated"]), false),
      results: boolean(first(results, ["terminal_failure_items_truncated", "terminalFailureItemsTruncated"]), false),
    },
    priorityOrder: strings(first(content, ["priority_order", "priorityOrder"])),
    nextReviewDraftId: string(first(response, ["next_review_draft_id", "nextReviewDraftId"])),
    generatedAt: dateString(first(response, ["generated_at", "generatedAt"])),
  };
};

const normalizeGeneratedContentCounts = (value: unknown) => {
  const counts = object(value);
  return {
    drafts: number(first(counts, ["drafts"])) ?? 0,
    assets: number(first(counts, ["assets"])) ?? 0,
    generationRuns: number(first(counts, ["generation_runs", "generationRuns"])) ?? 0,
    weeklyPlans: number(first(counts, ["weekly_plans", "weeklyPlans"])) ?? 0,
    researchSources: number(first(counts, ["research_sources", "researchSources"])) ?? 0,
    manualActions: number(first(counts, ["manual_actions", "manualActions"])) ?? 0,
  };
};

export const normalizeGeneratedContentCleanupPreview = (value: unknown): SocialGeneratedContentCleanupPreview => {
  const root = object(unwrapData(value));
  const localFiles = object(first(root, ["local_files", "localFiles"]));
  const preserved = object(first(root, ["preserved"]));
  return {
    confirmationPhrase: string(first(root, ["confirmation_phrase", "confirmationPhrase"])),
    purgeToken: string(first(root, ["purge_token", "purgeToken"])),
    generatedAt: dateString(first(root, ["generated_at", "generatedAt"])),
    expiresAt: dateString(first(root, ["expires_at", "expiresAt"])),
    counts: normalizeGeneratedContentCounts(first(root, ["counts"])),
    totalCount: number(first(root, ["total_count", "totalCount"])) ?? 0,
    localFiles: {
      count: number(first(localFiles, ["count"])) ?? 0,
      bytes: number(first(localFiles, ["bytes"])) ?? 0,
    },
    blockers: array(first(root, ["blockers"])).map((item) => {
      const blocker = object(item);
      return {
        code: string(first(blocker, ["code"])),
        count: number(first(blocker, ["count"])) ?? 0,
        message: string(first(blocker, ["message"])),
      };
    }),
    preserved: Object.fromEntries(Object.entries(preserved).map(([key, item]) => [key, number(item) ?? 0])),
    exclusions: strings(first(root, ["exclusions"])),
  };
};

export const normalizeGeneratedContentCleanupResult = (value: unknown): SocialGeneratedContentCleanupResult => {
  const root = object(unwrapData(value));
  const fileCleanup = object(first(root, ["file_cleanup", "fileCleanup"]));
  return {
    reused: boolean(first(root, ["reused"]), false),
    deleted: normalizeGeneratedContentCounts(first(root, ["deleted"])),
    totalDeleted: number(first(root, ["total_deleted", "totalDeleted"])) ?? 0,
    usageLedgersCreated: number(first(root, ["usage_ledgers_created", "usageLedgersCreated"])) ?? 0,
    fileCleanup: {
      requested: number(first(fileCleanup, ["requested"])) ?? 0,
      deleted: number(first(fileCleanup, ["deleted"])) ?? 0,
      missing: number(first(fileCleanup, ["missing"])) ?? 0,
      failed: number(first(fileCleanup, ["failed"])) ?? 0,
      failures: array(first(fileCleanup, ["failures"])).map((item) => {
        const failure = object(item);
        return {
          storageKey: string(first(failure, ["storage_key", "storageKey"])),
          message: string(first(failure, ["message"])),
        };
      }),
    },
    retainedAuditEventId: string(first(root, ["retained_audit_event_id", "retainedAuditEventId"])),
    completedAt: dateString(first(root, ["completed_at", "completedAt"])),
    exclusions: strings(first(root, ["exclusions"])),
  };
};

export const normalizeSettingsResponse = (value: unknown): { settings: SocialSettings; readiness: SocialReadiness } => {
  const response = object(object(value).data || value);
  const raw = object(first(response, ["settings", "social_manager_settings", "socialManagerSettings"]) || response);
  const brand = object(first(raw, ["brand_profile", "brandProfile"]));
  const generation = object(first(raw, ["generation"]));
  const dailyGeneration = object(first(raw, ["daily_generation", "dailyGeneration"]));
  const defaultPosting = object(first(raw, ["default_posting_time", "defaultPostingTime"]));
  const research = object(first(raw, ["research"]));
  const watchlists = object(first(raw, ["watchlists"]));
  const models = object(first(raw, ["models"]));
  const costControls = object(first(raw, ["cost_controls", "costControls"]));
  const duplicatePrevention = object(first(raw, ["duplicate_prevention", "duplicatePrevention"]));
  const approval = object(first(raw, ["approval"]));
  const publishing = object(first(raw, ["publishing"]));
  const disclosures = object(first(raw, ["disclosures"]));
  const utm = object(first(raw, ["utm"]));
  const notifications = object(first(raw, ["notifications"]));
  const weeklyPlanning = object(first(raw, ["weekly_planning", "weeklyPlanning", "weekly_strategy", "weeklyStrategy"]));
  const postingSlots = array(first(weeklyPlanning, ["posting_slots", "postingSlots"])).map(object);
  const community = object(first(raw, ["community"]));
  const analytics = object(first(raw, ["analytics", "performance"]));
  const pillarRatios = object(first(raw, ["content_pillar_ratios", "contentPillarRatios"]));
  const pillarNames: Record<string, string> = {
    money_education: "Money Education",
    money_psychology: "Money Psychology",
    wealth_and_wellness: "Wealth and Wellness",
    relatable_money_moments: "Relatable Money Moments",
    interactive: "Interactive",
    pink_paisa_resources: "Pink Paisa Resources",
    curated_wellness_and_affiliate_products: "Curated Wellness and Affiliate Products",
  };
  const clock = (section: UnknownRecord, fallback: string) => {
    const hour = number(first(section, ["hour_ist", "hourIst", "hour"]));
    const minute = number(first(section, ["minute_ist", "minuteIst", "minute"]));
    if (hour === null) return fallback;
    return `${String(hour).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
  };
  const legacyPillars = array(first(raw, ["content_pillars", "contentPillars", "pillars"]));
  const contentPillars = Object.keys(pillarRatios).length
    ? Object.entries(pillarNames).map(([key, name]) => ({ name, ratio: number(pillarRatios[key]) ?? 0, enabled: (number(pillarRatios[key]) ?? 0) > 0 }))
    : legacyPillars.length ? legacyPillars.map((item) => {
      const pillar = object(item);
      return {
        name: string(first(pillar, ["name", "label", "pillar"])),
        ratio: number(first(pillar, ["ratio", "weight", "percentage"])) ?? 0,
        enabled: boolean(first(pillar, ["enabled", "active"]), true),
      };
    }) : DEFAULT_SOCIAL_SETTINGS.contentPillars.map((pillar) => ({ ...pillar }));
  const settings: SocialSettings = {
    raw: JSON.parse(JSON.stringify(raw)),
    brandProfile: string(first(brand, ["promise", "positioning"]) ?? first(raw, ["brand_profile_text", "brandProfileText"]), DEFAULT_SOCIAL_SETTINGS.brandProfile),
    targetAudience: strings(first(brand, ["primary_audience", "primaryAudience"]) ?? first(raw, ["target_audience", "targetAudience"])).join("\n") || DEFAULT_SOCIAL_SETTINGS.targetAudience,
    contentPillars,
    dailyGenerationTime: clock(dailyGeneration, string(first(raw, ["daily_generation_time", "dailyGenerationTime"]), DEFAULT_SOCIAL_SETTINGS.dailyGenerationTime)),
    defaultPostingTime: clock(defaultPosting, string(first(raw, ["default_posting_time", "defaultPostingTime"]), DEFAULT_SOCIAL_SETTINGS.defaultPostingTime)),
    timezone: string(first(dailyGeneration, ["timezone"]) ?? first(defaultPosting, ["timezone"]) ?? first(raw, ["timezone"]), DEFAULT_SOCIAL_SETTINGS.timezone),
    researchDomains: strings(first(research, ["allow_domains", "allowDomains"]) ?? first(raw, ["research_domains", "researchDomains"])),
    blockedDomains: strings(first(research, ["block_domains", "blockDomains"]) ?? first(raw, ["blocked_domains", "blockedDomains"])),
    autoPublish: boolean(first(publishing, ["auto_publish", "autoPublish"]) ?? first(raw, ["auto_publish", "autoPublish"]), DEFAULT_SOCIAL_SETTINGS.autoPublish),
    approvalRequired: boolean(first(approval, ["require_human_approval", "requireHumanApproval"]) ?? first(raw, ["approval_required", "approvalRequired"]), DEFAULT_SOCIAL_SETTINGS.approvalRequired),
    aiModel: string(first(models, ["assembly_model", "assemblyModel", "copy_model", "copyModel"]) ?? first(raw, ["ai_model", "aiModel", "model"]), DEFAULT_SOCIAL_SETTINGS.aiModel),
    researchModel: string(first(models, ["research_model", "researchModel"]), DEFAULT_SOCIAL_SETTINGS.researchModel),
    strategyModel: string(first(models, ["strategy_model", "strategyModel"]), DEFAULT_SOCIAL_SETTINGS.strategyModel),
    copyModel: string(first(models, ["copy_model", "copyModel"]), DEFAULT_SOCIAL_SETTINGS.copyModel),
    complianceModel: string(first(models, ["compliance_model", "complianceModel"]), DEFAULT_SOCIAL_SETTINGS.complianceModel),
    visualDirectionModel: string(first(models, ["visual_direction_model", "visualDirectionModel"]), DEFAULT_SOCIAL_SETTINGS.visualDirectionModel),
    assemblyModel: string(first(models, ["assembly_model", "assemblyModel"]), DEFAULT_SOCIAL_SETTINGS.assemblyModel),
    imageModel: string(first(models, ["image_model", "imageModel"]) ?? first(raw, ["image_model", "imageModel"])),
    fullAiGeneration: boolean(first(generation, ["full_ai_generation", "fullAiGeneration"]), DEFAULT_SOCIAL_SETTINGS.fullAiGeneration),
    allowDeterministicFallback: boolean(first(generation, ["allow_deterministic_content_fallback", "allowDeterministicContentFallback"]), DEFAULT_SOCIAL_SETTINGS.allowDeterministicFallback),
    allowTemplateVisualFallback: boolean(first(generation, ["allow_template_only_visual_fallback", "allowTemplateOnlyVisualFallback"]), DEFAULT_SOCIAL_SETTINGS.allowTemplateVisualFallback),
    maxContentRevisions: number(first(generation, ["max_content_revisions", "maxContentRevisions"])) ?? DEFAULT_SOCIAL_SETTINGS.maxContentRevisions,
    maxImageRetries: number(first(generation, ["max_image_retries", "maxImageRetries"])) ?? DEFAULT_SOCIAL_SETTINGS.maxImageRetries,
    defaultVisualMode: string(first(generation, ["default_visual_mode", "defaultVisualMode"]), DEFAULT_SOCIAL_SETTINGS.defaultVisualMode) as SocialSettings["defaultVisualMode"],
    monthlyCostLimit: number(first(costControls, ["monthly_budget_inr", "monthlyBudgetInr"]) ?? first(raw, ["monthly_cost_limit", "monthlyCostLimit"])) ?? DEFAULT_SOCIAL_SETTINGS.monthlyCostLimit,
    duplicateLookbackDays: number(first(duplicatePrevention, ["lookback_days", "lookbackDays"]) ?? first(raw, ["duplicate_lookback_days", "duplicateLookbackDays"])) ?? DEFAULT_SOCIAL_SETTINGS.duplicateLookbackDays,
    financialDisclaimer: string(first(disclosures, ["financial_disclaimer", "financialDisclaimer"]) ?? first(raw, ["financial_disclaimer", "financialDisclaimer"]), DEFAULT_SOCIAL_SETTINGS.financialDisclaimer),
    affiliateDisclosure: string(first(disclosures, ["affiliate_disclosure", "affiliateDisclosure"]) ?? first(raw, ["affiliate_disclosure", "affiliateDisclosure"]), DEFAULT_SOCIAL_SETTINGS.affiliateDisclosure),
    utmSource: string(first(utm, ["source"]) ?? first(raw, ["utm_source", "utmSource"]), DEFAULT_SOCIAL_SETTINGS.utmSource),
    utmMedium: string(first(utm, ["medium"]) ?? first(raw, ["utm_medium", "utmMedium"]), DEFAULT_SOCIAL_SETTINGS.utmMedium),
    utmCampaignPrefix: string(first(utm, ["campaign_prefix", "campaignPrefix"]) ?? first(raw, ["utm_campaign_prefix", "utmCampaignPrefix"]), DEFAULT_SOCIAL_SETTINGS.utmCampaignPrefix),
    notificationRecipients: strings(first(notifications, ["reviewer_emails", "reviewerEmails"]) ?? first(raw, ["notification_recipients", "notificationRecipients"])),
    weeklyPublicationMaximum: number(first(weeklyPlanning, ["max_feed_posts_per_week", "maxFeedPostsPerWeek", "publication_maximum", "publicationMaximum"]) ?? first(raw, ["weekly_publication_maximum", "weeklyPublicationMaximum"])) ?? DEFAULT_SOCIAL_SETTINGS.weeklyPublicationMaximum,
    companionStoriesEnabled: boolean(first(weeklyPlanning, ["companion_stories_enabled", "companionStoriesEnabled"]), DEFAULT_SOCIAL_SETTINGS.companionStoriesEnabled),
    postingDays: strings(first(weeklyPlanning, ["posting_days", "postingDays"]) ?? first(raw, ["posting_days", "postingDays"])).length
      ? strings(first(weeklyPlanning, ["posting_days", "postingDays"]) ?? first(raw, ["posting_days", "postingDays"]))
      : postingSlots.length
        ? postingSlots.map((slot) => string(first(slot, ["weekday"]))).filter(Boolean).map((day) => day.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()))
        : DEFAULT_SOCIAL_SETTINGS.postingDays,
    weeklyPlanningTime: clock({
      hour_ist: first(weeklyPlanning, ["planning_hour_ist", "planningHourIst", "hour_ist", "hourIst"]),
      minute_ist: first(weeklyPlanning, ["planning_minute_ist", "planningMinuteIst", "minute_ist", "minuteIst"]),
    }, string(first(raw, ["weekly_planning_time", "weeklyPlanningTime"]), DEFAULT_SOCIAL_SETTINGS.weeklyPlanningTime)),
    prePublicationLeadHours: number(first(weeklyPlanning, ["prepublication_lead_hours", "prePublicationLeadHours", "pre_publication_lead_hours"])) ?? DEFAULT_SOCIAL_SETTINGS.prePublicationLeadHours,
    candidateCount: number(first(research, ["candidate_count", "candidateCount"])) ?? DEFAULT_SOCIAL_SETTINGS.candidateCount,
    researchResultLimit: number(first(research, ["result_limit", "resultLimit", "max_results", "maxResults"])) ?? DEFAULT_SOCIAL_SETTINGS.researchResultLimit,
    competitorWatchlist: strings(
      first(watchlists, ["competitor_accounts", "competitorAccounts"])
      ?? first(research, ["competitor_watchlist", "competitorWatchlist"]),
    ),
    hashtagWatchlist: strings(
      first(watchlists, ["hashtags"])
      ?? first(research, ["hashtag_watchlist", "hashtagWatchlist"]),
    ),
    supervisorModel: string(first(models, ["supervisor_model", "supervisorModel"]), DEFAULT_SOCIAL_SETTINGS.supervisorModel),
    audienceModel: string(first(models, ["audience_model", "audienceModel", "audience_intelligence_model", "audienceIntelligenceModel"]), DEFAULT_SOCIAL_SETTINGS.audienceModel),
    growthModel: string(first(models, ["growth_model", "growthModel", "analytics_model", "analyticsModel"]), DEFAULT_SOCIAL_SETTINGS.growthModel),
    communityModel: string(first(models, ["community_model", "communityModel"]), DEFAULT_SOCIAL_SETTINGS.communityModel),
    analyticsIntervalsHours: numericItems(first(analytics, ["snapshot_intervals_hours", "snapshotIntervalsHours", "metric_intervals_hours", "metricIntervalsHours"])).length
      ? numericItems(first(analytics, ["snapshot_intervals_hours", "snapshotIntervalsHours", "metric_intervals_hours", "metricIntervalsHours"]))
      : DEFAULT_SOCIAL_SETTINGS.analyticsIntervalsHours,
    autoReply: boolean(first(community, ["auto_reply", "autoReply"]), DEFAULT_SOCIAL_SETTINGS.autoReply),
    autoDm: boolean(first(community, ["auto_dm", "autoDm"]), DEFAULT_SOCIAL_SETTINGS.autoDm),
    autoHideSpam: boolean(first(community, ["auto_hide_spam", "autoHideSpam"]), DEFAULT_SOCIAL_SETTINGS.autoHideSpam),
  };
  return { settings, readiness: normalizeReadiness(first(response, ["readiness"])) };
};

const numericItems = (value: unknown) => array(value)
  .map(number)
  .filter((item): item is number => item !== null);

const overlayText = (value: Record<string, string>) => Object.entries(value)
  .filter(([, instruction]) => instruction)
  .map(([placement, instruction]) => `${placement}: ${instruction}`)
  .join("; ");

const formatContentPayload = (recommendation: SocialRecommendation): UnknownRecord => {
  const existing = object(recommendation.formatContent);
  const overlay = {
    ...object(first(existing, ["overlayInstructions", "overlay_instructions"])),
    ...recommendation.overlayInstructions,
  };
  const common: UnknownRecord = {
    ...existing,
    id: string(first(existing, ["id"]), "primary"),
    format: recommendation.format,
    postType: recommendation.postType,
    objective: recommendation.objective,
    contentPillar: recommendation.contentPillar,
    targetAudience: recommendation.targetAudienceSegment,
    whyToday: recommendation.whyToday,
    formatReason: recommendation.formatReason,
    hookOptions: Array.from({ length: 3 }, (_, index) => recommendation.hooks[index] || ""),
    caption: recommendation.caption,
    cta: recommendation.cta,
    hashtags: recommendation.hashtags,
    altText: recommendation.altText,
    recommendedLandingPage: recommendation.recommendedLandingPage || null,
    sourceIndexes: numericItems(first(existing, ["sourceIndexes", "source_indexes"])),
    financialDisclaimer: recommendation.financialDisclaimer || null,
    affiliateDisclosure: recommendation.affiliateDisclosure || null,
  };

  if (recommendation.format === "CAROUSEL") {
    return {
      ...common,
      slideCount: recommendation.slides.length,
      narrativeArc: recommendation.supportingCopy || string(first(existing, ["narrativeArc", "narrative_arc"])),
      cohesiveArtDirection: string(first(existing, ["cohesiveArtDirection", "cohesive_art_direction"])),
      slides: recommendation.slides.map((slide, index) => ({
        slideNumber: slide.slideNumber || index + 1,
        headline: slide.headline,
        body: slide.body,
        imagePrompt: slide.imagePrompt,
        overlayInstructions: slide.overlayInstructions,
      })),
    };
  }

  if (["REEL", "VIDEO_FEED"].includes(recommendation.format)) {
    return {
      ...common,
      durationSeconds: number(first(existing, ["durationSeconds", "duration_seconds"])) ?? 30,
      coverHeadline: recommendation.headline,
      audioDirection: recommendation.supportingCopy || string(first(existing, ["audioDirection", "audio_direction"])),
      scenes: recommendation.reelScenes,
      coverImagePrompt: recommendation.imageGenerationPrompt,
      overlayInstructions: overlay,
    };
  }

  if (recommendation.format === "STORY") {
    return {
      ...common,
      frameCount: recommendation.storyFrames.length,
      frames: recommendation.storyFrames,
    };
  }

  if (recommendation.format === "PRODUCT_FEATURE") {
    return {
      ...common,
      verifiedProductId: recommendation.verifiedProductFacts?.id || recommendation.verifiedProductId,
      verifiedProductTitle: recommendation.verifiedProductFacts?.title || recommendation.verifiedProductTitle,
      verifiedProductImageUrl: recommendation.verifiedProductFacts?.imageUrl || string(first(existing, ["verifiedProductImageUrl", "verified_product_image_url"])),
      selectedHeadline: recommendation.headline,
      supportingText: recommendation.supportingCopy || null,
      imagePrompt: recommendation.imageGenerationPrompt,
      productPreservationInstructions: strings(first(existing, ["productPreservationInstructions", "product_preservation_instructions"])),
      negativeVisualInstructions: recommendation.negativeVisualInstructions,
      overlayInstructions: overlay,
    };
  }

  if (recommendation.format === "SINGLE_IMAGE") {
    return {
      ...common,
      selectedHeadline: recommendation.headline,
      supportingText: recommendation.supportingCopy || null,
      imagePrompt: recommendation.imageGenerationPrompt,
      negativeVisualInstructions: recommendation.negativeVisualInstructions,
      overlayInstructions: overlay,
    };
  }

  return {
    ...common,
    selectedHeadline: recommendation.headline,
    supportingText: recommendation.supportingCopy || null,
    interactionCopy: string(first(existing, ["interactionCopy", "interaction_copy"])) || null,
    imagePrompt: recommendation.imageGenerationPrompt,
    negativeVisualInstructions: recommendation.negativeVisualInstructions,
    overlayInstructions: overlay,
  };
};

const visualBriefPayload = (recommendation: SocialRecommendation): UnknownRecord => {
  const existing = object(recommendation.visualBrief);
  const existingAssets = array(first(existing, ["assets"])).map(object);
  const globalOverlay = overlayText(recommendation.overlayInstructions);
  const assets = existingAssets.map((asset, index) => {
    const slide = recommendation.slides[index];
    return {
      ...asset,
      imagePrompt: recommendation.format === "CAROUSEL"
        ? slide?.imagePrompt || string(first(asset, ["imagePrompt", "image_prompt"]))
        : index === 0 ? recommendation.imageGenerationPrompt : string(first(asset, ["imagePrompt", "image_prompt"])),
      overlayInstructions: recommendation.format === "CAROUSEL"
        ? slide?.overlayInstructions || string(first(asset, ["overlayInstructions", "overlay_instructions"]))
        : globalOverlay || string(first(asset, ["overlayInstructions", "overlay_instructions"])),
    };
  });
  const authenticProductReference = recommendation.verifiedProductFacts ? {
    ...object(first(existing, ["authenticProductReference", "authentic_product_reference"])),
    productId: recommendation.verifiedProductFacts.id,
    productTitle: recommendation.verifiedProductFacts.title,
    imageUrl: recommendation.verifiedProductFacts.imageUrl,
  } : undefined;
  return {
    ...existing,
    format: recommendation.format,
    formatReason: recommendation.formatReason,
    ...(assets.length ? { assets } : {}),
    ...(authenticProductReference ? { authenticProductReference } : {}),
  };
};

export const recommendationPayload = (recommendation: SocialRecommendation) => {
  const breakdown = recommendation.scoreBreakdown;
  const score = (keys: string[], fallback = 0) => number(first(breakdown, keys)) ?? fallback;
  const visual = recommendation.visualConcept;
  const visualValue = (keys: string[]) => string(first(visual, keys));
  const scoreBreakdown = {
    brandRelevance: score(["brandRelevance", "brand_relevance"]),
    audienceUsefulness: score(["audienceUsefulness", "audience_usefulness"]),
    timeliness: score(["timeliness"]),
    originality: score(["originality"]),
    engagementPotential: score(["engagementPotential", "engagement_potential"]),
    businessAlignment: score(["businessAlignment", "business_alignment"]),
    evidenceQuality: score(["evidenceQuality", "evidence_quality"]),
    compliancePenalty: score(["compliancePenalty", "compliance_penalty"], 0),
    total: score(["total", "total_score", "finalScore", "final_score"], recommendation.score ?? 0),
  };
  const productRecommendation = recommendation.format === "PRODUCT_FEATURE"
    || ["PRODUCT", "AFFILIATE"].includes(recommendation.postType);
  const verifiedProductFacts = productRecommendation && recommendation.verifiedProductFacts ? {
    id: recommendation.verifiedProductFacts.id,
    title: recommendation.verifiedProductFacts.title,
    brand: recommendation.verifiedProductFacts.brand || null,
    category: recommendation.verifiedProductFacts.category || null,
    subcategory: recommendation.verifiedProductFacts.subcategory || null,
    asin: recommendation.verifiedProductFacts.asin || null,
    imageUrl: recommendation.verifiedProductFacts.imageUrl,
    description: recommendation.verifiedProductFacts.description || null,
    affiliateUrl: recommendation.verifiedProductFacts.affiliateUrl || null,
    landingPage: recommendation.verifiedProductFacts.landingPage || null,
  } : null;

  return {
    internalTitle: recommendation.internalTitle,
    whyToday: recommendation.whyToday,
    objective: recommendation.objective,
    format: recommendation.format,
    formatReason: recommendation.formatReason,
    postType: recommendation.postType,
    formatContent: formatContentPayload(recommendation),
    visualBrief: visualBriefPayload(recommendation),
    verifiedProductFacts,
    contentPillar: recommendation.contentPillar,
    targetAudienceSegment: recommendation.targetAudienceSegment,
    topic: recommendation.topic,
    verifiedProductId: productRecommendation ? recommendation.verifiedProductId || verifiedProductFacts?.id || null : null,
    verifiedProductTitle: productRecommendation ? recommendation.verifiedProductTitle || verifiedProductFacts?.title || null : null,
    hooks: Array.from({ length: 3 }, (_, index) => recommendation.hooks[index] || ""),
    onPostCopy: {
      headline: recommendation.format === "CAROUSEL"
        ? recommendation.slides[0]?.headline || null
        : recommendation.headline || null,
      supportingCopy: recommendation.supportingCopy || null,
      slides: recommendation.slides.map((slide, index) => ({
        slideNumber: slide.slideNumber || index + 1,
        headline: slide.headline,
        body: slide.body,
        visualInstruction: slide.visualInstruction,
      })),
      storyFrames: recommendation.storyFrames,
      reelScenes: recommendation.reelScenes,
    },
    caption: recommendation.caption,
    cta: recommendation.cta,
    hashtags: recommendation.hashtags,
    visualConcept: {
      layout: visualValue(["layout"]),
      mainVisual: visualValue(["mainVisual", "main_visual"]),
      textHierarchy: visualValue(["textHierarchy", "text_hierarchy"]),
      graphicElements: visualValue(["graphicElements", "graphic_elements"]),
      mood: visualValue(["mood"]),
      photographyOrIllustrationDirection: visualValue(["photographyOrIllustrationDirection", "photography_or_illustration_direction"]),
      aspectRatio: visualValue(["aspectRatio", "aspect_ratio"]) || "4:5",
    },
    imageGenerationPrompt: recommendation.imageGenerationPrompt,
    altText: recommendation.altText,
    financialDisclaimer: recommendation.financialDisclaimer || null,
    affiliateDisclosure: recommendation.affiliateDisclosure || null,
    recommendedLandingPage: recommendation.recommendedLandingPage || null,
    utmParameters: recommendation.utmParameters,
    sources: recommendation.sources.map((source) => ({
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      accessedAt: source.accessedAt || new Date().toISOString(),
      claimSupported: source.claimSupported,
      confidence: source.confidence ?? 0,
    })),
    confidence: recommendation.confidence ?? 0,
    riskFlags: recommendation.riskFlags,
    scoreBreakdown,
  };
};

export const generationRequestPayload = (request: SocialGenerationRequest) => ({
  generation_type: request.generation_type,
  requested_format: request.requested_format,
  requested_post_type: request.requested_post_type || undefined,
  generation_scope: request.generation_scope,
  visual_mode: request.visual_mode,
  admin_instructions: request.admin_instructions?.trim() || undefined,
  verified_product_id: request.verified_product_id || undefined,
  request_id: request.request_id || undefined,
  force: Boolean(request.force),
});

export const regenerationPayload = (value: unknown) => {
  const request = object(value);
  const allowedScopes: SocialRegenerationRequest["scope"][] = ["strategy", "copy", "format", "revision", "compliance", "image"];
  const rawScope = string(first(request, ["scope"])).toLowerCase();
  const scope = allowedScopes.includes(rawScope as SocialRegenerationRequest["scope"])
    ? rawScope as SocialRegenerationRequest["scope"]
    : "copy";
  const targetFormat = string(first(request, ["target_format", "targetFormat"])).toUpperCase();
  return {
    scope,
    ...(string(first(request, ["instructions", "admin_instructions", "adminInstructions"])).trim()
      ? { instructions: string(first(request, ["instructions", "admin_instructions", "adminInstructions"])).trim() }
      : {}),
    ...(targetFormat ? { target_format: targetFormat as SocialFormat } : {}),
    ...(first(request, ["visual_mode", "visualMode"])
      ? { visual_mode: string(first(request, ["visual_mode", "visualMode"])).toUpperCase() }
      : {}),
    ...(number(first(request, ["asset_sequence", "assetSequence"]))
      ? { asset_sequence: number(first(request, ["asset_sequence", "assetSequence"])) as number }
      : {}),
  };
};

export const settingsPayload = (settings: SocialSettings) => {
  const raw = JSON.parse(JSON.stringify(settings.raw || {})) as UnknownRecord;
  const [generationHour, generationMinute] = settings.dailyGenerationTime.split(":").map(Number);
  const [postingHour, postingMinute] = settings.defaultPostingTime.split(":").map(Number);
  const [planningHour, planningMinute] = settings.weeklyPlanningTime.split(":").map(Number);
  const existingPostingSlots = array(first(object(raw.weekly_planning), ["posting_slots", "postingSlots"])).map(object);
  const postingSlots = settings.postingDays.slice(0, 5).map((weekday, index) => {
    const existing = existingPostingSlots[index] || {};
    return {
      slot_number: index + 1,
      weekday: weekday.trim().toUpperCase(),
      hour_ist: number(first(existing, ["hour_ist", "hourIst"])) ?? postingHour ?? 11,
      minute_ist: number(first(existing, ["minute_ist", "minuteIst"])) ?? postingMinute ?? 0,
    };
  });
  const pillarKeys: Record<string, string> = {
    "Money Education": "money_education",
    "Money Psychology": "money_psychology",
    "Wealth and Wellness": "wealth_and_wellness",
    "Relatable Money Moments": "relatable_money_moments",
    Interactive: "interactive",
    "Pink Paisa Resources": "pink_paisa_resources",
    "Curated Wellness and Affiliate Products": "curated_wellness_and_affiliate_products",
  };
  const ratios = Object.fromEntries(settings.contentPillars.map((pillar) => [
    pillarKeys[pillar.name] || pillar.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
    pillar.enabled ? pillar.ratio : 0,
  ]));
  const brand = object(raw.brand_profile);
  const generation = object(raw.generation);
  const research = object(raw.research);
  const watchlists = object(raw.watchlists);
  const models = object(raw.models);
  const costs = object(raw.cost_controls);
  const duplicate = object(raw.duplicate_prevention);
  const approval = object(raw.approval);
  const publishing = object(raw.publishing);
  const notifications = object(raw.notifications);
  const weeklyPlanning = object(raw.weekly_planning);
  const community = object(raw.community);
  const analytics = object(raw.analytics);
  return {
    ...raw,
    brand_profile: {
      ...brand,
      promise: settings.brandProfile,
      primary_audience: settings.targetAudience.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    },
    content_pillar_ratios: ratios,
    daily_generation: { ...object(raw.daily_generation), hour_ist: generationHour || 0, minute_ist: generationMinute || 0, timezone: settings.timezone },
    default_posting_time: { ...object(raw.default_posting_time), hour_ist: postingHour || 0, minute_ist: postingMinute || 0, timezone: settings.timezone },
    research: {
      ...research,
      allow_domains: settings.researchDomains,
      block_domains: settings.blockedDomains,
      candidate_count: settings.candidateCount,
      result_limit: settings.researchResultLimit,
      competitor_watchlist: settings.competitorWatchlist,
      hashtag_watchlist: settings.hashtagWatchlist,
    },
    watchlists: {
      ...watchlists,
      competitor_accounts: settings.competitorWatchlist,
      hashtags: settings.hashtagWatchlist,
    },
    weekly_planning: {
      ...weeklyPlanning,
      max_feed_posts_per_week: settings.weeklyPublicationMaximum,
      companion_stories_enabled: settings.companionStoriesEnabled,
      planning_hour_ist: planningHour || 0,
      planning_minute_ist: planningMinute || 0,
      timezone: settings.timezone,
      prepublication_lead_hours: settings.prePublicationLeadHours,
      posting_slots: postingSlots,
    },
    generation: {
      ...generation,
      full_ai_generation: true,
      allow_deterministic_content_fallback: false,
      allow_template_only_visual_fallback: false,
      max_content_revisions: settings.maxContentRevisions,
      max_image_retries: settings.maxImageRetries,
      default_visual_mode: settings.defaultVisualMode,
    },
    models: {
      ...models,
      research_model: settings.researchModel,
      strategy_model: settings.strategyModel,
      copy_model: settings.copyModel,
      compliance_model: settings.complianceModel,
      visual_direction_model: settings.visualDirectionModel,
      assembly_model: settings.assemblyModel,
      image_model: settings.imageModel || null,
      supervisor_model: settings.supervisorModel,
      audience_model: settings.audienceModel,
      growth_model: settings.growthModel,
      community_model: settings.communityModel,
    },
    cost_controls: {
      ...costs,
      monthly_budget_inr: settings.monthlyCostLimit,
    },
    duplicate_prevention: { ...duplicate, lookback_days: settings.duplicateLookbackDays },
    approval: { ...approval, require_human_approval: true },
    publishing: { ...publishing, auto_publish: settings.autoPublish },
    disclosures: {
      ...object(raw.disclosures),
      financial_disclaimer: settings.financialDisclaimer,
      affiliate_disclosure: settings.affiliateDisclosure,
    },
    utm: { ...object(raw.utm), source: settings.utmSource, medium: settings.utmMedium, campaign_prefix: settings.utmCampaignPrefix },
    notifications: { ...notifications, reviewer_emails: settings.notificationRecipients },
    community: {
      ...community,
      auto_reply: settings.autoReply,
      auto_dm: settings.autoDm,
      auto_hide_spam: settings.autoHideSpam,
    },
    analytics: {
      ...analytics,
      snapshot_intervals_hours: settings.analyticsIntervalsHours,
    },
  };
};

export const formatConfidence = (value: number | null) => {
  if (value === null) return "Not scored";
  const percent = value <= 1 ? value * 100 : value;
  return `${Math.round(percent)}%`;
};

export const appendUtm = (landingPage: string, utm: SocialRecommendation["utmParameters"]) => {
  if (!landingPage) return "";
  try {
    const url = new URL(landingPage, typeof window === "undefined" ? "https://pinkpaisa.in" : window.location.origin);
    if (utm.source) url.searchParams.set("utm_source", utm.source);
    if (utm.medium) url.searchParams.set("utm_medium", utm.medium);
    if (utm.campaign) url.searchParams.set("utm_campaign", utm.campaign);
    if (utm.content) url.searchParams.set("utm_content", utm.content);
    return url.toString();
  } catch {
    return landingPage;
  }
};

const INDIA_UTC_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Format an absolute timestamp for a datetime-local control operating in Asia/Kolkata. */
export const toDateTimeLocal = (value: string) => {
  if (!value) return "";
  if (DATE_TIME_LOCAL_PATTERN.test(value)) return value.slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Date(date.getTime() + INDIA_UTC_OFFSET_MS).toISOString().slice(0, 16);
};

/** Parse a datetime-local value as Asia/Kolkata, independently of the browser timezone. */
export const fromDateTimeLocal = (value: string) => {
  if (!value) return "";
  const match = DATE_TIME_LOCAL_PATTERN.exec(value);
  if (!match) {
    const absolute = new Date(value);
    return Number.isNaN(absolute.getTime()) ? "" : absolute.toISOString();
  }
  const [, year, month, day, hour, minute, second = "0"] = match;
  const utcMilliseconds = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ) - INDIA_UTC_OFFSET_MS;
  const parsed = new Date(utcMilliseconds);
  if (Number.isNaN(parsed.getTime()) || toDateTimeLocal(parsed.toISOString()) !== value.slice(0, 16)) return "";
  return parsed.toISOString();
};
