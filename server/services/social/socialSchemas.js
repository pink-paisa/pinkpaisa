const { VISUAL_MODES } = require("./socialVisualPolicy");
const { normalizeHashtagToken } = require("./socialCaptionPolicy");

const OBJECTIVES = [
  "AWARENESS",
  "EDUCATION",
  "ENGAGEMENT",
  "TRAFFIC",
  "LEADS",
  "PRODUCT_PROMOTION",
  "COMMUNITY_BUILDING",
];

const FORMATS = [
  "SINGLE_IMAGE",
  "CAROUSEL",
  "REEL",
  "VIDEO_FEED",
  "STORY",
  "INFOGRAPHIC",
  "MEME",
  "QUIZ",
  "POLL",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
];

const POST_TYPES = [
  "AWARENESS",
  "EDUCATIONAL",
  "ENGAGEMENT",
  "PRODUCT",
  "QUIZ",
  "CALCULATOR",
  "WORKSHOP",
  "AFFILIATE",
  "SEASONAL",
];

const STATIC_FORMATS = [
  "INFOGRAPHIC",
  "MEME",
  "QUIZ",
  "POLL",
  "RESOURCE_PROMOTION",
  "EVENT_OR_WORKSHOP_PROMOTION",
];

const CONTENT_PILLARS = [
  "Money Education",
  "Money Psychology",
  "Wealth and Wellness",
  "Relatable Money Moments",
  "Interactive",
  "Pink Paisa Resources",
  "Curated Wellness and Affiliate Products",
];

const stringSchema = (options = {}) => ({ type: "string", ...options });
const nullableStringSchema = (options = {}) => ({ type: ["string", "null"], ...options });
const arraySchema = (items, options = {}) => ({ type: "array", items, ...options });
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const sourceSchema = objectSchema({
  title: stringSchema({ minLength: 1, maxLength: 300 }),
  url: stringSchema({ minLength: 1, maxLength: 2048 }),
  publishedAt: nullableStringSchema({ maxLength: 40 }),
  accessedAt: stringSchema({ minLength: 1, maxLength: 40 }),
  claimSupported: stringSchema({ minLength: 1, maxLength: 600 }),
  confidence: { type: "number", minimum: 0, maximum: 1 },
});

const scoreBreakdownSchema = objectSchema({
  brandRelevance: { type: "number", minimum: 0, maximum: 25 },
  audienceUsefulness: { type: "number", minimum: 0, maximum: 20 },
  timeliness: { type: "number", minimum: 0, maximum: 15 },
  originality: { type: "number", minimum: 0, maximum: 15 },
  engagementPotential: { type: "number", minimum: 0, maximum: 10 },
  businessAlignment: { type: "number", minimum: 0, maximum: 10 },
  evidenceQuality: { type: "number", minimum: 0, maximum: 5 },
  compliancePenalty: { type: "number", minimum: -30, maximum: 0 },
  total: { type: "number", minimum: 0, maximum: 100 },
});

const slideSchema = objectSchema({
  slideNumber: { type: "integer", minimum: 1, maximum: 10 },
  headline: stringSchema({ minLength: 1, maxLength: 80 }),
  body: stringSchema({ minLength: 1, maxLength: 160 }),
  visualInstruction: stringSchema({ minLength: 1, maxLength: 500 }),
});

const storyFrameSchema = objectSchema({
  frameNumber: { type: "integer", minimum: 1, maximum: 10 },
  copy: stringSchema({ minLength: 1, maxLength: 160 }),
  visualInstruction: stringSchema({ minLength: 1, maxLength: 500 }),
});

const reelSceneSchema = objectSchema({
  sceneNumber: { type: "integer", minimum: 1, maximum: 20 },
  durationSeconds: { type: "number", minimum: 1, maximum: 60 },
  voiceover: stringSchema({ maxLength: 700 }),
  onScreenText: stringSchema({ maxLength: 80 }),
  visualInstruction: stringSchema({ minLength: 1, maxLength: 500 }),
});

const visualConceptSchema = objectSchema({
  layout: stringSchema({ minLength: 1, maxLength: 300 }),
  mainVisual: stringSchema({ minLength: 1, maxLength: 500 }),
  textHierarchy: stringSchema({ minLength: 1, maxLength: 400 }),
  graphicElements: stringSchema({ minLength: 1, maxLength: 400 }),
  mood: stringSchema({ minLength: 1, maxLength: 250 }),
  photographyOrIllustrationDirection: stringSchema({ minLength: 1, maxLength: 500 }),
  aspectRatio: { type: "string", enum: ["4:5", "1:1", "9:16"] },
});

