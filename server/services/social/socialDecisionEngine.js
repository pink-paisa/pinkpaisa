const openAiSocialProvider = require("./openAiSocialProvider");
const {
  buildUtmParameters,
  normalizeWhitespace,
  scanRecommendationCompliance,
  trimText,
  validateLandingPage,
} = require("./socialCompliance");
const {
  compareRecommendationToHistory,
  isMateriallyDifferent,
  normalizeScoreBreakdown,
} = require("./socialDecisionUtils");
const { validateRevisionResult, validateSocialPackage } = require("./socialSchemas");
const { validateScopedContentRevision } = require("./socialRevisionGuard");
const {
  resolvePinkPaisaArtDirection,
  serializePinkPaisaArtDirection,
} = require("./socialArtDirection");

const TIMEZONE = "Asia/Kolkata";
const MINIMUM_CANDIDATES = 5;
const DEFAULT_DUPLICATE_THRESHOLD = 0.72;
const SUPPORTED_FORMATS = new Set([
  "SINGLE_IMAGE",
  "CAROUSEL",
  "REEL",
  "VIDEO_FEED",
  "STORY",
  "INFOGRAPHIC",
  "MEME",
  "POLL",
  "QUIZ",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
]);

function getIstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getIstDayOfWeek(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long" }).format(date);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function providerOutput(result, stage) {
  const output = result?.output ?? result;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    const error = new Error(`The AI ${stage} stage returned no structured output`);
    error.code = "structured_output_invalid";
    throw error;
  }
  return output;
}

