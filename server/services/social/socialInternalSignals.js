const AffiliateEvent = require("../../models/AffiliateEvent");
const Blog = require("../../models/Blog");
const MarketingCampaignRun = require("../../models/MarketingCampaignRun");
const PinkPagesListing = require("../../models/PinkPagesListing");
const Poll = require("../../models/Poll");
const Product = require("../../models/Product");
const SocialMetricSnapshot = require("../../models/SocialMetricSnapshot");
const SocialPostDraft = require("../../models/SocialPostDraft");
const VirtualProduct = require("../../models/VirtualProduct");
const Workshop = require("../../models/Workshop");
const dailyPredictionService = require("../dailyPredictionService");
const { normalizeWhitespace, trimText } = require("./socialCompliance");

const STATIC_RESOURCES = Object.freeze([
  {
    type: "quiz",
    title: "Wealthness Quiz",
    summary: "A free women-first quiz that helps visitors understand their money mindset and next steps.",
    landing_page: "/quiz",
    active: true,
  },
  {
    type: "calculator",
    title: "SIP Calculator",
    summary: "A rupee-based educational calculator for exploring regular investment scenarios.",
    landing_page: "/financial-calculator/sip-calculator",
    active: true,
  },
  {
    type: "calculator",
    title: "Lump-sum Calculator",
    summary: "A rupee-based educational calculator for exploring one-time investment scenarios.",
    landing_page: "/financial-calculator/lumpsum-calculator",
    active: true,
  },
  {
    type: "calculator",
    title: "EMI Calculator",
    summary: "A practical calculator for understanding monthly loan repayments.",
    landing_page: "/financial-calculator/emi-calculator",
    active: true,
  },
  {
    type: "wellness_hub",
    title: "Pink Paisa Wellness",
    summary: "The public Pink Paisa wellness discovery hub with affiliate-safe product routes.",
    landing_page: "/wellness",
    active: true,
  },
  {
    type: "instagram_hub",
    title: "Pink Paisa Instagram Link Hub",
    summary: "The permanent Start Here route for the Wealthness Quiz, calculators, verified affiliate picks and workshop quote requests.",
    landing_page: "/instagram",
    active: true,
  },
]);

function digitalProductsArePromotable() {
  return String(process.env.DIGITAL_PRODUCTS_ENABLED || "false").trim().toLowerCase() === "true";
}

function getIstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function compactList(values = [], limit = 12) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
    .slice(0, limit);
}

function serialiseProduct(product = {}) {
  return {
    id: product._id?.toString?.() || null,
    title: normalizeWhitespace(product.title),
    brand_name: normalizeWhitespace(product.brand_name) || null,
    slug: trimText(product.slug),
    short_description: normalizeWhitespace(product.short_description).slice(0, 500) || null,
    category: normalizeWhitespace(product.category),
    subcategory: normalizeWhitespace(product.subcategory),
    tags: compactList(product.tags, 12),
    supported_pros: compactList(product.pros, 8),
    buying_intent: normalizeWhitespace(product.buying_intent).slice(0, 300) || null,
    campaign_label: normalizeWhitespace(product.campaign_label).slice(0, 160) || null,
    is_affiliate: Boolean(product.is_affiliate),
    affiliate_marketplace: product.is_affiliate ? product.affiliate_marketplace || null : null,
    affiliate_asin: product.is_affiliate ? normalizeWhitespace(product.affiliate_asin) || null : null,
    verified_affiliate_url: product.is_affiliate ? trimText(product.affiliate_url) || null : null,
    compliance_status: product.affiliate_compliance_status || null,
    affiliate_is_instagram_pick: product.is_affiliate ? product.affiliate_is_instagram_pick === true : false,
    affiliate_link_check_status: product.is_affiliate ? product.affiliate_link_check_status || null : null,
    media_url: product.affiliate_campaign_asset_url || product.featured_image || product.images?.[0] || null,
    usage_rights_status: product.affiliate_campaign_usage_rights || null,
    landing_page: product.slug ? `/product/${encodeURIComponent(product.slug)}` : null,
    verified_facts_only: true,
  };
}

function productEligibleForSocialSignals(product = {}) {
  if (!product.is_affiliate) return true;
  return product.affiliate_is_instagram_pick === true
    && product.affiliate_link_check_status === "ok";
}