const recommendationSchema = objectSchema({
  internalTitle: stringSchema({ minLength: 1, maxLength: 180 }),
  whyToday: stringSchema({ minLength: 1, maxLength: 700 }),
  objective: { type: "string", enum: OBJECTIVES },
  format: { type: "string", enum: FORMATS },
  contentPillar: { type: "string", enum: CONTENT_PILLARS },
  targetAudienceSegment: stringSchema({ minLength: 1, maxLength: 240 }),
  topic: stringSchema({ minLength: 1, maxLength: 240 }),
  verifiedProductId: nullableStringSchema({ maxLength: 80 }),
  verifiedProductTitle: nullableStringSchema({ maxLength: 240 }),
  hooks: arraySchema(stringSchema({ minLength: 1, maxLength: 180 }), { minItems: 3, maxItems: 3 }),
  onPostCopy: objectSchema({
    headline: nullableStringSchema({ maxLength: 80 }),
    supportingCopy: nullableStringSchema({ maxLength: 160 }),
    slides: arraySchema(slideSchema, { maxItems: 10 }),
    storyFrames: arraySchema(storyFrameSchema, { maxItems: 10 }),
    reelScenes: arraySchema(reelSceneSchema, { maxItems: 20 }),
  }),
  caption: stringSchema({ minLength: 1, maxLength: 2200 }),
  cta: stringSchema({ minLength: 1, maxLength: 180 }),
  hashtags: arraySchema(stringSchema({ minLength: 2, maxLength: 60 }), { minItems: 5, maxItems: 10 }),
  visualConcept: visualConceptSchema,
  // Mirrors visualBrief.assets[0].imagePrompt. Keep the legacy compatibility
  // view aligned so validated AI direction is never truncated or rejected.
  imageGenerationPrompt: stringSchema({ minLength: 1, maxLength: 4000 }),
  altText: stringSchema({ minLength: 1, maxLength: 500 }),
  financialDisclaimer: nullableStringSchema({ maxLength: 500 }),
  affiliateDisclosure: nullableStringSchema({ maxLength: 500 }),
  recommendedLandingPage: nullableStringSchema({ maxLength: 2048 }),
  utmParameters: objectSchema({
    source: { type: "string", const: "instagram" },
    medium: { type: "string", const: "organic_social" },
    campaign: stringSchema({ minLength: 1, maxLength: 120 }),
    content: stringSchema({ minLength: 1, maxLength: 120 }),
  }),
  sources: arraySchema(sourceSchema, { maxItems: 12 }),
  confidence: { type: "number", minimum: 0, maximum: 1 },
  riskFlags: arraySchema(stringSchema({ minLength: 1, maxLength: 120 }), { maxItems: 20 }),
  scoreBreakdown: scoreBreakdownSchema,
});

const FINAL_SOCIAL_PACKAGE_SCHEMA = objectSchema({
  generationDate: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  timezone: { type: "string", const: "Asia/Kolkata" },
  primaryRecommendation: recommendationSchema,
  alternativeRecommendations: arraySchema(recommendationSchema, { minItems: 2, maxItems: 2 }),
  rejectedIdeas: arraySchema(objectSchema({
    topic: stringSchema({ minLength: 1, maxLength: 240 }),
    reasonRejected: stringSchema({ minLength: 1, maxLength: 500 }),
  }), { minItems: 2, maxItems: 10 }),
});

const researchSignalSchema = objectSchema({
  headline: stringSchema({ minLength: 1, maxLength: 300 }),
  summary: stringSchema({ minLength: 1, maxLength: 900 }),
  claimSupported: stringSchema({ minLength: 1, maxLength: 600 }),
  sourceUrl: stringSchema({ minLength: 1, maxLength: 2048 }),
  sourceTitle: stringSchema({ minLength: 1, maxLength: 300 }),
  publisher: stringSchema({ minLength: 1, maxLength: 200 }),
  publishedAt: nullableStringSchema({ maxLength: 40 }),
  sourceType: { type: "string", enum: ["PRIMARY", "NEWS", "RESEARCH", "GOVERNMENT", "INDUSTRY", "SOCIAL_TREND"] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  freshnessHours: { type: "number", minimum: 0, maximum: 87600 },
});

const RESEARCH_OUTPUT_SCHEMA = objectSchema({
  signals: arraySchema(researchSignalSchema, { maxItems: 12 }),
  unconfirmedTopics: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 12 }),
});

const candidateSchema = objectSchema({
  id: stringSchema({ minLength: 1, maxLength: 80 }),
  internalTitle: stringSchema({ minLength: 1, maxLength: 180 }),
  topic: stringSchema({ minLength: 1, maxLength: 240 }),
  whyToday: stringSchema({ minLength: 1, maxLength: 700 }),
  objective: { type: "string", enum: OBJECTIVES },
  format: { type: "string", enum: FORMATS },
  contentPillar: { type: "string", enum: CONTENT_PILLARS },
  targetAudienceSegment: stringSchema({ minLength: 1, maxLength: 240 }),
  businessObjective: stringSchema({ minLength: 1, maxLength: 400 }),
  verifiedProductId: nullableStringSchema({ maxLength: 80 }),
  verifiedProductTitle: nullableStringSchema({ maxLength: 240 }),
  evidenceSourceIndexes: arraySchema({ type: "integer", minimum: 0, maximum: 50 }, { maxItems: 8 }),
  isEvergreen: { type: "boolean" },
  riskFlags: arraySchema(stringSchema({ minLength: 1, maxLength: 120 }), { maxItems: 20 }),
});

const CANDIDATES_OUTPUT_SCHEMA = objectSchema({
  candidates: arraySchema(candidateSchema, { minItems: 5, maxItems: 8 }),
});