function usageTotal(results = []) {
  return results.reduce((total, result) => ({
    input_tokens: total.input_tokens + Number(result?.usage?.input_tokens || 0),
    output_tokens: total.output_tokens + Number(result?.usage?.output_tokens || 0),
    total_tokens: total.total_tokens + Number(result?.usage?.total_tokens || 0),
  }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function promptRun(stage, result, metadata = {}) {
  return {
    stage,
    provider: result?.provider || "openai",
    model: result?.model || null,
    prompt_version: result?.prompt_version || null,
    system_instructions_version: result?.prompt_version || null,
    response_id: result?.response_id || null,
    provider_response_id: result?.response_id || null,
    input_fingerprint: result?.input_fingerprint || null,
    output_fingerprint: result?.output_fingerprint || null,
    usage: result?.usage || {},
    attempt_count: Number(result?.attempt_count || safeArray(result?.attempts).length || 1),
    retry_number: Math.max(Number(result?.attempt_count || safeArray(result?.attempts).length || 1) - 1, 0),
    started_at: result?.started_at || null,
    completed_at: result?.completed_at || null,
    output_json: result?.output ? clone(result.output) : null,
    request_metadata: metadata,
    status: "SUCCEEDED",
  };
}

function sourceForRecommendation(source = {}) {
  return {
    title: trimText(source.title).slice(0, 300),
    url: trimText(source.url).slice(0, 2048),
    publishedAt: source.published_at ? new Date(source.published_at).toISOString() : null,
    accessedAt: source.accessed_at ? new Date(source.accessed_at).toISOString() : new Date().toISOString(),
    claimSupported: trimText(source.claim_supported || source.excerpt).slice(0, 600),
    confidence: Math.min(Math.max(Number(source.confidence || 0), 0), 1),
  };
}

function sourcesForIndexes(indexes = [], research = {}) {
  const sources = safeArray(research.sources);
  return [...new Set(safeArray(indexes).map(Number))]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < sources.length)
    .map((index) => sourceForRecommendation(sources[index]))
    .filter((source) => source.title && source.url && source.claimSupported);
}

function contentMix(settings = {}) {
  if (settings.content_mix && typeof settings.content_mix === "object") return settings.content_mix;
  return safeArray(settings.content_pillars).reduce((result, pillar) => {
    const name = trimText(pillar?.name);
    if (name) result[name] = Number(pillar.ratio || pillar.percentage || 0);
    return result;
  }, {});
}

function normalizedGenerationRequest(value = {}) {
  const requestedFormat = trimText(value.requested_format || value.format_preference || "AUTO_CHOOSE")
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^AUTO$/, "AUTO_CHOOSE");
  return {
    requested_format: requestedFormat,
    requested_post_type: trimText(value.requested_post_type) || null,
    generation_scope: trimText(value.generation_scope || "FULL_POST").toUpperCase(),
    visual_mode: trimText(value.visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY").toUpperCase(),
    admin_instructions: trimText(value.admin_instructions) || null,
    verified_product_id: trimText(value.verified_product_id || value.product_id) || null,
    weekly_candidate: value.weekly_candidate && typeof value.weekly_candidate === "object"
      ? clone(value.weekly_candidate)
      : null,
    required_landing_page: trimText(value.required_landing_page) || null,
  };
}

function weeklyCandidateAsRequiredCandidate(weeklyCandidate, internalSignals = {}) {
  if (!weeklyCandidate || typeof weeklyCandidate !== "object") return null;
  const candidateId = trimText(weeklyCandidate.candidateId || weeklyCandidate.candidate_id);
  const topic = trimText(weeklyCandidate.topic);
  const format = ({ POLL_CONCEPT: "POLL", WORKSHOP_PROMOTION: "EVENT_OR_WORKSHOP_PROMOTION" })[
    trimText(weeklyCandidate.format).toUpperCase()
  ] || trimText(weeklyCandidate.format).toUpperCase();
  if (!candidateId || !topic || !format) {
    const error = new Error("The approved weekly candidate snapshot is incomplete");
    error.code = "social_weekly_candidate_invalid";
    throw error;
  }
  const verifiedProductId = trimText(weeklyCandidate.verifiedInternalEntityId || weeklyCandidate.verified_internal_entity_id) || null;
  const verifiedProduct = verifiedProductId
    ? safeArray(internalSignals.products).find((product) => trimText(product.id) === verifiedProductId && product.is_active !== false)
    : null;
  return {
    id: `weekly-${candidateId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 70)}`,
    internalTitle: trimText(weeklyCandidate.title || weeklyCandidate.internalTitle).slice(0, 180),
    topic: topic.slice(0, 240),
    whyToday: trimText(weeklyCandidate.whyThisWeek || weeklyCandidate.why_this_week).slice(0, 700),
    objective: trimText(weeklyCandidate.objective).toUpperCase(),
    format,
    contentPillar: trimText(weeklyCandidate.contentPillar || weeklyCandidate.content_pillar),
    targetAudienceSegment: trimText(weeklyCandidate.audienceSegment || weeklyCandidate.audience_segment).slice(0, 240),
    businessObjective: trimText(weeklyCandidate.pinkPaisaConnection || weeklyCandidate.pink_paisa_connection).slice(0, 400),
    verifiedProductId,
    verifiedProductTitle: verifiedProduct ? trimText(verifiedProduct.title) : null,
    // Weekly source indexes refer to the cached weekly digest, not the fresh
    // pre-publication research array. Fresh copy must cite its own validated
    // sources, while the approved strategic identity remains immutable.
    evidenceSourceIndexes: [],
    isEvergreen: true,
    riskFlags: [],
    recommendedLandingPage: trimText(weeklyCandidate.recommendedLandingPage || weeklyCandidate.recommended_landing_page) || null,
    _weekly_required: true,
    _weekly_candidate_id: candidateId,
  };
}

function productIsRequired(candidate = {}, generationRequest = {}) {
  return candidate.format === "PRODUCT_FEATURE"
    || Boolean(candidate.verifiedProductId)
    || candidate.contentPillar === "Curated Wellness and Affiliate Products"
    || Boolean(generationRequest.verified_product_id);
}

function productMediaUrl(product = {}) {
  return trimText(product.media_url || product.image_url || product.featured_image) || null;
}

function prepareVerifiedCandidate(candidate = {}, internalSignals = {}, generationRequest = {}) {
  const requestedProductId = trimText(generationRequest.verified_product_id);
  if (!productIsRequired(candidate, generationRequest)) {
    if (candidate.verifiedProductId || candidate.verifiedProductTitle) {
      return { ...candidate, server_rejection_reason: "The idea referenced a product outside a product or affiliate strategy." };
    }
    return { ...candidate, verifiedProductId: null, verifiedProductTitle: null, _verifiedProduct: null };
  }
  const candidateProductId = trimText(candidate.verifiedProductId || requestedProductId);
  const product = safeArray(internalSignals.products).find((row) => (
    trimText(row.id) === candidateProductId
    && (!requestedProductId || trimText(row.id) === requestedProductId)
    && row.is_active !== false
  ));
  if (!product) {
    return { ...candidate, server_rejection_reason: "The product idea did not use the exact requested active Pink Paisa database product." };
  }
  if (trimText(candidate.verifiedProductTitle) !== trimText(product.title)) {
    return { ...candidate, server_rejection_reason: "The AI product title did not exactly match the verified Pink Paisa database title." };
  }
  if (!product.landing_page || !productMediaUrl(product)) {
    return { ...candidate, server_rejection_reason: "The selected product is missing a verified Pink Paisa landing page or authentic product image." };
  }
  if (product.is_affiliate && (
    product.compliance_status !== "compliant"
    || !product.verified_affiliate_url
    || product.affiliate_is_instagram_pick !== true
    || product.affiliate_link_check_status !== "ok"
    || !["admin_confirmed", "owned", "licensed", "api_permitted"].includes(product.usage_rights_status)
  )) {
    return { ...candidate, server_rejection_reason: "The selected affiliate product must be an approved Instagram pick with link health exactly ok, a verified URL, compliant status, and rights-cleared image." };
  }
  return {
    ...candidate,
    verifiedProductId: product.id,
    verifiedProductTitle: product.title,
    _verifiedProduct: product,
  };
}

function verifiedProductFacts(candidate = {}) {
  const product = candidate._verifiedProduct;
  if (!product) return null;
  return {
    id: trimText(product.id),
    title: trimText(product.title),
    imageUrl: productMediaUrl(product),
    brand: trimText(product.brand_name) || null,
    category: trimText(product.category) || null,
    subcategory: trimText(product.subcategory) || null,
    asin: trimText(product.affiliate_asin) || null,
    description: trimText(product.short_description).slice(0, 500) || null,
    affiliateUrl: trimText(product.verified_affiliate_url) || null,
    landingPage: trimText(product.landing_page) || null,
  };
}

function complianceCandidateContext(candidate = {}) {
  const productId = trimText(candidate.verifiedProductId) || null;
  const productTitle = trimText(candidate.verifiedProductTitle) || null;
  return {
    id: trimText(candidate.id),
    topic: trimText(candidate.topic),
    format: trimText(candidate.format),
    pillar: trimText(candidate.contentPillar),
    audience: trimText(candidate.targetAudienceSegment),
    product: productId || productTitle ? { id: productId, title: productTitle } : null,
    evidence: {
      sourceIndexes: [...new Set(safeArray(candidate.evidenceSourceIndexes).map(Number))]
        .filter((index) => Number.isInteger(index) && index >= 0),
    },
    evergreen: Boolean(candidate.isEvergreen),
  };
}

function complianceDestinationContext(destinations = []) {
  return safeArray(destinations).map((destination, index) => {
    const landingPage = validateLandingPage(
      typeof destination === "string"
        ? destination
        : destination?.landingPage || destination?.landing_page || destination?.url,
    );
    if (!landingPage) return null;
    return {
      id: trimText(destination?.id) || `verified-destination-${index + 1}`,
      type: trimText(destination?.type) || "RESOURCE",
      title: trimText(destination?.title || destination?.label) || "Verified Pink Paisa resource",
      landingPage,
    };
  }).filter(Boolean);
}

function buildComplianceReviewContext({
  generationDate,
  candidate,
  formatContent,
  verifiedProduct = null,
  validatedSources = [],
  allowedDestinations = [],
  administratorDirection = null,
} = {}) {
  return {
    generationDate: generationDate || null,
    candidate: complianceCandidateContext(candidate),
    format_content: clone(formatContent),
    verified_product: clone(verifiedProduct),
    validated_sources: clone(safeArray(validatedSources)),
    allowed_destinations: complianceDestinationContext(allowedDestinations),
    review_scope: {
      publishable_field: "format_content",
      instruction: "Review only format_content as the proposed publishable package. Candidate is immutable identification and evidence metadata, not publishable copy; do not flag it or request candidate-field edits.",
    },
    allowed_destination_evidence_scope: "Each allowed_destinations row proves only an active, verified first-party Pink Paisa resource identity and public path. It does not substantiate any unlisted feature, capability, offer, availability, outcome, or other factual claim; those require verified_product or validated_sources evidence.",
    administrator_direction: trimText(administratorDirection) || null,
    hard_requirements: {
      human_approval_required: true,
      no_personalised_financial_advice: true,
      no_unverified_product_or_current_claims: true,
    },
  };
}

function allowedDestinationRows(internalSignals = {}) {
  const rows = [{ id: "pink-paisa-home", type: "WEBSITE", title: "Pink Paisa home", landingPage: "/" }];
  const collections = [
    ["PRODUCT", internalSignals.products],
    ["BLOG", internalSignals.blogs],
    ["WORKSHOP", internalSignals.workshops],
    ["RESOURCE", internalSignals.virtual_products],
    ["POLL", internalSignals.polls],
    ["RESOURCE", internalSignals.static_resources],
  ];
  for (const [type, values] of collections) {
    for (const value of safeArray(values)) {
      const raw = value?.landing_page || value?.landingPage;
      if (!raw || value?.active === false || value?.is_active === false) continue;
      try {
        rows.push({
          id: trimText(value.id || value.type) || null,
          type,
          title: trimText(value.title || value.name || value.type).slice(0, 240),
          landingPage: validateLandingPage(raw),
        });
      } catch (_error) {
        // Invalid or non-first-party destinations are intentionally excluded.
      }
    }
  }
  return [...new Map(rows.map((row) => [row.landingPage, row])).values()];
}

function validateAiDestination(content, candidate, destinations, generationRequest = {}) {
  const requested = validateLandingPage(content.recommendedLandingPage);
  if (candidate._weekly_required) {
    const required = generationRequest.required_landing_page
      ? validateLandingPage(generationRequest.required_landing_page)
      : null;
    if (requested !== required) {
      const error = new Error("AI content changed the approved weekly landing-page destination");
      error.code = "social_weekly_destination_mismatch";
      throw error;
    }
  }
  const product = candidate._verifiedProduct;
  if (product) {
    const verified = validateLandingPage(product.landing_page);
    if (requested !== verified) {
      const error = new Error("AI product content did not preserve the verified Pink Paisa product landing page");
      error.code = "social_product_destination_invalid";
      throw error;
    }
    return requested;
  }
  if (requested && !destinations.some((row) => row.landingPage === requested)) {
    const error = new Error("AI content selected a destination outside the active verified Pink Paisa resources");
    error.code = "social_destination_not_verified";
    throw error;
  }
  return requested;
}

function candidateDiversityCheck(candidates, threshold) {
  const ids = new Set();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (ids.has(candidate.id)) {
      const error = new Error(`AI candidate id ${candidate.id} was duplicated`);
      error.code = "social_candidates_not_materially_different";
      throw error;
    }
    ids.add(candidate.id);
    const comparison = compareRecommendationToHistory(candidate, candidates.slice(0, index));
    if (index > 0 && !isMateriallyDifferent(comparison, threshold)) {
      const error = new Error(`AI candidates were not materially different; ${candidate.id} repeated an earlier idea`);
      error.code = "social_candidates_not_materially_different";
      error.duplicate_analysis = comparison;
      throw error;
    }
  }
}

function serverCandidateAssessment(candidate, {
  history = [],
  research = {},
  requestedFormat = "AUTO_CHOOSE",
  duplicateThreshold = DEFAULT_DUPLICATE_THRESHOLD,
  strategistScore = {},
} = {}) {
  const duplicateAnalysis = compareRecommendationToHistory(candidate, history);
  const sourceCount = sourcesForIndexes(candidate.evidenceSourceIndexes, research).length;
  const riskFlags = [];
  let hardRejection = candidate.server_rejection_reason || null;
  if (!SUPPORTED_FORMATS.has(candidate.format)) hardRejection = `Unsupported selected format ${candidate.format}`;
  if (requestedFormat !== "AUTO_CHOOSE" && candidate.format !== requestedFormat) {
    hardRejection = `The requested ${requestedFormat} format was not preserved`;
  }
  if (!candidate.isEvergreen && sourceCount < 1) hardRejection = "A timely candidate did not cite any validated supporting evidence";
  if (!isMateriallyDifferent(duplicateAnalysis, duplicateThreshold)) {
    hardRejection = `The candidate is too similar to recent content (${Math.round(Number(duplicateAnalysis.similarity || 0) * 100)}%)`;
    riskFlags.push("recent_content_duplicate");
  }
  return {
    ...candidate,
    scoreBreakdown: normalizeScoreBreakdown(strategistScore),
    duplicate_analysis: duplicateAnalysis,
    duplicate_rejected: !isMateriallyDifferent(duplicateAnalysis, duplicateThreshold),
    server_rejection_reason: hardRejection,
    server_risk_flags: riskFlags,
    server_eligible: !hardRejection,
  };
}

function validateStrategistSelection(strategy, candidates) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selectedIds = [strategy.selectedPrimaryId, ...safeArray(strategy.alternativeIds)];
  if (new Set(selectedIds).size !== 3 || selectedIds.some((id) => !byId.has(id))) {
    const error = new Error("AI strategist did not select one valid primary and exactly two distinct alternatives");
    error.code = "social_ai_selection_invalid";
    throw error;
  }
  const selected = selectedIds.map((id) => byId.get(id));
  const blocked = selected.filter((candidate) => !candidate.server_eligible);
  if (blocked.length) {
    const error = new Error(`AI strategist selected an ineligible candidate: ${blocked.map((row) => `${row.id} (${row.server_rejection_reason})`).join("; ")}`);
    error.code = "social_ai_selection_ineligible";
    error.issues = blocked.map((row) => row.server_rejection_reason);
    throw error;
  }
  return selected;
}