function serialiseRecentSocialDraft(draft = {}) {
  const packageValue = draft.current_package || draft.result_json || {};
  return {
    id: draft._id?.toString?.() || null,
    generation_date: draft.generation_date || packageValue.generationDate || null,
    status: draft.status || null,
    rejection_reason: draft.status === "REJECTED" || draft.rejection_reason
      ? normalizeWhitespace(draft.rejection_reason).slice(0, 1000) || null
      : null,
    scheduled_for: draft.scheduled_for || null,
    primaryRecommendation: packageValue.primaryRecommendation || draft.primary_recommendation || null,
  };
}

function serialisePredictionSnapshot(status = null) {
  const batch = status?.current_batch;
  if (!batch) {
    return {
      enabled: Boolean(status?.predictions_ai_enabled || status?.env_enabled),
      status: status?.disabled_reason ? "unavailable" : "empty",
      generated_at: null,
      expires_at: null,
      questions: [],
      aggregate_votes: null,
    };
  }
  const aggregate = batch.vote_analytics || status?.daily_vote_analytics || {};
  return {
    enabled: true,
    status: batch.status || "live",
    date_key: batch.date_key || null,
    generated_at: batch.generated_at || null,
    expires_at: batch.expires_at || null,
    questions: (Array.isArray(batch.questions) ? batch.questions : []).slice(0, 20).map((question) => ({
      id: question.id || null,
      question: normalizeWhitespace(question.question).slice(0, 500),
      category: normalizeWhitespace(question.category).slice(0, 120) || null,
      source_type: question.source_type || "ai_daily",
      source_refs: Array.isArray(question.source_refs) ? cloneSafe(question.source_refs).slice(0, 12) : [],
      yes_count: Number(question.yes_count || 0),
      no_count: Number(question.no_count || 0),
      total_votes: Number(question.yes_count || 0) + Number(question.no_count || 0),
    })),
    aggregate_votes: {
      total_genuine_votes: Number(aggregate.total_genuine_votes || 0),
      beta_launch_votes: Number(aggregate.beta_launch_votes || 0),
      organic_votes: Number(aggregate.organic_votes || 0),
      duplicate_attempts: Number(aggregate.duplicate_attempts || 0),
      rate_limited_attempts: Number(aggregate.rate_limited_attempts || 0),
    },
  };
}