const STRATEGY_OUTPUT_SCHEMA = objectSchema({
  scoredCandidates: arraySchema(objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 80 }),
    scoreBreakdown: scoreBreakdownSchema,
    conciseRationale: stringSchema({ minLength: 1, maxLength: 600 }),
    risksChecked: arraySchema(stringSchema({ minLength: 1, maxLength: 160 }), { maxItems: 20 }),
  }), { minItems: 5, maxItems: 8 }),
  selectedPrimaryId: stringSchema({ minLength: 1, maxLength: 80 }),
  alternativeIds: arraySchema(stringSchema({ minLength: 1, maxLength: 80 }), { minItems: 2, maxItems: 2 }),
});

const COPY_OUTPUT_SCHEMA = objectSchema({
  recommendations: arraySchema(objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 80 }),
    hooks: arraySchema(stringSchema({ minLength: 1, maxLength: 180 }), { minItems: 3, maxItems: 3 }),
    onPostCopy: recommendationSchema.properties.onPostCopy,
    caption: stringSchema({ minLength: 1, maxLength: 2200 }),
    cta: stringSchema({ minLength: 1, maxLength: 180 }),
    hashtags: arraySchema(stringSchema({ minLength: 2, maxLength: 60 }), { minItems: 5, maxItems: 10 }),
    altText: stringSchema({ minLength: 1, maxLength: 500 }),
    financialDisclaimer: nullableStringSchema({ maxLength: 500 }),
    affiliateDisclosure: nullableStringSchema({ maxLength: 500 }),
  }), { minItems: 3, maxItems: 3 }),
});

const VISUAL_OUTPUT_SCHEMA = objectSchema({
  recommendations: arraySchema(objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 80 }),
    visualConcept: visualConceptSchema,
    imageGenerationPrompt: stringSchema({ minLength: 1, maxLength: 4000 }),
  }), { minItems: 3, maxItems: 3 }),
});

const COMPLIANCE_OUTPUT_SCHEMA = objectSchema({
  reviews: arraySchema(objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 80 }),
    decision: { type: "string", enum: ["PASS", "REVISE", "REJECT"] },
    riskFlags: arraySchema(stringSchema({ minLength: 1, maxLength: 120 }), { maxItems: 20 }),
    unsupportedClaims: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
    requiredChanges: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
  }), { minItems: 3, maxItems: 3 }),
});

const analysisSignalSchema = objectSchema({
  classification: {
    type: "string",
    enum: ["VERIFIED_TIMELY", "INTERNAL_PERFORMANCE", "EVERGREEN", "WEAK_OR_UNCONFIRMED"],
  },
  headline: stringSchema({ minLength: 1, maxLength: 300 }),
  supportedClaim: stringSchema({ minLength: 1, maxLength: 600 }),
  relevanceToPinkPaisa: stringSchema({ minLength: 1, maxLength: 500 }),
  sourceIndexes: arraySchema({ type: "integer", minimum: 0, maximum: 100 }, { maxItems: 12 }),
  confidence: { type: "number", minimum: 0, maximum: 1 },
});

const DAILY_MARKET_ANALYSIS_SCHEMA = objectSchema({
  generationDate: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  timezone: { type: "string", const: "Asia/Kolkata" },
  dayOfWeek: {
    type: "string",
    enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
  salaryCycleContext: stringSchema({ minLength: 1, maxLength: 500 }),
  importantMarketSignals: arraySchema(analysisSignalSchema, { maxItems: 12 }),
  audienceProblemOrOpportunity: stringSchema({ minLength: 1, maxLength: 900 }),
  relevantPinkPaisaResources: arraySchema(objectSchema({
    id: nullableStringSchema({ maxLength: 100 }),
    title: stringSchema({ minLength: 1, maxLength: 240 }),
    landingPage: nullableStringSchema({ maxLength: 2048 }),
    relevance: stringSchema({ minLength: 1, maxLength: 500 }),
  }), { maxItems: 12 }),
  topicsToAvoid: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
  overusedRecentTopics: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
  recommendedContentDirection: stringSchema({ minLength: 1, maxLength: 900 }),
  recommendedPromotionalIntensity: {
    type: "string",
    enum: ["NONE", "LIGHT", "BALANCED", "PROMOTIONAL"],
  },
  recommendedFormatConsiderations: arraySchema(objectSchema({
    format: { type: "string", enum: FORMATS },
    fitReason: stringSchema({ minLength: 1, maxLength: 500 }),
    caution: nullableStringSchema({ maxLength: 500 }),
  }), { minItems: 1, maxItems: FORMATS.length }),
  weakOrUnconfirmedTrends: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { maxItems: 12 }),
  conciseRationale: stringSchema({ minLength: 1, maxLength: 900 }),
});

const overlayInstructionsSchema = objectSchema({
  logoPosition: stringSchema({ minLength: 1, maxLength: 120 }),
  headlinePosition: stringSchema({ minLength: 1, maxLength: 160 }),
  ctaPosition: nullableStringSchema({ maxLength: 160 }),
  disclosurePosition: nullableStringSchema({ maxLength: 160 }),
  safeAreaNotes: stringSchema({ minLength: 1, maxLength: 500 }),
}, ["logoPosition", "headlinePosition", "safeAreaNotes"]);

