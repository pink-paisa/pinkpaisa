const { validateWithSchema } = require("./socialSchemas");

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
  "POLL_CONCEPT",
  "PRODUCT_FEATURE",
  "RESOURCE_PROMOTION",
  "WORKSHOP_PROMOTION",
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

const KPI_VALUES = [
  "REACH",
  "NON_FOLLOWER_REACH",
  "SAVES",
  "SHARES",
  "MEANINGFUL_COMMENTS",
  "PROFILE_VISITS",
  "FOLLOWER_GROWTH",
  "WEBSITE_SESSIONS",
  "ENGAGED_SESSIONS",
  "QUIZ_STARTS",
  "QUIZ_COMPLETIONS",
  "CALCULATOR_OPENS",
  "WORKSHOP_ENQUIRIES",
  "PRODUCT_PAGE_VISITS",
  "AFFILIATE_CLICKS",
  "RETURNING_VISITORS",
];

const stringSchema = (options = {}) => ({ type: "string", ...options });
const nullableString = (options = {}) => ({ type: ["string", "null"], ...options });
const arraySchema = (items, options = {}) => ({ type: "array", items, ...options });
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

const SOURCE_CITATION_SCHEMA = objectSchema({
  sourceId: nullableString({ maxLength: 80 }),
  title: stringSchema({ minLength: 1, maxLength: 300 }),
  location: stringSchema({ minLength: 1, maxLength: 2048 }),
  publisher: stringSchema({ minLength: 1, maxLength: 200 }),
  publicationDate: nullableString({ maxLength: 40 }),
  accessDate: stringSchema({ minLength: 10, maxLength: 40 }),
  claimSupported: stringSchema({ minLength: 1, maxLength: 700 }),
  confidence: { type: "number", minimum: 0, maximum: 1 },
  freshness: { type: "string", enum: ["CURRENT", "RECENT", "EVERGREEN", "STALE", "UNKNOWN"] },
  evidenceLevel: { type: "string", enum: ["VERIFIED", "WEAK", "ANECDOTAL"] },
});

const RESEARCH_TOPIC_SCHEMA = objectSchema({
  topicId: stringSchema({ pattern: "^[a-z0-9][a-z0-9_-]{2,79}$" }),
  topic: stringSchema({ minLength: 1, maxLength: 240 }),
  summary: stringSchema({ minLength: 1, maxLength: 900 }),
  relevanceToIndianWomen: stringSchema({ minLength: 1, maxLength: 600 }),
  riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  signalStrength: { type: "string", enum: ["VERIFIED", "WEAK", "ANECDOTAL"] },
  sourceIndexes: arraySchema({ type: "integer", minimum: 0 }, { minItems: 1, maxItems: 12, uniqueItems: true }),
});

const WEEKLY_RESEARCH_DIGEST_SCHEMA = objectSchema({
  weekStart: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  weekEnd: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  timezone: { type: "string", const: "Asia/Kolkata" },
  executiveSummary: stringSchema({ minLength: 1, maxLength: 1200 }),
  currentTopics: arraySchema(RESEARCH_TOPIC_SCHEMA, { minItems: 3, maxItems: 20 }),
  topicsToAvoid: arraySchema(objectSchema({
    topic: stringSchema({ minLength: 1, maxLength: 240 }),
    reason: stringSchema({ minLength: 1, maxLength: 500 }),
    riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
  }), { maxItems: 20 }),
  sources: arraySchema(SOURCE_CITATION_SCHEMA, { minItems: 1, maxItems: 30 }),
  evidenceGaps: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
  conciseRationale: stringSchema({ minLength: 1, maxLength: 1000 }),
});

const AUDIENCE_THEME_SCHEMA = objectSchema({
  theme: stringSchema({ minLength: 1, maxLength: 240 }),
  evidenceSummary: stringSchema({ minLength: 1, maxLength: 600 }),
  frequencyBand: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  aggregateSources: arraySchema(stringSchema({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: 10, uniqueItems: true }),
});

const AUDIENCE_INTELLIGENCE_SCHEMA = objectSchema({
  weekStart: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  questions: arraySchema(AUDIENCE_THEME_SCHEMA, { minItems: 1, maxItems: 20 }),
  objections: arraySchema(AUDIENCE_THEME_SCHEMA, { maxItems: 20 }),
  confusions: arraySchema(AUDIENCE_THEME_SCHEMA, { maxItems: 20 }),
  emotionalThemes: arraySchema(AUDIENCE_THEME_SCHEMA, { maxItems: 20 }),
  productOrResourceNeeds: arraySchema(AUDIENCE_THEME_SCHEMA, { maxItems: 20 }),
  languagePatterns: arraySchema(stringSchema({ minLength: 1, maxLength: 240 }), { maxItems: 20, uniqueItems: true }),
  potentialPostIdeas: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { minItems: 3, maxItems: 20, uniqueItems: true }),
  privacyNote: { type: "string", const: "Aggregate information only; no personal customer data included." },
  conciseRationale: stringSchema({ minLength: 1, maxLength: 1000 }),
});

