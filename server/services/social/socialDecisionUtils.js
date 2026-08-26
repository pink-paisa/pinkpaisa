const { scanRecommendationCompliance, normalizeWhitespace } = require("./socialCompliance");

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "how",
  "in", "is", "it", "of", "on", "or", "our", "that", "the", "their", "this", "to", "was", "what",
  "when", "where", "which", "who", "why", "will", "with", "you", "your",
]);

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(Math.max(numeric, minimum), maximum);
}

function tokenize(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9₹]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function jaccardSimilarity(left, right) {
  const leftSet = new Set(tokenize(left));
  const rightSet = new Set(tokenize(right));
  if (!leftSet.size && !rightSet.size) return 1;
  if (!leftSet.size || !rightSet.size) return 0;
  let intersection = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) intersection += 1;
  });
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function normalizeRecommendationHistoryEntry(value = {}) {
  const recommendation = value.primaryRecommendation || value.primary_recommendation || value.current_package?.primaryRecommendation || value;
  return {
    id: value.id || value._id?.toString?.() || null,
    generation_date: value.generation_date || value.generationDate || null,
    topic: recommendation.topic || "",
    hook: Array.isArray(recommendation.hooks) ? recommendation.hooks[0] || "" : recommendation.hook || "",
    caption: recommendation.caption || "",
    cta: recommendation.cta || "",
    format: recommendation.format || "",
    content_pillar: recommendation.contentPillar || recommendation.content_pillar || "",
    product: recommendation.verifiedProductTitle || recommendation.verified_product_title || recommendation.productTitle || recommendation.product_title || "",
    visual_concept: recommendation.visualConcept?.mainVisual || recommendation.visual_concept?.main_visual || "",
  };
}

function compareRecommendationToHistory(candidate = {}, history = []) {
  const normalizedCandidate = normalizeRecommendationHistoryEntry(candidate);
  const fieldWeights = {
    topic: 0.28,
    hook: 0.18,
    caption: 0.18,
    cta: 0.08,
    format: 0.06,
    content_pillar: 0.08,
    product: 0.06,
    visual_concept: 0.08,
  };
  let closest = null;
  for (const entry of history.map(normalizeRecommendationHistoryEntry)) {
    const field_scores = {};
    let weighted = 0;
    for (const [field, weight] of Object.entries(fieldWeights)) {
      const left = normalizedCandidate[field];
      const right = entry[field];
      const score = ["format", "content_pillar", "product"].includes(field)
        ? (normalizeWhitespace(left).toLowerCase() && normalizeWhitespace(left).toLowerCase() === normalizeWhitespace(right).toLowerCase() ? 1 : 0)
        : jaccardSimilarity(left, right);
      field_scores[field] = Number(score.toFixed(4));
      weighted += score * weight;
    }
    const result = {
      history_id: entry.id,
      generation_date: entry.generation_date,
      similarity: Number(weighted.toFixed(4)),
      field_scores,
    };
    if (!closest || result.similarity > closest.similarity) closest = result;
  }
  return closest || { history_id: null, generation_date: null, similarity: 0, field_scores: {} };
}

function isMateriallyDifferent(duplicateAnalysis = {}, threshold = 0.72) {
  return Number(duplicateAnalysis.similarity || 0) < clamp(threshold, 0.1, 1);
}

function normalizeScoreBreakdown(value = {}) {
  const normalized = {
    brandRelevance: clamp(value.brandRelevance, 0, 25),
    audienceUsefulness: clamp(value.audienceUsefulness, 0, 20),
    timeliness: clamp(value.timeliness, 0, 15),
    originality: clamp(value.originality, 0, 15),
    engagementPotential: clamp(value.engagementPotential, 0, 10),
    businessAlignment: clamp(value.businessAlignment, 0, 10),
    evidenceQuality: clamp(value.evidenceQuality, 0, 5),
    compliancePenalty: clamp(value.compliancePenalty, -30, 0),
    total: 0,
  };
  normalized.total = Number(Math.max(0, Object.entries(normalized)
    .filter(([key]) => key !== "total")
    .reduce((sum, [, score]) => sum + score, 0)).toFixed(2));
  return normalized;
}

function calculateScoreBreakdown(candidate = {}, {
  suggestedScore = {},
  duplicateAnalysis = {},
  recentPillarCount = 0,
  recentPromotionalCount = 0,
  evidenceCount = 0,
} = {}) {
  const base = normalizeScoreBreakdown({
    brandRelevance: suggestedScore.brandRelevance ?? 21,
    audienceUsefulness: suggestedScore.audienceUsefulness ?? 17,
    timeliness: suggestedScore.timeliness ?? (candidate.isEvergreen ? 7 : 12),
    originality: suggestedScore.originality ?? 13,
    engagementPotential: suggestedScore.engagementPotential ?? 7,
    businessAlignment: suggestedScore.businessAlignment ?? 7,
    evidenceQuality: suggestedScore.evidenceQuality ?? Math.min(Number(evidenceCount || 0), 5),
    compliancePenalty: suggestedScore.compliancePenalty ?? 0,
  });
  const duplicateSimilarity = clamp(duplicateAnalysis.similarity, 0, 1);
  base.originality = clamp(base.originality - duplicateSimilarity * 15, 0, 15);
  base.originality = clamp(base.originality - Math.min(Number(recentPillarCount || 0) * 1.5, 6), 0, 15);
  if (candidate.contentPillar === "Curated Wellness and Affiliate Products") {
    base.businessAlignment = clamp(base.businessAlignment - Math.min(Number(recentPromotionalCount || 0) * 1.5, 5), 0, 10);
  }
  const compliance = scanRecommendationCompliance(candidate, { requireSourcesForCurrentClaims: true });
  base.compliancePenalty = Math.min(base.compliancePenalty, compliance.compliance_penalty);
  return {
    scoreBreakdown: normalizeScoreBreakdown(base),
    compliance,
    duplicateAnalysis,
  };
}

function applyContentRotation(candidates = [], recentHistory = [], pillarRatios = {}) {
  const counts = recentHistory.reduce((acc, entry) => {
    const pillar = normalizeRecommendationHistoryEntry(entry).content_pillar;
    if (pillar) acc[pillar] = Number(acc[pillar] || 0) + 1;
    return acc;
  }, {});
  const total = Math.max(recentHistory.length, 1);
  return candidates.map((candidate) => {
    const targetRatio = Number(pillarRatios[candidate.contentPillar] || 0) / 100;
    const currentRatio = Number(counts[candidate.contentPillar] || 0) / total;
    const rotationAdjustment = targetRatio > currentRatio ? 2 : currentRatio > targetRatio + 0.1 ? -3 : 0;
    const score = normalizeScoreBreakdown(candidate.scoreBreakdown || {});
    score.originality = clamp(score.originality + rotationAdjustment, 0, 15);
    return { ...candidate, scoreBreakdown: normalizeScoreBreakdown(score), rotationAdjustment };
  });
}

function selectTopRecommendations(candidates = [], count = 3) {
  return [...candidates]
    .filter((candidate) => candidate.compliance?.passed !== false && candidate.duplicate_rejected !== true)
    .sort((left, right) => Number(right.scoreBreakdown?.total || 0) - Number(left.scoreBreakdown?.total || 0))
    .slice(0, count);
}

module.exports = {
  applyContentRotation,
  calculateScoreBreakdown,
  clamp,
  compareRecommendationToHistory,
  isMateriallyDifferent,
  jaccardSimilarity,
  normalizeRecommendationHistoryEntry,
  normalizeScoreBreakdown,
  selectTopRecommendations,
  tokenize,
};