function formatContentBaseProperties(formatSchema) {
  return {
    id: stringSchema({ minLength: 1, maxLength: 80 }),
    format: formatSchema,
    postType: { type: "string", enum: POST_TYPES },
    objective: { type: "string", enum: OBJECTIVES },
    contentPillar: { type: "string", enum: CONTENT_PILLARS },
    targetAudience: stringSchema({ minLength: 1, maxLength: 300 }),
    whyToday: stringSchema({ minLength: 1, maxLength: 700 }),
    formatReason: stringSchema({ minLength: 1, maxLength: 500 }),
    hookOptions: arraySchema(stringSchema({ minLength: 1, maxLength: 180 }), { minItems: 3, maxItems: 3 }),
    caption: stringSchema({ minLength: 1, maxLength: 2200 }),
    cta: stringSchema({ minLength: 1, maxLength: 180 }),
    hashtags: arraySchema(stringSchema({ minLength: 2, maxLength: 60 }), { minItems: 5, maxItems: 10 }),
    altText: stringSchema({ minLength: 1, maxLength: 500 }),
    recommendedLandingPage: nullableStringSchema({ maxLength: 2048 }),
    sourceIndexes: arraySchema({ type: "integer", minimum: 0, maximum: 100 }, { maxItems: 12 }),
    financialDisclaimer: nullableStringSchema({ maxLength: 500 }),
    affiliateDisclosure: nullableStringSchema({ maxLength: 500 }),
  };
}

const SINGLE_IMAGE_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "SINGLE_IMAGE" }),
  selectedHeadline: stringSchema({ minLength: 1, maxLength: 80 }),
  supportingText: nullableStringSchema({ maxLength: 160 }),
  imagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  negativeVisualInstructions: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 20 }),
  overlayInstructions: overlayInstructionsSchema,
});

const carouselSlideContentSchema = objectSchema({
  slideNumber: { type: "integer", minimum: 1, maximum: 7 },
  headline: stringSchema({ minLength: 1, maxLength: 80 }),
  body: stringSchema({ minLength: 1, maxLength: 160 }),
  imagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  overlayInstructions: stringSchema({ minLength: 1, maxLength: 700 }),
});

const CAROUSEL_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "CAROUSEL" }),
  slideCount: { type: "integer", minimum: 3, maximum: 7 },
  narrativeArc: stringSchema({ minLength: 1, maxLength: 700 }),
  cohesiveArtDirection: stringSchema({ minLength: 1, maxLength: 900 }),
  slides: arraySchema(carouselSlideContentSchema, { minItems: 3, maxItems: 7 }),
});

const reelSceneContentSchema = objectSchema({
  sceneNumber: { type: "integer", minimum: 1, maximum: 20 },
  durationSeconds: { type: "number", minimum: 1, maximum: 60 },
  voiceover: stringSchema({ maxLength: 700 }),
  onScreenText: stringSchema({ maxLength: 80 }),
  visualInstruction: stringSchema({ minLength: 1, maxLength: 700 }),
});

const REEL_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "REEL" }),
  durationSeconds: { type: "number", minimum: 3, maximum: 180 },
  coverHeadline: stringSchema({ minLength: 1, maxLength: 80 }),
  audioDirection: stringSchema({ minLength: 1, maxLength: 500 }),
  scenes: arraySchema(reelSceneContentSchema, { minItems: 1, maxItems: 20 }),
  coverImagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  overlayInstructions: overlayInstructionsSchema,
});

// A feed video uses the same structured production package as a Reel, but
// remains a distinct format through planning, generation, assembly, reporting,
// and publishing so an administrator can see exactly what the AI selected.
const VIDEO_FEED_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "VIDEO_FEED" }),
  durationSeconds: { type: "number", minimum: 3, maximum: 180 },
  coverHeadline: stringSchema({ minLength: 1, maxLength: 80 }),
  audioDirection: stringSchema({ minLength: 1, maxLength: 500 }),
  scenes: arraySchema(reelSceneContentSchema, { minItems: 1, maxItems: 20 }),
  coverImagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  overlayInstructions: overlayInstructionsSchema,
});

const storyFrameContentSchema = objectSchema({
  frameNumber: { type: "integer", minimum: 1, maximum: 10 },
  copy: stringSchema({ minLength: 1, maxLength: 160 }),
  imagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  overlayInstructions: stringSchema({ minLength: 1, maxLength: 700 }),
  interactionPrompt: nullableStringSchema({ maxLength: 300 }),
});

const STORY_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "STORY" }),
  frameCount: { type: "integer", minimum: 1, maximum: 10 },
  frames: arraySchema(storyFrameContentSchema, { minItems: 1, maxItems: 10 }),
});