function cloneSafe(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function serialiseMarketingRun(run = {}) {
  return {
    id: run._id?.toString?.() || null,
    generation_date: run.created_at ? getIstDateKey(new Date(run.created_at)) : null,
    topic: run.product_title || run.strategy_json?.angle || "Product campaign",
    hooks: run.strategy_json?.hooks || [],
    caption: run.caption_json?.caption || run.caption_json?.final_caption || "",
    cta: run.cta_text || run.caption_json?.cta || "",
    format: run.content_type === "carousel" ? "CAROUSEL" : "SINGLE_IMAGE",
    contentPillar: "Curated Wellness and Affiliate Products",
    productTitle: run.product_title || "",
    visualConcept: run.creative_json || {},
  };
}

async function collectAffiliatePerformance({ since, models }) {
  const rows = await models.AffiliateEvent.aggregate([
    { $match: { createdAt: { $gte: since }, is_bot: false } },
    {
      $group: {
        _id: { category: "$category", campaign: { $ifNull: ["$utm_campaign", "$campaign_label"] } },
        views: { $sum: { $cond: [{ $eq: ["$event_type", "product_view"] }, 1, 0] } },
        cta_clicks: { $sum: { $cond: [{ $eq: ["$event_type", "cta_click"] }, 1, 0] } },
        outbound_clicks: { $sum: { $cond: [{ $eq: ["$event_type", "outbound_click"] }, 1, 0] } },
      },
    },
    { $sort: { outbound_clicks: -1, cta_clicks: -1, views: -1 } },
    { $limit: 20 },
  ]);
  return rows.map((row) => ({
    category: row._id?.category || null,
    campaign: row._id?.campaign || null,
    views: Number(row.views || 0),
    cta_clicks: Number(row.cta_clicks || 0),
    outbound_clicks: Number(row.outbound_clicks || 0),
  }));
}

async function collectInternalSignals({ now = new Date(), settings = {}, dependencies = {} } = {}) {
  const models = {
    AffiliateEvent: dependencies.AffiliateEvent || AffiliateEvent,
    Blog: dependencies.Blog || Blog,
    MarketingCampaignRun: dependencies.MarketingCampaignRun || MarketingCampaignRun,
    PinkPagesListing: dependencies.PinkPagesListing || PinkPagesListing,
    Poll: dependencies.Poll || Poll,
    Product: dependencies.Product || Product,
    SocialMetricSnapshot: dependencies.SocialMetricSnapshot || SocialMetricSnapshot,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    VirtualProduct: dependencies.VirtualProduct || VirtualProduct,
    Workshop: dependencies.Workshop || Workshop,
    getAdminPredictionStatus: dependencies.getAdminPredictionStatus || dailyPredictionService.getAdminPredictionStatus,
  };
  const lookbackDays = Math.min(Math.max(Number(settings.duplicate_lookback_days || 90), 60), 365);
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const performanceSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const upcomingScheduleEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [products, blogs, workshops, virtualProducts, polls, pinkPages, socialDrafts, upcomingScheduledDrafts, marketingRuns, affiliatePerformance, socialMetricSnapshots, predictionStatus] = await Promise.all([
    models.Product.find({
      status: "active",
      is_visible: true,
      archived_at: null,
      category: { $nin: [null, "", "Uncategorized"] },
      $or: [
        { is_affiliate: false },
        {
          is_affiliate: true,
          affiliate_is_instagram_pick: true,
          affiliate_compliance_status: "compliant",
          affiliate_url: { $nin: [null, ""] },
          affiliate_link_check_status: "ok",
          affiliate_campaign_usage_rights: { $in: ["admin_confirmed", "owned", "licensed", "api_permitted"] },
        },
      ],
    })
      .select("title slug short_description category subcategory brand_name tags pros buying_intent campaign_label is_affiliate affiliate_marketplace affiliate_asin affiliate_url affiliate_compliance_status affiliate_link_check_status affiliate_campaign_asset_url featured_image images affiliate_campaign_usage_rights affiliate_is_instagram_pick is_featured_affiliate featured createdAt")
      .sort({ affiliate_is_instagram_pick: -1, is_featured_affiliate: -1, featured: -1, createdAt: -1 })
      .limit(60)
      .lean(),
    models.Blog.find({ status: "published" }).select("title slug excerpt category tags published_at").sort({ published_at: -1, createdAt: -1 }).limit(20).lean(),
    models.Workshop.find({ status: "active" }).select("title slug short_description category tags benefits").sort({ featured: -1, sort_order: 1 }).limit(20).lean(),
    models.VirtualProduct.find({ status: "active", is_active: true }).select("title slug subtitle description includes format").sort({ sort_order: 1 }).limit(20).lean(),
    models.Poll.find({ $or: [{ ends_at: null }, { ends_at: { $gte: now } }] }).select("question category yes_count no_count ends_at createdAt").sort({ createdAt: -1 }).limit(20).lean(),
    models.PinkPagesListing.find({ status: "active", verified: true, email: { $not: /example@/i } }).select("business_name slug short_description city state category_id").sort({ featured: -1, sort_order: 1 }).limit(12).lean(),
    models.SocialPostDraft.find({ created_at: { $gte: since } }).select("generation_date status rejection_reason current_package result_json primary_topic primary_content_pillar primary_format created_at published_at").sort({ created_at: -1 }).limit(120).lean(),
    models.SocialPostDraft.find({
      status: "SCHEDULED",
      scheduled_for: { $gte: now, $lte: upcomingScheduleEnd },
    }).select("generation_date scheduled_for current_package primary_topic primary_content_pillar primary_format").sort({ scheduled_for: 1 }).limit(30).lean(),
    models.MarketingCampaignRun.find({ created_at: { $gte: since }, status: { $nin: ["archived"] } }).select("product_title strategy_json caption_json cta_text content_type creative_json created_at").sort({ created_at: -1 }).limit(120).lean(),
    collectAffiliatePerformance({ since: performanceSince, models }),
    models.SocialMetricSnapshot.find({ captured_at: { $gte: performanceSince } })
      .select("draft_id captured_at metrics source")
      .sort({ captured_at: -1 })
      .limit(500)
      .lean(),
    Promise.resolve().then(() => models.getAdminPredictionStatus()).catch((error) => ({
      current_batch: null,
      disabled_reason: normalizeWhitespace(error?.message).slice(0, 300) || "Pink Predictions aggregate is unavailable",
    })),
  ]);
  const promotableProducts = products.filter(productEligibleForSocialSignals);
  const promotableVirtualProducts = digitalProductsArePromotable() ? virtualProducts : [];

  const recentHistory = [
    ...socialDrafts.map(serialiseRecentSocialDraft),
    ...marketingRuns.map(serialiseMarketingRun),
  ];
  const recentPillarMix = recentHistory.reduce((acc, entry) => {
    const recommendation = entry.primaryRecommendation || entry;
    const pillar = recommendation?.contentPillar || recommendation?.content_pillar;
    if (pillar) acc[pillar] = Number(acc[pillar] || 0) + 1;
    return acc;
  }, {});
  const latestMetricsByDraft = new Map();
  socialMetricSnapshots.forEach((snapshot) => {
    const key = String(snapshot.draft_id || "");
    if (key && !latestMetricsByDraft.has(key)) latestMetricsByDraft.set(key, snapshot);
  });
  const socialPerformance = socialDrafts
    .map((draft) => {
      const snapshot = latestMetricsByDraft.get(String(draft._id));
      const recommendation = (draft.current_package || draft.result_json || {}).primaryRecommendation || {};
      if (!snapshot) return null;
      return {
        draft_id: String(draft._id),
        topic: recommendation.topic || null,
        content_pillar: recommendation.contentPillar || null,
        format: recommendation.format || null,
        target_audience_segment: recommendation.targetAudienceSegment || null,
        posting_time: draft.published_at || null,
        metrics: snapshot.metrics || {},
        captured_at: snapshot.captured_at,
        source: snapshot.source,
      };
    })
    .filter(Boolean);
  const performanceSummary = Object.values(socialPerformance.reduce((acc, row) => {
    const key = `${row.content_pillar || "Unknown"}|${row.format || "Unknown"}`;
    const summary = acc[key] || {
      content_pillar: row.content_pillar || "Unknown",
      format: row.format || "Unknown",
      observed_posts: 0,
      saves: 0,
      shares: 0,
      comments: 0,
      website_clicks: 0,
      negative_feedback: 0,
    };
    summary.observed_posts += 1;
    for (const metric of ["saves", "shares", "comments", "website_clicks", "negative_feedback"]) {
      summary[metric] += Number(row.metrics?.[metric] || 0);
    }
    acc[key] = summary;
    return acc;
  }, {})).sort((left, right) => (right.saves + right.shares) - (left.saves + left.shares));
  const generationDate = getIstDateKey(now);
  const activeImportantDates = (Array.isArray(settings.important_dates) ? settings.important_dates : [])
    .filter((item) => item?.is_active !== false)
    .filter((item) => item.recurring_annually || !item.date || item.date >= generationDate)
    .slice(0, 20);
  const activeCampaignPriorities = (Array.isArray(settings.campaign_priorities) ? settings.campaign_priorities : [])
    .filter((item) => item?.is_active !== false)
    .filter((item) => (!item.starts_on || item.starts_on <= generationDate) && (!item.ends_on || item.ends_on >= generationDate))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))
    .slice(0, 20);
  const configuredPriorities = [
    ...(settings.business_priorities || []),
    ...activeCampaignPriorities.map((item) => `${item.title}: ${item.objective || item.notes || "active campaign priority"}`),
    ...activeImportantDates.map((item) => `${item.title}: ${item.description || item.date || "important business date"}`),
  ];
  const dateParts = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
  }).formatToParts(now);
  const dayOfWeek = dateParts.find((part) => part.type === "weekday")?.value || null;
  const dayOfMonth = Number(dateParts.find((part) => part.type === "day")?.value || 0);
  const salaryCycleContext = dayOfMonth >= 1 && dayOfMonth <= 7
    ? "EARLY_MONTH_SALARY_WINDOW"
    : dayOfMonth >= 25
      ? "PRE_SALARY_MONTH_END"
      : "MID_MONTH_MONEY_ROUTINE";

  return {
    collected_at: now.toISOString(),
    generation_date: generationDate,
    timezone: "Asia/Kolkata",
    day_of_week: dayOfWeek,
    salary_cycle_context: salaryCycleContext,
    summary: {
      active_product_count: promotableProducts.length,
      active_affiliate_product_count: promotableProducts.filter((product) => product.is_affiliate).length,
      active_blog_count: blogs.length,
      active_workshop_count: workshops.length,
      active_virtual_product_count: promotableVirtualProducts.length,
      active_poll_count: polls.length,
      verified_pink_pages_count: pinkPages.length,
      recent_social_draft_count: socialDrafts.length,
      scheduled_next_14_days_count: upcomingScheduledDrafts.length,
      recent_product_campaign_count: marketingRuns.length,
      current_prediction_question_count: predictionStatus?.current_batch?.questions?.length || 0,
    },
    priorities: compactList(configuredPriorities, 30),
    important_dates: activeImportantDates,
    campaign_priorities: activeCampaignPriorities,
    products: promotableProducts.map(serialiseProduct),
    blogs: blogs.map((blog) => ({
      id: blog._id?.toString?.() || null,
      title: normalizeWhitespace(blog.title),
      excerpt: normalizeWhitespace(blog.excerpt).slice(0, 500) || null,
      category: normalizeWhitespace(blog.category) || null,
      tags: compactList(blog.tags, 10),
      landing_page: blog.slug ? `/blogs/${encodeURIComponent(blog.slug)}` : null,
      published_at: blog.published_at || null,
    })),
    workshops: workshops.map((workshop) => ({
      id: workshop._id?.toString?.() || null,
      title: normalizeWhitespace(workshop.title),
      summary: normalizeWhitespace(workshop.short_description).slice(0, 500) || null,
      category: normalizeWhitespace(workshop.category),
      tags: compactList(workshop.tags, 10),
      supported_benefits: compactList(workshop.benefits, 8),
      landing_page: "/workshops",
    })),
    virtual_products: promotableVirtualProducts.map((product) => ({
      id: product._id?.toString?.() || null,
      title: normalizeWhitespace(product.title),
      summary: normalizeWhitespace(product.subtitle || product.description).slice(0, 500) || null,
      includes: compactList(product.includes, 10),
      format: normalizeWhitespace(product.format) || null,
      landing_page: product.slug ? `/product/${encodeURIComponent(product.slug)}` : "/products",
    })),
    polls: polls.map((poll) => ({
      id: poll._id?.toString?.() || null,
      question: normalizeWhitespace(poll.question),
      category: normalizeWhitespace(poll.category),
      total_votes: Number(poll.yes_count || 0) + Number(poll.no_count || 0),
    })),
    pink_predictions: serialisePredictionSnapshot(predictionStatus),
    pink_pages: pinkPages.map((listing) => ({
      id: listing._id?.toString?.() || null,
      business_name: normalizeWhitespace(listing.business_name),
      summary: normalizeWhitespace(listing.short_description).slice(0, 500) || null,
      city: normalizeWhitespace(listing.city) || null,
      state: normalizeWhitespace(listing.state) || null,
      landing_page: "/pink-pages",
    })),
    static_resources: STATIC_RESOURCES.map((resource) => ({ ...resource })),
    affiliate_performance_30d: affiliatePerformance,
    social_performance_30d: socialPerformance,
    performance_summary: performanceSummary,
    performance_interpretation: "Observed engagement and traffic metrics are directional associations, not proof that a format or topic caused the result.",
    scheduled_next_14_days: upcomingScheduledDrafts.map(serialiseRecentSocialDraft),
    website_traffic: null,
    quiz_and_calculator_usage: socialMetricSnapshots.length
      ? {
        quiz_starts: socialMetricSnapshots.reduce((sum, row) => sum + Number(row.metrics?.quiz_starts || 0), 0),
        quiz_completions: socialMetricSnapshots.reduce((sum, row) => sum + Number(row.metrics?.quiz_completions || 0), 0),
        calculator_opens: socialMetricSnapshots.reduce((sum, row) => sum + Number(row.metrics?.calculator_opens || 0), 0),
        provenance: "aggregated_social_metric_snapshots",
      }
      : null,
    recent_history: recentHistory,
    recent_pillar_mix: recentPillarMix,
  };
}

module.exports = {
  STATIC_RESOURCES,
  collectInternalSignals,
  serialiseMarketingRun,
  serialiseProduct,
  serialisePredictionSnapshot,
  serialiseRecentSocialDraft,
  _private: { compactList, digitalProductsArePromotable, getIstDateKey, productEligibleForSocialSignals },
};
