const MAX_CAROUSEL_ITEMS = 10;
const DEFAULT_AUTOPILOT_CAROUSEL_COUNT = 4;
const AUTOPILOT_SINGLE_MODE = "autopilot_single";
const AUTOPILOT_CAROUSEL_MODE = "autopilot_carousel";
const AUTOPILOT_MODES = [AUTOPILOT_SINGLE_MODE, AUTOPILOT_CAROUSEL_MODE];
const AUTOPILOT_APPROVAL_REQUIRED = "require_approval";
const AUTOPILOT_DIRECT_PUBLISH = "direct_publish";
const AUTOPILOT_STRATEGY_VERSION = "internal-demand-v1";

function isUncategorizedValue(value) {
  return !value || String(value).trim().toLowerCase() === "uncategorized";
}

function shouldReturnExistingAutopilotBatch(batch) {
  if (!batch) return false;
  const metadata = batch.metadata_json || {};
  if (metadata.autopilot_attempted) return true;
  if (metadata.autopilot_mode) return true;
  const assignedRuns = Array.isArray(batch.run_ids) ? batch.run_ids.length : 0;
  return assignedRuns > 0 || Number(batch.total_runs || 0) > 0;
}

function normalizeAutopilotMode(settings = {}) {
  if (settings.campaign_mode !== "automatic") return "manual_review";
  return ["single_post", "carousel"].includes(settings.campaign_autopilot_mode)
    ? settings.campaign_autopilot_mode
    : "manual_review";
}

function normalizeAutopilotCarouselCount(value) {
  const count = Number(value);
  return Number.isFinite(count)
    ? Math.min(Math.max(Math.round(count), 2), MAX_CAROUSEL_ITEMS)
    : DEFAULT_AUTOPILOT_CAROUSEL_COUNT;
}

function normalizeAutopilotPublishWorkflow(value, fallback = AUTOPILOT_DIRECT_PUBLISH) {
  return [AUTOPILOT_APPROVAL_REQUIRED, AUTOPILOT_DIRECT_PUBLISH].includes(String(value || "").trim())
    ? String(value).trim()
    : fallback;
}

function buildAutopilotEligibleProductQuery() {
  return {
    is_affiliate: true,
    source_type: "admin",
    status: "active",
    is_visible: true,
    archived_at: null,
    affiliate_compliance_status: "compliant",
    affiliate_url: { $nin: [null, ""] },
    affiliate_tag: { $nin: [null, ""] },
    affiliate_link_check_status: { $nin: ["failed", "paused"] },
  };
}