const PRODUCT_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", const: "PRODUCT_FEATURE" }),
  verifiedProductId: stringSchema({ minLength: 1, maxLength: 100 }),
  verifiedProductTitle: stringSchema({ minLength: 1, maxLength: 240 }),
  verifiedProductImageUrl: stringSchema({ minLength: 1, maxLength: 2048 }),
  selectedHeadline: stringSchema({ minLength: 1, maxLength: 80 }),
  supportingText: nullableStringSchema({ maxLength: 160 }),
  imagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  productPreservationInstructions: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { minItems: 1, maxItems: 20 }),
  negativeVisualInstructions: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 20 }),
  overlayInstructions: overlayInstructionsSchema,
});

const STATIC_CONTENT_SCHEMA = objectSchema({
  ...formatContentBaseProperties({ type: "string", enum: STATIC_FORMATS }),
  selectedHeadline: stringSchema({ minLength: 1, maxLength: 80 }),
  supportingText: nullableStringSchema({ maxLength: 160 }),
  interactionCopy: nullableStringSchema({ maxLength: 160 }),
  imagePrompt: stringSchema({ minLength: 1, maxLength: 3000 }),
  negativeVisualInstructions: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 20 }),
  overlayInstructions: overlayInstructionsSchema,
});

function staticContentSchemaForFormat(format) {
  return objectSchema({
    ...formatContentBaseProperties({ type: "string", const: format }),
    selectedHeadline: STATIC_CONTENT_SCHEMA.properties.selectedHeadline,
    supportingText: STATIC_CONTENT_SCHEMA.properties.supportingText,
    interactionCopy: STATIC_CONTENT_SCHEMA.properties.interactionCopy,
    imagePrompt: STATIC_CONTENT_SCHEMA.properties.imagePrompt,
    negativeVisualInstructions: STATIC_CONTENT_SCHEMA.properties.negativeVisualInstructions,
    overlayInstructions: STATIC_CONTENT_SCHEMA.properties.overlayInstructions,
  });
}

const FORMAT_CONTENT_SCHEMAS = Object.freeze({
  SINGLE_IMAGE: SINGLE_IMAGE_CONTENT_SCHEMA,
  CAROUSEL: CAROUSEL_CONTENT_SCHEMA,
  REEL: REEL_CONTENT_SCHEMA,
  VIDEO_FEED: VIDEO_FEED_CONTENT_SCHEMA,
  STORY: STORY_CONTENT_SCHEMA,
  PRODUCT_FEATURE: PRODUCT_CONTENT_SCHEMA,
  ...Object.fromEntries(STATIC_FORMATS.map((format) => [format, staticContentSchemaForFormat(format)])),
});

function normalizeFormat(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function schemaPropertyWithConst(schema, value) {
  return value == null || value === ""
    ? schema
    : { ...schema, const: value };
}

function landingPageSchema({ allowedLandingPages = null, productLandingPage = null } = {}) {
  const exactProductPath = typeof productLandingPage === "string" ? productLandingPage.trim() : "";
  if (exactProductPath) {
    return { type: "string", const: exactProductPath };
  }
  if (Array.isArray(allowedLandingPages)) {
    const verifiedPaths = [...new Set(allowedLandingPages
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.startsWith("/") && !value.startsWith("//")))];
    return {
      type: ["string", "null"],
      enum: [...verifiedPaths, null],
      maxLength: 2048,
    };
  }
  return nullableStringSchema({ maxLength: 2048 });
}

function contentSchemaForFormat(format, {
  id = null,
  allowedLandingPages = null,
  productLandingPage = null,
} = {}) {
  const normalized = normalizeFormat(format);
  const schema = FORMAT_CONTENT_SCHEMAS[normalized];
  if (!schema) {
    const error = new Error(`Unsupported AI social content format: ${format}`);
    error.code = "social_format_unsupported";
    throw error;
  }
  const hasIdentityConstraint = id != null && id !== "";
  const hasDestinationConstraint = Array.isArray(allowedLandingPages)
    || (typeof productLandingPage === "string" && productLandingPage.trim());
  if (!hasIdentityConstraint && !hasDestinationConstraint) return schema;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      id: schemaPropertyWithConst(schema.properties.id, id),
      format: schemaPropertyWithConst(schema.properties.format, normalized),
      ...(hasDestinationConstraint ? {
        recommendedLandingPage: landingPageSchema({ allowedLandingPages, productLandingPage }),
      } : {}),
    },
  };
}

const complianceIssueSchema = objectSchema({
  code: stringSchema({ minLength: 1, maxLength: 120 }),
  severity: { type: "string", enum: ["ERROR", "WARNING"] },
  fieldPath: nullableStringSchema({ maxLength: 300 }),
  message: stringSchema({ minLength: 1, maxLength: 700 }),
});

const SINGLE_COMPLIANCE_REVIEW_SCHEMA = objectSchema({
  id: stringSchema({ minLength: 1, maxLength: 80 }),
  decision: { type: "string", enum: ["PASS", "REVISE", "REJECT"] },
  issues: arraySchema(complianceIssueSchema, { maxItems: 30 }),
  riskFlags: arraySchema(stringSchema({ minLength: 1, maxLength: 120 }), { maxItems: 30 }),
  unsupportedClaims: arraySchema(stringSchema({ minLength: 1, maxLength: 700 }), { maxItems: 30 }),
  requiredChanges: arraySchema(stringSchema({ minLength: 1, maxLength: 700 }), { maxItems: 30 }),
  conciseRationale: stringSchema({ minLength: 1, maxLength: 700 }),
});