function legacyOnPostCopy(formatContent = {}) {
  const format = formatContent.format;
  if (format === "CAROUSEL") {
    return {
      headline: formatContent.slides[0]?.headline || null,
      supportingCopy: formatContent.narrativeArc || null,
      slides: formatContent.slides.map((slide) => ({
        slideNumber: slide.slideNumber,
        headline: slide.headline,
        body: slide.body,
        visualInstruction: slide.overlayInstructions,
      })),
      storyFrames: [],
      reelScenes: [],
    };
  }
  if (format === "STORY") {
    return {
      headline: formatContent.frames[0]?.copy || null,
      supportingCopy: null,
      slides: [],
      storyFrames: formatContent.frames.map((frame) => ({
        frameNumber: frame.frameNumber,
        copy: frame.copy,
        visualInstruction: frame.overlayInstructions,
      })),
      reelScenes: [],
    };
  }
  if (["REEL", "VIDEO_FEED"].includes(format)) {
    return {
      headline: formatContent.coverHeadline,
      supportingCopy: formatContent.audioDirection,
      slides: [],
      storyFrames: [],
      reelScenes: formatContent.scenes.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        durationSeconds: scene.durationSeconds,
        voiceover: scene.voiceover,
        onScreenText: scene.onScreenText,
        visualInstruction: scene.visualInstruction,
      })),
    };
  }
  return {
    headline: formatContent.selectedHeadline || null,
    supportingCopy: formatContent.supportingText || formatContent.interactionCopy || null,
    slides: [],
    storyFrames: [],
    reelScenes: [],
  };
}