const WEEKLY_CANDIDATE_SCHEMA = objectSchema({
  candidateId: stringSchema({ pattern: "^candidate_[a-z0-9_-]{3,72}$" }),
  title: stringSchema({ minLength: 1, maxLength: 180 }),
  objective: { type: "string", enum: OBJECTIVES },
  primaryKpi: { type: "string", enum: KPI_VALUES },
  secondaryKpi: { type: "string", enum: KPI_VALUES },
  audienceSegment: stringSchema({ minLength: 1, maxLength: 300 }),
  topic: stringSchema({ minLength: 1, maxLength: 240 }),
  contentPillar: { type: "string", enum: CONTENT_PILLARS },
  format: { type: "string", enum: FORMATS },
  whyThisWeek: stringSchema({ minLength: 1, maxLength: 700 }),
  whyThisFormat: stringSchema({ minLength: 1, maxLength: 700 }),
  pinkPaisaConnection: stringSchema({ minLength: 1, maxLength: 700 }),
  recommendedLandingPage: nullableString({ maxLength: 2048 }),
  verifiedInternalEntityId: nullableString({ maxLength: 80 }),
  evidenceSourceIndexes: arraySchema({ type: "integer", minimum: 0 }, { maxItems: 12, uniqueItems: true }),
  riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
  promotionalIntensity: { type: "string", enum: ["NONE", "LIGHT", "MODERATE", "HIGH"] },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  duplicateRisk: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH"] },
  conciseRationale: stringSchema({ minLength: 1, maxLength: 800 }),
});

const WEEKLY_CANDIDATES_SCHEMA = objectSchema({
  candidates: arraySchema(WEEKLY_CANDIDATE_SCHEMA, { minItems: 8, maxItems: 12 }),
  generationSummary: stringSchema({ minLength: 1, maxLength: 1000 }),
});

const SELECTED_WEEKLY_POST_SCHEMA = objectSchema({
  candidateId: stringSchema({ pattern: "^candidate_[a-z0-9_-]{3,72}$" }),
  slotNumber: { type: "integer", minimum: 1, maximum: 7 },
  scheduledFor: stringSchema({ minLength: 20, maxLength: 40 }),
  selectionReason: stringSchema({ minLength: 1, maxLength: 800 }),
  roleInWeeklyMix: { type: "string", enum: ["DISCOVERY", "SAVEABLE_EDUCATION", "ENGAGEMENT", "CONVERSION", "OTHER"] },
});

const WEEKLY_PLAN_SCHEMA = objectSchema({
  weekStart: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  weekEnd: stringSchema({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  timezone: { type: "string", const: "Asia/Kolkata" },
  selectedPosts: arraySchema(SELECTED_WEEKLY_POST_SCHEMA, { minItems: 1, maxItems: 7 }),
  rejectedCandidateIds: arraySchema(stringSchema({ pattern: "^candidate_[a-z0-9_-]{3,72}$" }), { minItems: 1, maxItems: 11, uniqueItems: true }),
  formatBalance: stringSchema({ minLength: 1, maxLength: 700 }),
  objectiveBalance: stringSchema({ minLength: 1, maxLength: 700 }),
  promotionalBalance: stringSchema({ minLength: 1, maxLength: 700 }),
  evidenceLimitations: arraySchema(stringSchema({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
  finalRecommendation: stringSchema({ minLength: 1, maxLength: 1200 }),
});

const SUPERVISOR_RECOMMENDATION_SCHEMA = objectSchema({
  readiness: { type: "string", enum: ["READY", "READY_WITH_LIMITATIONS", "BLOCKED"] },
  missingData: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { maxItems: 30 }),
  justifiedAdditionalResearch: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { maxItems: 10 }),
  duplicateWarnings: arraySchema(stringSchema({ minLength: 1, maxLength: 400 }), { maxItems: 20 }),
  recommendation: stringSchema({ minLength: 1, maxLength: 1200 }),
});

const WEEKLY_ANALYTICS_REVIEW_SCHEMA = objectSchema({
  periodStart: stringSchema({ minLength: 10, maxLength: 40 }),
  periodEnd: stringSchema({ minLength: 10, maxLength: 40 }),
  campaignObjectiveAssessments: arraySchema(objectSchema({
    postReference: stringSchema({ minLength: 1, maxLength: 80 }),
    objective: { type: "string", enum: OBJECTIVES },
    primaryKpi: { type: "string", enum: KPI_VALUES },
    assessment: { type: "string", enum: ["ABOVE_BASELINE", "AT_BASELINE", "BELOW_BASELINE", "NO_BASELINE", "METRIC_UNAVAILABLE"] },
    evidence: stringSchema({ minLength: 1, maxLength: 600 }),
  }), { maxItems: 100 }),
  whatWorked: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { maxItems: 20 }),
  whatDidNot: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { maxItems: 20 }),
  remainsUncertain: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { minItems: 1, maxItems: 20 }),
  testsNext: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { maxItems: 20 }),
  doNotRepeat: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { maxItems: 20 }),
  nextPlanInfluences: arraySchema(stringSchema({ minLength: 1, maxLength: 600 }), { minItems: 1, maxItems: 20 }),
  correlationWarning: { type: "string", const: "Observed associations do not establish causation." },
  conciseRationale: stringSchema({ minLength: 1, maxLength: 1200 }),
});