function revisionResultSchemaForFormat(format, {
  id = null,
  allowedLandingPages = null,
  productLandingPage = null,
} = {}) {
  const normalized = normalizeFormat(format);
  return objectSchema({
    id: schemaPropertyWithConst(stringSchema({ minLength: 1, maxLength: 80 }), id),
    format: { type: "string", const: normalized },
    changedFields: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 30 }),
    revisionSummary: stringSchema({ minLength: 1, maxLength: 700 }),
    revisedContent: contentSchemaForFormat(normalized, {
      id,
      allowedLandingPages,
      productLandingPage,
    }),
  });
}

const REVISION_RESULT_SCHEMAS = Object.freeze(Object.fromEntries(
  FORMATS.map((format) => [format, revisionResultSchemaForFormat(format)]),
));

const visualReferenceSchema = objectSchema({
  type: { type: "string", enum: ["BRAND", "LOGO", "WEBSITE", "APPROVED_CREATIVE", "PRODUCT"] },
  sourceId: nullableStringSchema({ maxLength: 120 }),
  sourceUrl: nullableStringSchema({ maxLength: 2048 }),
  usageInstruction: stringSchema({ minLength: 1, maxLength: 500 }),
});

const visualAssetBriefSchema = objectSchema({
  sequence: { type: "integer", minimum: 1, maximum: 20 },
  role: {
    type: "string",
    enum: ["FEED_VISUAL", "CAROUSEL_COVER", "CAROUSEL_SLIDE", "STORY_FRAME", "REEL_COVER", "VIDEO_FEED_COVER", "PRODUCT_SCENE"],
  },
  imagePrompt: stringSchema({ minLength: 1, maxLength: 4000 }),
  overlayInstructions: stringSchema({ minLength: 1, maxLength: 900 }),
  requiredObjects: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
  prohibitedObjects: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 1, maxItems: 30 }),
});

function visualBriefSchemaForFormat(format, { id = null, visualMode = null } = {}) {
  const normalized = normalizeFormat(format);
  contentSchemaForFormat(normalized);
  const verticalVideoOrStory = ["STORY", "REEL", "VIDEO_FEED"].includes(normalized);
  const assetLimits = normalized === "CAROUSEL"
    ? { minItems: 3, maxItems: 7 }
    : normalized === "STORY"
      ? { minItems: 1, maxItems: 10 }
      : { minItems: 1, maxItems: 1 };
  return objectSchema({
    id: schemaPropertyWithConst(stringSchema({ minLength: 1, maxLength: 80 }), id),
    format: { type: "string", const: normalized },
    visualMode: visualMode
      ? { type: "string", const: visualMode }
      : { type: "string", enum: VISUAL_MODES },
    formatReason: stringSchema({ minLength: 1, maxLength: 500 }),
    aspectRatio: verticalVideoOrStory
      ? { type: "string", const: "9:16" }
      : { type: "string", enum: ["4:5", "1:1", "9:16"] },
    subject: stringSchema({ minLength: 1, maxLength: 700 }),
    setting: stringSchema({ minLength: 1, maxLength: 700 }),
    composition: stringSchema({ minLength: 1, maxLength: 900 }),
    cameraAngle: stringSchema({ minLength: 1, maxLength: 300 }),
    lighting: stringSchema({ minLength: 1, maxLength: 400 }),
    palette: stringSchema({ minLength: 1, maxLength: 400 }),
    mood: stringSchema({ minLength: 1, maxLength: 400 }),
    indianCulturalContext: nullableStringSchema({ maxLength: 700 }),
    subjectRepresentationRequirements: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { maxItems: 20 }),
    textSafeRegions: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), {
      minItems: visualMode === "AI_ARTWORK_ONLY" ? 0 : 1,
      maxItems: 10,
    }),
    references: arraySchema(visualReferenceSchema, { maxItems: 10 }),
    ...(normalized === "PRODUCT_FEATURE" ? {
      authenticProductReference: objectSchema({
        productId: stringSchema({ minLength: 1, maxLength: 100 }),
        productTitle: stringSchema({ minLength: 1, maxLength: 240 }),
        imageUrl: stringSchema({ minLength: 1, maxLength: 2048 }),
        preservationInstruction: stringSchema({ minLength: 1, maxLength: 900 }),
      }),
    } : {}),
    assets: arraySchema(visualAssetBriefSchema, assetLimits),
  });
}

const VISUAL_BRIEF_SCHEMAS = Object.freeze(Object.fromEntries(
  FORMATS.map((format) => [format, visualBriefSchemaForFormat(format)]),
));

// These unions are provenance/assembly contracts. Runtime content, revision, and
// visual calls still receive one exact schema from the corresponding format map.
const FORMAT_CONTENT_OUTPUT_SCHEMA = Object.freeze({
  anyOf: FORMATS.map((format) => FORMAT_CONTENT_SCHEMAS[format]),
});
const REVISION_OUTPUT_SCHEMA = Object.freeze({
  anyOf: FORMATS.map((format) => REVISION_RESULT_SCHEMAS[format]),
});
const FORMAT_REWRITE_OUTPUT_SCHEMA = FORMAT_CONTENT_OUTPUT_SCHEMA;
const VISUAL_BRIEF_OUTPUT_SCHEMA = Object.freeze({
  anyOf: FORMATS.map((format) => VISUAL_BRIEF_SCHEMAS[format]),
});