function legacyVisualConcept(brief = {}) {
  return {
    layout: trimText(brief.composition).slice(0, 300),
    mainVisual: trimText(`${brief.subject || ""}; ${brief.setting || ""}`).slice(0, 500),
    textHierarchy: safeArray(brief.textSafeRegions).join("; ").slice(0, 400) || "Follow the approved text-safe regions in the AI visual brief.",
    graphicElements: safeArray(brief.assets).flatMap((asset) => safeArray(asset.requiredObjects)).join("; ").slice(0, 400) || "Use only the objects in the approved AI visual brief.",
    mood: trimText(brief.mood).slice(0, 250),
    photographyOrIllustrationDirection: trimText(`${brief.cameraAngle || ""}; ${brief.lighting || ""}; ${brief.indianCulturalContext || ""}`).slice(0, 500),
    aspectRatio: brief.aspectRatio,
  };
}

function recommendationForCompliance({ candidate, content, research, generationDate, landingPage }) {
  const sources = sourcesForIndexes([...safeArray(candidate.evidenceSourceIndexes), ...safeArray(content.sourceIndexes)], research);
  return {
    internalTitle: candidate.internalTitle,
    whyToday: content.whyToday,
    objective: content.objective,
    format: candidate.format,
    contentPillar: content.contentPillar,
    targetAudienceSegment: content.targetAudience,
    topic: candidate.topic,
    verifiedProductId: candidate.verifiedProductId || null,
    verifiedProductTitle: candidate.verifiedProductTitle || null,
    hooks: content.hookOptions,
    onPostCopy: legacyOnPostCopy(content),
    caption: content.caption,
    cta: content.cta,
    hashtags: content.hashtags,
    altText: content.altText,
    financialDisclaimer: content.financialDisclaimer,
    affiliateDisclosure: content.affiliateDisclosure,
    recommendedLandingPage: landingPage,
    utmParameters: buildUtmParameters({
      topic: candidate.topic,
      contentPillar: content.contentPillar,
      generationDate,
      content: candidate.id,
    }),
    sources,
    riskFlags: safeArray(candidate.riskFlags),
  };
}

function complianceFailure(candidate, review, history, message) {
  const error = new Error(message || `AI content for ${candidate.id} did not pass compliance`);
  error.code = "social_compliance_exhausted";
  error.statusCode = 422;
  error.compliance = review;
  error.compliance_history = history;
  return error;
}