const COMMUNITY_REPLY_RECOMMENDATION_SCHEMA = objectSchema({
  classification: {
    type: "string",
    enum: ["QUESTION", "COMPLIMENT", "COMPLAINT", "LEAD", "PRODUCT_QUESTION", "FINANCIAL_QUESTION", "WORKSHOP_QUESTION", "AFFILIATE_PRODUCT_QUESTION", "SPAM", "ABUSE", "SENSITIVE", "ESCALATION_REQUIRED"],
  },
  suggestedReply: nullableString({ maxLength: 1200 }),
  confidence: { type: "number", minimum: 0, maximum: 1 },
  sourceInformationUsed: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 12 }),
  riskFlags: arraySchema(stringSchema({ minLength: 1, maxLength: 300 }), { maxItems: 20 }),
  escalationRecommended: { type: "boolean" },
  escalationReason: nullableString({ maxLength: 800 }),
  sendAllowedAfterApproval: { type: "boolean" },
  conciseRationale: stringSchema({ minLength: 1, maxLength: 800 }),
});

function structuredError(message, path = "$") {
  const error = new Error(message);
  error.code = "structured_output_invalid";
  error.validation_errors = [`${path}: ${message}`];
  return error;
}

function validateWeeklyCandidates(value) {
  const result = validateWithSchema(WEEKLY_CANDIDATES_SCHEMA, value, "weekly candidate ideas");
  const ids = result.candidates.map((item) => item.candidateId);
  if (new Set(ids).size !== ids.length) throw structuredError("Candidate IDs must be unique", "$.candidates");
  const topics = result.candidates.map((item) => item.topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(topics).size !== topics.length) throw structuredError("Candidate topics must be materially different", "$.candidates");
  result.candidates.forEach((candidate, index) => {
    if (candidate.primaryKpi === candidate.secondaryKpi) {
      throw structuredError("Primary and secondary KPI must differ", `$.candidates[${index}]`);
    }
  });
  return result;
}

function validateWeeklyPlan(value, candidates, maximum = 3) {
  const result = validateWithSchema(WEEKLY_PLAN_SCHEMA, value, "weekly content plan");
  const cap = Math.min(Math.max(Number(maximum || 3), 1), 7);
  if (result.selectedPosts.length > cap) throw structuredError(`Selected posts exceed weekly maximum ${cap}`, "$.selectedPosts");
  const candidateIds = new Set((candidates || []).map((item) => item.candidateId));
  const selectedIds = result.selectedPosts.map((item) => item.candidateId);
  if (new Set(selectedIds).size !== selectedIds.length) throw structuredError("Selected candidate IDs must be unique", "$.selectedPosts");
  for (const id of [...selectedIds, ...result.rejectedCandidateIds]) {
    if (!candidateIds.has(id)) throw structuredError(`Unknown candidate ID ${id}`, "$");
  }
  const slotNumbers = result.selectedPosts.map((item) => item.slotNumber);
  if (new Set(slotNumbers).size !== slotNumbers.length) throw structuredError("Weekly slot numbers must be unique", "$.selectedPosts");
  return result;
}

module.exports = {
  AUDIENCE_INTELLIGENCE_SCHEMA,
  COMMUNITY_REPLY_RECOMMENDATION_SCHEMA,
  CONTENT_PILLARS,
  FORMATS,
  KPI_VALUES,
  OBJECTIVES,
  SOURCE_CITATION_SCHEMA,
  SUPERVISOR_RECOMMENDATION_SCHEMA,
  WEEKLY_ANALYTICS_REVIEW_SCHEMA,
  WEEKLY_CANDIDATES_SCHEMA,
  WEEKLY_CANDIDATE_SCHEMA,
  WEEKLY_PLAN_SCHEMA,
  WEEKLY_RESEARCH_DIGEST_SCHEMA,
  validateWeeklyCandidates,
  validateWeeklyPlan,
};