const VERIFIED_PRODUCT_FACTS_SCHEMA = {
  ...objectSchema({
    id: stringSchema({ minLength: 1, maxLength: 100 }),
    title: stringSchema({ minLength: 1, maxLength: 240 }),
    brand: nullableStringSchema({ maxLength: 240 }),
    category: nullableStringSchema({ maxLength: 240 }),
    subcategory: nullableStringSchema({ maxLength: 240 }),
    asin: nullableStringSchema({ maxLength: 40 }),
    imageUrl: stringSchema({ minLength: 1, maxLength: 2048 }),
    description: nullableStringSchema({ maxLength: 3000 }),
    affiliateUrl: nullableStringSchema({ maxLength: 2048 }),
    landingPage: nullableStringSchema({ maxLength: 2048 }),
  }),
  type: ["object", "null"],
};

Object.assign(recommendationSchema.properties, {
  formatReason: stringSchema({ minLength: 1, maxLength: 500 }),
  postType: { type: "string", enum: POST_TYPES },
  formatContent: FORMAT_CONTENT_OUTPUT_SCHEMA,
  visualBrief: VISUAL_BRIEF_OUTPUT_SCHEMA,
  verifiedProductFacts: VERIFIED_PRODUCT_FACTS_SCHEMA,
});
recommendationSchema.required.push("formatReason", "postType", "formatContent", "visualBrief", "verifiedProductFacts");

const IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA = objectSchema({
  prompt: stringSchema({ minLength: 1, maxLength: 4000 }),
  changes: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 20 }),
  conciseRationale: stringSchema({ minLength: 1, maxLength: 700 }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function uniqueItemKey(value) {
  if (Array.isArray(value)) return `[${value.map(uniqueItemKey).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${uniqueItemKey(value[key])}`).join(",")}}`;
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

function validateJsonSchema(schema, value, path = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (Array.isArray(schema.anyOf)) {
    const branchResults = schema.anyOf.map((branch) => validateJsonSchema(branch, value, path, []));
    if (!branchResults.some((branchErrors) => branchErrors.length === 0)) {
      const format = isPlainObject(value) ? normalizeFormat(value.format) : "";
      const formatBranchIndex = schema.anyOf.findIndex((branch) => branch?.properties?.format?.const === format);
      const mostRelevant = formatBranchIndex >= 0
        ? branchResults[formatBranchIndex]
        : branchResults.reduce((best, current) => (current.length < best.length ? current : best));
      errors.push(...mostRelevant.slice(0, 30));
      if (!mostRelevant.length) errors.push(`${path} must match an allowed schema`);
    }
    return errors;
  }
  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length && !expectedTypes.some((type) => matchesType(value, type))) {
    errors.push(`${path} must be ${expectedTypes.join(" or ")}`);
    return errors;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} is not an allowed value`);

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format`);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path} is below the minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path} exceeds the maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.uniqueItems === true) {
      const itemKeys = value.map(uniqueItemKey);
      if (new Set(itemKeys).size !== itemKeys.length) errors.push(`${path} must contain unique items`);
    }
    value.forEach((item, index) => validateJsonSchema(schema.items, item, `${path}[${index}]`, errors));
  }
  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    for (const requiredKey of schema.required || []) {
      if (!Object.hasOwn(value, requiredKey)) errors.push(`${path}.${requiredKey} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateJsonSchema(childSchema, value[key], `${path}.${key}`, errors);
    }
  }
  return errors;
}

function validateWithSchema(schema, value, label = "Structured output") {
  const errors = validateJsonSchema(schema, value);
  if (errors.length) {
    const error = new Error(`${label} validation failed: ${errors.slice(0, 12).join("; ")}`);
    error.code = "structured_output_invalid";
    error.validation_errors = errors;
    throw error;
  }
  return value;
}