async function generateCompliantContent({
  candidate,
  generationDate,
  research,
  settings,
  generationRequest,
  destinations,
  providers,
  dependencies,
  promptRuns,
  promptResults,
  revisionAttempts,
  complianceHistory,
}) {
  const shared = { settings, dependencies };
  const verifiedFacts = verifiedProductFacts(candidate);
  const writeResult = await providers.writeFormatContent({
    ...shared,
    format: candidate.format,
    context: {
      generationDate,
      timezone: TIMEZONE,
      brand_profile: settings.brand_profile,
      selected_candidate: candidate,
      verified_product: verifiedFacts,
      allowed_destinations: destinations,
      validated_sources: research.sources,
      requested_post_type: generationRequest.requested_post_type,
      administrator_direction: generationRequest.admin_instructions,
      required_financial_disclosure_guidance: settings.financial_disclaimer || null,
      required_affiliate_disclosure_guidance: settings.affiliate_disclosure || null,
    },
  });
  promptResults.push(writeResult);
  promptRuns.push(promptRun("format_copy", writeResult, { candidate_id: candidate.id, format: candidate.format }));
  let content = providerOutput(writeResult, "format-specific copy");
  if (content.id !== candidate.id || content.format !== candidate.format) {
    const error = new Error("AI copy changed the selected candidate id or format");
    error.code = "social_format_content_identity_invalid";
    throw error;
  }
  let revisionsUsed = 0;
  const maximumRevisions = Math.max(Number(
    settings.ai_generation?.max_content_revisions
    || settings.max_content_revisions
    || process.env.SOCIAL_MAX_CONTENT_REVISIONS
    || 3
  ), 0);

  while (true) {
    if (candidate._weekly_required && (
      content.objective !== candidate.objective
      || content.contentPillar !== candidate.contentPillar
      || content.targetAudience !== candidate.targetAudienceSegment
    )) {
      const error = new Error("AI copy changed the approved weekly objective, content pillar, or audience");
      error.code = "social_weekly_content_identity_mismatch";
      throw error;
    }
    const landingPage = validateAiDestination(content, candidate, destinations, generationRequest);
    if (candidate._verifiedProduct) {
      if (content.verifiedProductId !== candidate.verifiedProductId
        || content.verifiedProductTitle !== candidate.verifiedProductTitle
        || content.verifiedProductImageUrl !== productMediaUrl(candidate._verifiedProduct)) {
        throw complianceFailure(candidate, null, complianceHistory, "AI product copy changed a verified product identifier, title, or authentic image URL");
      }
    }
    const reviewResult = await providers.reviewSingleCompliance({
      ...shared,
      context: buildComplianceReviewContext({
        generationDate,
        candidate,
        formatContent: content,
        verifiedProduct: verifiedFacts,
        validatedSources: research.sources,
        allowedDestinations: destinations,
      }),
    });
    promptResults.push(reviewResult);
    promptRuns.push(promptRun("single_compliance", reviewResult, { candidate_id: candidate.id, review_number: revisionsUsed + 1 }));
    const aiReview = providerOutput(reviewResult, "compliance review");
    if (aiReview.id !== candidate.id) {
      const error = new Error("AI compliance review returned the wrong candidate id");
      error.code = "structured_output_invalid";
      throw error;
    }
    const assembled = recommendationForCompliance({ candidate, content, research, generationDate, landingPage });
    const serverReview = scanRecommendationCompliance(assembled, { requireSourcesForCurrentClaims: true });
    const effectiveReview = aiReview.decision === "PASS" && !serverReview.passed
      ? {
        ...aiReview,
        decision: "REVISE",
        issues: [
          ...safeArray(aiReview.issues),
          ...safeArray(serverReview.issues).filter((issue) => issue.severity === "error").map((issue) => ({
            code: issue.code,
            severity: "ERROR",
            fieldPath: null,
            message: issue.message,
          })),
        ],
        riskFlags: [...new Set([...safeArray(aiReview.riskFlags), ...safeArray(serverReview.risk_flags)])],
        requiredChanges: [
          ...safeArray(aiReview.requiredChanges),
          ...safeArray(serverReview.issues).filter((issue) => issue.severity === "error").map((issue) => issue.message),
        ],
        conciseRationale: "The independent AI review passed, but one or more non-negotiable server safety rules require a bounded AI correction.",
      }
      : aiReview;
    complianceHistory.push({
      candidate_id: candidate.id,
      review_number: revisionsUsed + 1,
      decision: effectiveReview.decision,
      issues: clone(effectiveReview.issues || []),
      risk_flags: clone(effectiveReview.riskFlags || []),
      unsupported_claims: clone(effectiveReview.unsupportedClaims || []),
      required_changes: clone(effectiveReview.requiredChanges || []),
      concise_rationale: effectiveReview.conciseRationale,
      provider: reviewResult.provider || "openai",
      model: reviewResult.model || null,
      prompt_version: reviewResult.prompt_version || null,
      response_id: reviewResult.response_id || null,
    });
    if (effectiveReview.decision === "PASS") {
      return { content, review: effectiveReview, serverReview, landingPage, verifiedFacts };
    }
    if (effectiveReview.decision === "REJECT") {
      throw complianceFailure(candidate, effectiveReview, complianceHistory, `AI compliance rejected the core idea for ${candidate.id}`);
    }
    if (revisionsUsed >= maximumRevisions) {
      throw complianceFailure(candidate, effectiveReview, complianceHistory, `AI compliance revisions were exhausted for ${candidate.id}`);
    }
    const revisionNumber = revisionsUsed + 1;
    const revisionStartedAt = new Date();
    const revisionResult = await providers.reviseFormatContent({
      ...shared,
      format: candidate.format,
      context: {
        generationDate,
        candidate,
        original_content: content,
        compliance_feedback: effectiveReview,
        verified_product: verifiedFacts,
        validated_sources: research.sources,
        allowed_destinations: destinations,
        instruction: "Revise only the cited problems and return the complete corrected format-specific package.",
      },
    });
    promptResults.push(revisionResult);
    promptRuns.push(promptRun("revision", revisionResult, { candidate_id: candidate.id, revision_number: revisionNumber, format: candidate.format }));
    const revision = validateScopedContentRevision({
      originalContent: content,
      complianceFeedback: effectiveReview,
      revision: validateRevisionResult(candidate.format, providerOutput(revisionResult, "content revision")),
    });
    if (revision.id !== candidate.id || revision.format !== candidate.format) {
      const error = new Error("AI compliance revision changed the selected candidate id or format");
      error.code = "structured_output_invalid";
      throw error;
    }
    content = revision.revisedContent;
    revisionsUsed += 1;
    revisionAttempts.push({
      attempt_number: revisionAttempts.length + 1,
      candidate_id: candidate.id,
      compliance_decision: "REVISE",
      issues: safeArray(effectiveReview.issues).map((issue) => `${issue.code}: ${issue.message}`),
      revision_instructions: safeArray(effectiveReview.requiredChanges),
      provider: revisionResult.provider || "openai",
      model: revisionResult.model || null,
      provider_response_id: revisionResult.response_id || null,
      input_fingerprint: revisionResult.input_fingerprint || null,
      output_fingerprint: revisionResult.output_fingerprint || null,
      revised_output_json: clone(content),
      usage: revisionResult.usage || {},
      status: "COMPLETED",
      started_at: revisionStartedAt,
      completed_at: revisionResult.completed_at || new Date(),
      failure_reason: null,
    });
  }
}