function normalizeProductGroupValue(value) {
  return String(value || "").trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function getAutopilotSignals(product = {}) {
  const signals = product.autopilot_signals && typeof product.autopilot_signals === "object"
    ? product.autopilot_signals
    : {};
  const views30d = clampNumber(signals.views_30d, 0, 1000000);
  const ctaClicks30d = clampNumber(signals.cta_clicks_30d, 0, 1000000);
  const outboundClicks30d = clampNumber(signals.outbound_clicks_30d, 0, 1000000);
  const instagramEvents30d = clampNumber(signals.instagram_events_30d, 0, 1000000);
  const categoryViews30d = clampNumber(signals.category_views_30d, 0, 1000000);
  const categoryOutboundClicks30d = clampNumber(signals.category_outbound_clicks_30d, 0, 1000000);
  const recentProductCampaigns30d = clampNumber(signals.recent_product_campaigns_30d, 0, 1000);
  const recentCategoryCampaigns7d = clampNumber(signals.recent_category_campaigns_7d, 0, 1000);
  const productCtr30d = views30d > 0 ? Math.min(outboundClicks30d / views30d, 1) : 0;
  const categoryCtr30d = categoryViews30d > 0 ? Math.min(categoryOutboundClicks30d / categoryViews30d, 1) : 0;
  return {
    views_30d: views30d,
    cta_clicks_30d: ctaClicks30d,
    outbound_clicks_30d: outboundClicks30d,
    instagram_events_30d: instagramEvents30d,
    category_views_30d: categoryViews30d,
    category_outbound_clicks_30d: categoryOutboundClicks30d,
    recent_product_campaigns_30d: recentProductCampaigns30d,
    recent_category_campaigns_7d: recentCategoryCampaigns7d,
    product_ctr_30d: productCtr30d,
    category_ctr_30d: categoryCtr30d,
  };
}

function getAutopilotProductScore(product = {}) {
  let score = 0;
  if (product.affiliate_is_instagram_pick) score += 1000;
  if (product.is_featured_affiliate) score += 500;
  const sortOrder = Number(product.affiliate_sort_order || 0);
  score += Math.max(100 - Math.min(Math.max(sortOrder, 0), 100), 0);
  if (product.featured) score += 50;
  if (product.bestseller) score += 25;

  const signals = getAutopilotSignals(product);
  score += Math.min(signals.outbound_clicks_30d * 18, 360);
  score += Math.min(signals.cta_clicks_30d * 8, 160);
  score += Math.min(signals.views_30d * 0.8, 120);
  score += Math.min(signals.instagram_events_30d * 14, 180);
  score += Math.round(signals.product_ctr_30d * 220);
  score += Math.min(signals.category_outbound_clicks_30d * 4, 160);
  score += Math.round(signals.category_ctr_30d * 120);
  score -= Math.min(signals.recent_product_campaigns_30d * 260, 780);
  score -= Math.min(signals.recent_category_campaigns_7d * 35, 175);

  return score;
}

function sortAutopilotProducts(products = []) {
  return [...products].sort((a, b) => {
    const scoreDelta = getAutopilotProductScore(b) - getAutopilotProductScore(a);
    if (scoreDelta !== 0) return scoreDelta;
    const aCreated = new Date(a.createdAt || a.created_at || 0).getTime() || 0;
    const bCreated = new Date(b.createdAt || b.created_at || 0).getTime() || 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function selectSingleAutopilotProduct(products = []) {
  const [selected] = sortAutopilotProducts(products);
  return selected || null;
}

function getProductDecisionReasons(product = {}) {
  const signals = getAutopilotSignals(product);
  const reasons = [];
  if (product.affiliate_is_instagram_pick) reasons.push("marked as an Instagram pick");
  if (product.is_featured_affiliate) reasons.push("featured affiliate priority");
  if (signals.outbound_clicks_30d > 0) reasons.push(`${signals.outbound_clicks_30d} outbound click(s) in 30 days`);
  if (signals.product_ctr_30d > 0) reasons.push(`${Math.round(signals.product_ctr_30d * 100)}% product CTR signal`);
  if (signals.instagram_events_30d > 0) reasons.push(`${signals.instagram_events_30d} Instagram-sourced event(s)`);
  if (signals.category_outbound_clicks_30d > 0) reasons.push(`${signals.category_outbound_clicks_30d} category click(s) in 30 days`);
  if (signals.recent_product_campaigns_30d > 0) reasons.push("recently promoted, so fatigue penalty applied");
  if (!reasons.length) reasons.push("best available admin-priority and freshness score");
  return reasons.slice(0, 4);
}

function selectCarouselAutopilotProducts(products = [], requestedCount = DEFAULT_AUTOPILOT_CAROUSEL_COUNT) {
  const count = normalizeAutopilotCarouselCount(requestedCount);
  const byCategory = new Map();
  for (const product of products) {
    const category = normalizeProductGroupValue(product.category);
    if (!category || isUncategorizedValue(category)) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(product);
  }

  const categoryOptions = Array.from(byCategory.entries())
    .filter(([, values]) => values.length >= count)
    .map(([category, values]) => ({
      category,
      products: sortAutopilotProducts(values),
      score: values.reduce((sum, product) => sum + getAutopilotProductScore(product), 0) + values.length,
      reasons: buildCategoryDecisionReasons(category, values),
    }))
    .sort((a, b) => (b.score - a.score) || a.category.localeCompare(b.category));

  if (!categoryOptions.length) {
    return {
      category: null,
      products: [],
      reason: `Not enough eligible products in one category for a ${count}-slide carousel.`,
    };
  }

  const selectedCategory = categoryOptions[0];
  const bySubcategory = new Map();
  for (const product of selectedCategory.products) {
    const subcategory = normalizeProductGroupValue(product.subcategory) || "General";
    if (!bySubcategory.has(subcategory)) bySubcategory.set(subcategory, []);
    bySubcategory.get(subcategory).push(product);
  }
  const subcategoryBuckets = Array.from(bySubcategory.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subcategory, values]) => ({ subcategory, products: sortAutopilotProducts(values), index: 0 }));

  const selected = [];
  while (selected.length < count && subcategoryBuckets.some((bucket) => bucket.index < bucket.products.length)) {
    for (const bucket of subcategoryBuckets) {
      if (selected.length >= count) break;
      const next = bucket.products[bucket.index];
      if (!next) continue;
      bucket.index += 1;
      selected.push(next);
    }
  }

  if (selected.length < count) {
    return {
      category: selectedCategory.category,
      products: [],
      reason: `Only ${selected.length} eligible product(s) were available after subcategory balancing.`,
    };
  }

  return {
    category: selectedCategory.category,
    products: selected,
    score: selectedCategory.score,
    reasons: selectedCategory.reasons,
    reason: null,
  };
}

function buildCategoryDecisionReasons(category, products = []) {
  const totals = products.reduce((acc, product) => {
    const signals = getAutopilotSignals(product);
    acc.views += signals.category_views_30d || signals.views_30d;
    acc.clicks += signals.category_outbound_clicks_30d || signals.outbound_clicks_30d;
    acc.instagram += signals.instagram_events_30d;
    acc.recentCampaigns += signals.recent_category_campaigns_7d;
    return acc;
  }, { views: 0, clicks: 0, instagram: 0, recentCampaigns: 0 });
  const reasons = [`${category} has enough eligible products for a complete carousel`];
  if (totals.clicks > 0) reasons.push(`${totals.clicks} category outbound click signal(s)`);
  if (totals.instagram > 0) reasons.push(`${totals.instagram} Instagram-sourced engagement signal(s)`);
  if (totals.recentCampaigns > 0) reasons.push("recent category fatigue was considered");
  return reasons.slice(0, 4);
}

function buildAutopilotSelectionReport({
  mode,
  products = [],
  selectedProducts = [],
  selectedCategory = null,
  requestedCount = null,
  categoryReasons = [],
} = {}) {
  const categorySet = new Set(products.map((product) => normalizeProductGroupValue(product.category)).filter(Boolean));
  const selected = selectedProducts.map((product) => ({
    id: String(product._id || ""),
    title: product.title || null,
    category: product.category || null,
    subcategory: product.subcategory || null,
    score: Math.round(getAutopilotProductScore(product)),
    reasons: getProductDecisionReasons(product),
    signals: getAutopilotSignals(product),
  }));
  return {
    version: AUTOPILOT_STRATEGY_VERSION,
    mode,
    strategy: "internal demand, Instagram intent, admin priority, category freshness, and campaign fatigue",
    considered_products: products.length,
    considered_categories: categorySet.size,
    selected_category: selectedCategory || null,
    requested_count: requestedCount || null,
    selected_products: selected,
    category_reasons: categoryReasons,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  AUTOPILOT_STRATEGY_VERSION,
  AUTOPILOT_CAROUSEL_MODE,
  AUTOPILOT_APPROVAL_REQUIRED,
  AUTOPILOT_DIRECT_PUBLISH,
  AUTOPILOT_MODES,
  AUTOPILOT_SINGLE_MODE,
  DEFAULT_AUTOPILOT_CAROUSEL_COUNT,
  MAX_CAROUSEL_ITEMS,
  buildAutopilotEligibleProductQuery,
  buildAutopilotSelectionReport,
  getAutopilotProductScore,
  getAutopilotSignals,
  getProductDecisionReasons,
  normalizeAutopilotCarouselCount,
  normalizeAutopilotMode,
  normalizeAutopilotPublishWorkflow,
  normalizeProductGroupValue,
  selectCarouselAutopilotProducts,
  selectSingleAutopilotProduct,
  shouldReturnExistingAutopilotBatch,
};