function validateSocialPackage(value) {
  const result = validateWithSchema(FINAL_SOCIAL_PACKAGE_SCHEMA, value, "Social content package");
  const recommendations = [result.primaryRecommendation, ...result.alternativeRecommendations];
  for (const recommendation of recommendations) {
    validateFormatContent(recommendation.format, recommendation.formatContent);
    validateVisualBrief(recommendation.format, recommendation.visualBrief);
    if (recommendation.postType !== recommendation.formatContent.postType) {
      const error = new Error("Social content package postType must match formatContent.postType");
      error.code = "structured_output_invalid";
      error.validation_errors = ["$.postType must match $.formatContent.postType"];
      throw error;
    }
    if (recommendation.formatReason !== recommendation.formatContent.formatReason) {
      const error = new Error("Social content package formatReason must match formatContent.formatReason");
      error.code = "structured_output_invalid";
      error.validation_errors = ["$.formatReason must match $.formatContent.formatReason"];
      throw error;
    }
    const productRecommendation = recommendation.format === "PRODUCT_FEATURE"
      || recommendation.postType === "PRODUCT"
      || recommendation.postType === "AFFILIATE";
    if (productRecommendation !== Boolean(recommendation.verifiedProductFacts)) {
      const error = new Error(productRecommendation
        ? "Product recommendations require verifiedProductFacts"
        : "Non-product recommendations must set verifiedProductFacts to null");
      error.code = "structured_output_invalid";
      error.validation_errors = [productRecommendation
        ? "$.verifiedProductFacts is required for product recommendations"
        : "$.verifiedProductFacts must be null for non-product recommendations"];
      throw error;
    }
    const hashtags = recommendation.hashtags.map((tag) => normalizeHashtagToken(tag)?.toLocaleLowerCase());
    if (new Set(hashtags).size !== hashtags.length) throw new Error("Social content package contains duplicate hashtags");
    if (recommendation.format === "CAROUSEL" && recommendation.onPostCopy.slides.length < 2) {
      throw new Error("Carousel recommendations require at least two slides");
    }
    if (recommendation.format === "STORY" && recommendation.onPostCopy.storyFrames.length < 1) {
      throw new Error("Story recommendations require at least one story frame");
    }
    if (["REEL", "VIDEO_FEED"].includes(recommendation.format) && recommendation.onPostCopy.reelScenes.length < 1) {
      throw new Error("Video recommendations require at least one scene");
    }
  }
  return result;
}

function validateFormatContent(format, value) {
  const normalized = normalizeFormat(format);
  const result = validateWithSchema(contentSchemaForFormat(normalized), value, `${normalized} content`);
  const hashtagKeys = result.hashtags.map((tag) => normalizeHashtagToken(tag)?.toLocaleLowerCase());
  if (new Set(hashtagKeys).size !== hashtagKeys.length) {
    const error = new Error(`${normalized} content contains duplicate hashtags`);
    error.code = "structured_output_invalid";
    error.validation_errors = ["$.hashtags must contain unique values"];
    throw error;
  }
  if (normalized === "CAROUSEL" && result.slideCount !== result.slides.length) {
    const error = new Error("CAROUSEL content slideCount must equal slides.length");
    error.code = "structured_output_invalid";
    error.validation_errors = ["$.slideCount must equal $.slides.length"];
    throw error;
  }
  if (normalized === "STORY" && result.frameCount !== result.frames.length) {
    const error = new Error("STORY content frameCount must equal frames.length");
    error.code = "structured_output_invalid";
    error.validation_errors = ["$.frameCount must equal $.frames.length"];
    throw error;
  }
  return result;
}

function validateRevisionResult(format, value) {
  const normalized = normalizeFormat(format);
  const result = validateWithSchema(
    REVISION_RESULT_SCHEMAS[normalized],
    value,
    `${normalized} revision result`,
  );
  validateFormatContent(normalized, result.revisedContent);
  return result;
}

function validateVisualBrief(format, value) {
  const normalized = normalizeFormat(format);
  return validateWithSchema(
    visualBriefSchemaForFormat(normalized, { visualMode: value?.visualMode || value?.visual_mode || null }),
    value,
    `${normalized} visual brief`,
  );
}

module.exports = {
  CAROUSEL_CONTENT_SCHEMA,
  CANDIDATES_OUTPUT_SCHEMA,
  COMPLIANCE_OUTPUT_SCHEMA,
  CONTENT_PILLARS,
  COPY_OUTPUT_SCHEMA,
  DAILY_MARKET_ANALYSIS_SCHEMA,
  FINAL_SOCIAL_PACKAGE_SCHEMA,
  FORMAT_CONTENT_SCHEMAS,
  FORMAT_CONTENT_OUTPUT_SCHEMA,
  FORMAT_REWRITE_OUTPUT_SCHEMA,
  FORMATS,
  IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA,
  OBJECTIVES,
  POST_TYPES,
  PRODUCT_CONTENT_SCHEMA,
  RESEARCH_OUTPUT_SCHEMA,
  REEL_CONTENT_SCHEMA,
  VIDEO_FEED_CONTENT_SCHEMA,
  REVISION_OUTPUT_SCHEMA,
  REVISION_RESULT_SCHEMAS,
  SINGLE_COMPLIANCE_REVIEW_SCHEMA,
  SINGLE_IMAGE_CONTENT_SCHEMA,
  STATIC_CONTENT_SCHEMA,
  STATIC_FORMATS,
  STORY_CONTENT_SCHEMA,
  STRATEGY_OUTPUT_SCHEMA,
  VISUAL_BRIEF_SCHEMAS,
  VISUAL_BRIEF_OUTPUT_SCHEMA,
  VISUAL_OUTPUT_SCHEMA,
  VERIFIED_PRODUCT_FACTS_SCHEMA,
  contentSchemaForFormat,
  recommendationSchema,
  revisionResultSchemaForFormat,
  scoreBreakdownSchema,
  sourceSchema,
  validateFormatContent,
  validateJsonSchema,
  validateRevisionResult,
  validateSocialPackage,
  validateVisualBrief,
  validateWithSchema,
  visualBriefSchemaForFormat,
};