function canonicalRecommendation({ candidate, contentResult, visualBrief, research, generationDate, strategistScore }) {
  const content = contentResult.content;
  const sources = sourcesForIndexes([...safeArray(candidate.evidenceSourceIndexes), ...safeArray(content.sourceIndexes)], research);
  return {
    internalTitle: candidate.internalTitle,
    whyToday: content.whyToday,
    objective: content.objective,
    format: candidate.format,
    formatReason: content.formatReason,
    postType: content.postType,
    contentPillar: content.contentPillar,
    targetAudienceSegment: content.targetAudience,
    topic: candidate.topic,
    verifiedProductId: candidate.verifiedProductId || null,
    verifiedProductTitle: candidate.verifiedProductTitle || null,
    verifiedProductFacts: contentResult.verifiedFacts,
    hooks: content.hookOptions,
    onPostCopy: legacyOnPostCopy(content),
    caption: content.caption,
    cta: content.cta,
    hashtags: content.hashtags,
    formatContent: clone(content),
    visualBrief: clone(visualBrief),
    visualConcept: legacyVisualConcept(visualBrief),
    imageGenerationPrompt: visualBrief.assets[0].imagePrompt,
    altText: content.altText,
    financialDisclaimer: content.financialDisclaimer,
    affiliateDisclosure: content.affiliateDisclosure,
    recommendedLandingPage: contentResult.landingPage,
    utmParameters: buildUtmParameters({
      topic: candidate.topic,
      contentPillar: content.contentPillar,
      generationDate,
      content: candidate.id,
    }),
    sources,
    confidence: Math.min(Math.max(Number(strategistScore?.total || 0) / 100, 0), 1),
    riskFlags: [...new Set([
      ...safeArray(candidate.riskFlags),
      ...safeArray(candidate.server_risk_flags),
      ...safeArray(contentResult.review?.riskFlags),
      ...safeArray(contentResult.serverReview?.risk_flags),
    ])],
    scoreBreakdown: normalizeScoreBreakdown(strategistScore),
  };
}

async function runAiDecision({
  now = new Date(),
  internalSignals = {},
  research = {},
  settings = {},
  generationRequest = {},
  providers = {},
  dependencies = {},
} = {}) {
  const generationDate = getIstDateKey(now);
  const request = normalizedGenerationRequest(generationRequest);
  const requiredWeeklyCandidate = weeklyCandidateAsRequiredCandidate(request.weekly_candidate, internalSignals);
  const duplicateThreshold = Math.min(Math.max(Number(settings.duplicate_similarity_threshold || DEFAULT_DUPLICATE_THRESHOLD), 0.5), 0.95);
  const ai = {
    analyzeMarketContext: providers.analyzeMarketContext || openAiSocialProvider.analyzeMarketContext,
    generateCandidates: providers.generateCandidates || openAiSocialProvider.generateCandidates,
    scoreCandidates: providers.scoreCandidates || openAiSocialProvider.scoreCandidates,
    writeFormatContent: providers.writeFormatContent || openAiSocialProvider.writeFormatContent,
    reviewSingleCompliance: providers.reviewSingleCompliance || openAiSocialProvider.reviewSingleCompliance,
    reviseFormatContent: providers.reviseFormatContent || openAiSocialProvider.reviseFormatContent,
    buildFormatVisualBrief: providers.buildFormatVisualBrief || openAiSocialProvider.buildFormatVisualBrief,
  };
  const shared = { settings, dependencies };
  const promptRuns = [];
  const promptResults = [];
  const revisionAttempts = [];
  const complianceHistory = [];
  const destinations = allowedDestinationRows(internalSignals);

  const marketResult = await ai.analyzeMarketContext({
    ...shared,
    context: {
      generationDate,
      timezone: TIMEZONE,
      dayOfWeek: internalSignals.day_of_week || getIstDayOfWeek(now),
      salaryCycleContext: internalSignals.salary_cycle_context || "Use the supplied date to assess salary-cycle relevance without assuming the audience is salaried.",
      brand_profile: settings.brand_profile,
      target_audience: settings.target_audience,
      administrator_priorities: internalSignals.priorities,
      internal_signal_summary: internalSignals.summary,
      active_resources: {
        products: safeArray(internalSignals.products),
        blogs: safeArray(internalSignals.blogs),
        workshops: safeArray(internalSignals.workshops),
        virtual_products: safeArray(internalSignals.virtual_products),
        polls: safeArray(internalSignals.polls),
        static_resources: safeArray(internalSignals.static_resources),
      },
      recent_posts_and_drafts: safeArray(internalSignals.recent_history).slice(0, 90),
      scheduled_next_14_days: safeArray(internalSignals.scheduled_drafts_next_14_days),
      aggregate_performance: internalSignals.performance_summary || internalSignals.affiliate_performance_30d || [],
      aggregate_website_traffic: internalSignals.website_traffic || null,
      aggregate_quiz_and_calculator_usage: internalSignals.quiz_and_calculator_usage || null,
      validated_research_signals: safeArray(research.signals),
      validated_research_sources: safeArray(research.sources),
      weak_or_unconfirmed_topics: safeArray(research.unconfirmed_topics),
      external_research_status: {
        mode: research.mode || "unknown",
        evidence_gap_reason: research.evidence_gap_reason || null,
      },
      generation_request: request,
    },
  });
  promptResults.push(marketResult);
  promptRuns.push(promptRun("market_analysis", marketResult));
  const marketAnalysis = providerOutput(marketResult, "daily market analysis");

  const candidateResult = await ai.generateCandidates({
    ...shared,
    context: {
      generationDate,
      timezone: TIMEZONE,
      daily_market_analysis: marketAnalysis,
      generation_request: request,
      brand_profile: settings.brand_profile,
      target_audience: settings.target_audience,
      enabled_content_pillars: safeArray(settings.content_pillars).filter((pillar) => pillar.enabled !== false),
      content_mix: contentMix(settings),
      business_priorities: internalSignals.priorities,
      active_internal_resources: {
        summary: internalSignals.summary,
        products: safeArray(internalSignals.products).slice(0, 30),
        blogs: safeArray(internalSignals.blogs),
        workshops: safeArray(internalSignals.workshops),
        virtual_products: safeArray(internalSignals.virtual_products),
        polls: safeArray(internalSignals.polls),
        static_resources: safeArray(internalSignals.static_resources),
      },
      allowed_destinations: destinations,
      recent_history: safeArray(internalSignals.recent_history).slice(0, 90),
      validated_research_signals: safeArray(research.signals),
      validated_research_sources: safeArray(research.sources),
    },
  });
  promptResults.push(candidateResult);
  promptRuns.push(promptRun("candidates", candidateResult));
  let rawCandidates = safeArray(providerOutput(candidateResult, "candidate generation").candidates);
  if (request.requested_format !== "AUTO_CHOOSE") {
    rawCandidates = rawCandidates.map((candidate) => ({
      ...candidate,
      format: request.requested_format,
    }));
  }
  if (requiredWeeklyCandidate) {
    const weeklyTopicKey = trimText(requiredWeeklyCandidate.topic).toLowerCase();
    const distinctCandidates = [requiredWeeklyCandidate];
    for (const candidate of rawCandidates) {
      if (candidate.id === requiredWeeklyCandidate.id
        || trimText(candidate.topic).toLowerCase() === weeklyTopicKey) continue;
      const comparison = compareRecommendationToHistory(candidate, distinctCandidates);
      if (isMateriallyDifferent(comparison, duplicateThreshold)) distinctCandidates.push(candidate);
      if (distinctCandidates.length >= 8) break;
    }
    rawCandidates = distinctCandidates;
  }
  if (rawCandidates.length < MINIMUM_CANDIDATES) {
    const error = new Error("AI candidate generation returned fewer than five candidates");
    error.code = "social_candidate_count_invalid";
    throw error;
  }
  candidateDiversityCheck(rawCandidates, duplicateThreshold);

  const strategyResult = await ai.scoreCandidates({
    ...shared,
    context: {
      generationDate,
      generation_request: request,
      daily_market_analysis: marketAnalysis,
      scoring_rubric: {
        brandRelevance: 25,
        audienceUsefulness: 20,
        timeliness: 15,
        originality: 15,
        engagementPotential: 10,
        businessAlignment: 10,
        evidenceQuality: 5,
        compliancePenalty: -30,
      },
      duplicate_threshold: duplicateThreshold,
      recent_history: safeArray(internalSignals.recent_history).slice(0, 90),
      candidates: rawCandidates,
      validated_research_sources: safeArray(research.sources),
    },
  });
  promptResults.push(strategyResult);
  promptRuns.push(promptRun("strategy", strategyResult));
  let strategy = providerOutput(strategyResult, "strategic selection");
  const strategistRows = safeArray(strategy.scoredCandidates);
  const strategistById = new Map(strategistRows.map((row) => [row.id, row]));
  if (strategistRows.length !== rawCandidates.length || rawCandidates.some((candidate) => !strategistById.has(candidate.id))) {
    const error = new Error("AI strategist did not score every generated candidate exactly once");
    error.code = "social_ai_selection_invalid";
    throw error;
  }
  const assessedCandidates = rawCandidates.map((candidate) => serverCandidateAssessment(
    prepareVerifiedCandidate(candidate, internalSignals, request),
    {
      history: internalSignals.recent_history,
      research,
      requestedFormat: request.requested_format,
      duplicateThreshold,
      strategistScore: strategistById.get(candidate.id).scoreBreakdown,
    }
  ));
  if (requiredWeeklyCandidate) {
    const eligibleIds = new Set(assessedCandidates
      .filter((candidate) => candidate.server_eligible)
      .map((candidate) => candidate.id));
    const rankedIds = strategistRows
      .slice()
      .sort((left, right) => Number(right.scoreBreakdown?.total || 0) - Number(left.scoreBreakdown?.total || 0))
      .map((row) => row.id);
    const alternativeIds = [...new Set([
      strategy.selectedPrimaryId,
      ...safeArray(strategy.alternativeIds),
      ...rankedIds,
    ])].filter((id) => id !== requiredWeeklyCandidate.id && eligibleIds.has(id)).slice(0, 2);
    if (alternativeIds.length !== 2) {
      const error = new Error("The strategist did not provide two eligible alternatives to the approved weekly candidate");
      error.code = "social_ai_selection_invalid";
      throw error;
    }
    strategy = {
      ...strategy,
      selectedPrimaryId: requiredWeeklyCandidate.id,
      alternativeIds,
    };
  }
  const selected = validateStrategistSelection(strategy, assessedCandidates);
  const selectedIds = new Set(selected.map((candidate) => candidate.id));

  const contentById = new Map();
  const visualById = new Map();
  for (const candidate of selected) {
    let contentResult;
    try {
      contentResult = await generateCompliantContent({
        candidate,
        generationDate,
        research,
        settings,
        generationRequest: request,
        destinations,
        providers: ai,
        dependencies,
        promptRuns,
        promptResults,
        revisionAttempts,
        complianceHistory,
      });
    } catch (error) {
      error.content_revision_attempts = clone(revisionAttempts);
      error.compliance_history = error.compliance_history || clone(complianceHistory);
      throw error;
    }
    contentById.set(candidate.id, contentResult);
    const artDirection = serializePinkPaisaArtDirection(resolvePinkPaisaArtDirection({
      ...candidate,
      ...contentResult.content,
      formatContent: contentResult.content,
    }));
    const visualResult = await ai.buildFormatVisualBrief({
      ...shared,
      format: candidate.format,
      context: {
        generationDate,
        candidate,
        approved_format_content: contentResult.content,
        visual_mode: request.visual_mode,
        art_direction: artDirection,
        brand_profile: settings.brand_profile,
        brand_tokens: settings.brand_tokens,
        verified_product: contentResult.verifiedFacts,
        references: settings.brand_references || [],
        recent_visual_directions: safeArray(internalSignals.recent_history).slice(0, 30).map((row) => row.primaryRecommendation?.visualBrief || row.primaryRecommendation?.visualConcept).filter(Boolean),
      },
    });
    promptResults.push(visualResult);
    promptRuns.push(promptRun("visual_brief", visualResult, { candidate_id: candidate.id, format: candidate.format }));
    const brief = providerOutput(visualResult, "format visual brief");
    if (brief.id !== candidate.id || brief.format !== candidate.format || brief.visualMode !== request.visual_mode) {
      const error = new Error("AI visual brief changed the approved candidate, format, or visual mode");
      error.code = "social_visual_brief_identity_invalid";
      throw error;
    }
    if (candidate._verifiedProduct) {
      const authentic = brief.authenticProductReference;
      if (!authentic
        || authentic.productId !== candidate.verifiedProductId
        || authentic.productTitle !== candidate.verifiedProductTitle
        || authentic.imageUrl !== productMediaUrl(candidate._verifiedProduct)) {
        const error = new Error("AI visual brief did not preserve the authentic verified product reference");
        error.code = "social_product_visual_reference_invalid";
        throw error;
      }
    }
    visualById.set(candidate.id, brief);
  }

  const canonicalRecommendations = selected.map((candidate) => canonicalRecommendation({
    candidate,
    contentResult: contentById.get(candidate.id),
    visualBrief: visualById.get(candidate.id),
    research,
    generationDate,
    strategistScore: strategistById.get(candidate.id).scoreBreakdown,
  }));
  const rejectedIdeas = assessedCandidates
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => ({
      topic: candidate.topic,
      reasonRejected: candidate.server_rejection_reason
        || `Not selected by the AI strategist: ${strategistById.get(candidate.id).conciseRationale}`.slice(0, 500),
    }));
  const packageValue = validateSocialPackage({
    generationDate,
    timezone: TIMEZONE,
    primaryRecommendation: canonicalRecommendations[0],
    alternativeRecommendations: canonicalRecommendations.slice(1, 3),
    rejectedIdeas,
  });
  const primaryCompliance = scanRecommendationCompliance(packageValue.primaryRecommendation, { requireSourcesForCurrentClaims: true });
  if (!primaryCompliance.passed) {
    throw complianceFailure(selected[0], primaryCompliance, complianceHistory, "The completed primary package failed a final non-negotiable server safety check");
  }
  return {
    package: packageValue,
    mode: "FULL_AI",
    generation_mode: "FULL_AI",
    market_analysis: marketAnalysis,
    candidate_count: rawCandidates.length,
    scored_candidates: assessedCandidates.map((candidate) => ({
      id: candidate.id,
      topic: candidate.topic,
      content_pillar: candidate.contentPillar,
      format: candidate.format,
      score_breakdown: candidate.scoreBreakdown,
      concise_rationale: strategistById.get(candidate.id).conciseRationale,
      duplicate_analysis: candidate.duplicate_analysis,
      server_eligible: candidate.server_eligible,
      server_rejection_reason: candidate.server_rejection_reason,
      selected: selectedIds.has(candidate.id),
      selection: candidate.id === strategy.selectedPrimaryId ? "PRIMARY" : selectedIds.has(candidate.id) ? "ALTERNATIVE" : "REJECTED",
    })),
    selected_primary_id: strategy.selectedPrimaryId,
    alternative_ids: strategy.alternativeIds,
    duplicate_analysis: selected[0].duplicate_analysis,
    compliance: primaryCompliance,
    compliance_history: complianceHistory,
    content_revision_attempts: revisionAttempts,
    prompt_runs: promptRuns,
    usage: usageTotal(promptResults),
    fallback_reason: null,
  };
}

async function generateDailyDecision({
  now = new Date(),
  internalSignals = {},
  research = {},
  settings = {},
  generationRequest = {},
  providers = {},
  dependencies = {},
} = {}) {
  const selectedProvider = trimText(settings.strategy_provider || "openai").toLowerCase();
  const aiEnabled = settings.ai_enabled !== false
    && settings.full_ai_generation !== false
    && settings.generation?.full_ai_generation !== false
    && settings.ai_generation?.full_generation !== false;
  const customProviderConfigured = providers.forceConfigured === true
    || typeof providers.isConfigured === "function" && providers.isConfigured();
  const configured = customProviderConfigured || openAiSocialProvider.isConfigured();
  if (!aiEnabled || selectedProvider !== "openai" || !configured) {
    const error = new Error(!aiEnabled
      ? "Fully AI-generated social strategy is disabled"
      : selectedProvider !== "openai"
        ? `The configured ${selectedProvider || "unknown"} strategy provider cannot satisfy the OpenAI-only full generation contract`
        : "OPENAI_API_KEY is required for fully AI-generated strategy, copy, compliance, and visual direction");
    error.code = "social_ai_not_configured";
    error.statusCode = 409;
    throw error;
  }
  try {
    return await runAiDecision({ now, internalSignals, research, settings, generationRequest, providers, dependencies });
  } catch (error) {
    error.message = normalizeWhitespace(error.message).slice(0, 2000);
    throw error;
  }
}

module.exports = {
  generateDailyDecision,
  getIstDateKey,
  runAiDecision,
  _private: {
    allowedDestinationRows,
    buildComplianceReviewContext,
    candidateDiversityCheck,
    complianceCandidateContext,
    complianceDestinationContext,
    canonicalRecommendation,
    contentMix,
    getIstDayOfWeek,
    legacyOnPostCopy,
    legacyVisualConcept,
    prepareVerifiedCandidate,
    promptRun,
    providerOutput,
    recommendationForCompliance,
    serverCandidateAssessment,
    sourceForRecommendation,
    sourcesForIndexes,
    usageTotal,
    validateAiDestination,
    validateStrategistSelection,
    verifiedProductFacts,
    weeklyCandidateAsRequiredCandidate,
  },
};
