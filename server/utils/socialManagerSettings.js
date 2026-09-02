const AdminSettings = require("../models/AdminSettings");

const SOCIAL_MANAGER_SETTINGS_KEY = "social_media_manager";
const SOCIAL_MANAGER_TIMEZONE = "Asia/Kolkata";
const SETTINGS_CACHE_MS = 30 * 1000;
const REQUIRED_BRAND_LOGO_POLICY = Object.freeze({
  contract_version: 1,
  policy_version: "pink-paisa-mandatory-ai-baked-v1",
  required: true,
  method: "AI_REFERENCE_BAKED",
  reference_asset_id: "pink-paisa-profile-badge-v1",
  reference_url: "/pink-paisa-logo.png",
  reference_checksum_sha256: "0cf39611014a2e674bec396a43335f023c803aaffb61256c004bfcb6fabc92e9",
  reference_mime_type: "image/png",
  reference_width: 512,
  reference_height: 512,
  input_fidelity: "high",
  placement_strategy: "ADAPTIVE_SAFE_CORNER_LOCKED_PER_DRAFT",
  locked_corner: null,
  target_width_px: 210,
  accepted_width_range_px: Object.freeze([180, 240]),
  readiness_status: "VERIFY_BEFORE_GENERATION",
});

const CONTENT_PILLAR_KEYS = [
  "money_education",
  "money_psychology",
  "wealth_and_wellness",
  "relatable_money_moments",
  "interactive",
  "pink_paisa_resources",
  "curated_wellness_and_affiliate_products",
];

const CONTENT_PILLAR_DISPLAY_NAMES = Object.freeze({
  money_education: "Money Education",
  money_psychology: "Money Psychology",
  wealth_and_wellness: "Wealth and Wellness",
  relatable_money_moments: "Relatable Money Moments",
  interactive: "Interactive",
  pink_paisa_resources: "Pink Paisa Resources",
  curated_wellness_and_affiliate_products: "Curated Wellness and Affiliate Products",
});

const SOCIAL_OBJECTIVES = Object.freeze([
  "AWARENESS",
  "EDUCATION",
  "ENGAGEMENT",
  "TRAFFIC",
  "LEADS",
  "PRODUCT_PROMOTION",
  "COMMUNITY_BUILDING",
]);

const SOCIAL_VISUAL_MODES = Object.freeze([
  "AI_VISUAL_WITH_EXACT_OVERLAY",
  "AI_BRANDED_ARTWORK",
  "AI_ARTWORK_ONLY",
  "FULL_AI_GRAPHIC",
  "MANUAL_TEMPLATE",
]);

const SOCIAL_WEEKDAYS = Object.freeze([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const DEFAULT_ANALYTICS_INTERVAL_HOURS = Object.freeze([1, 24, 72, 168, 672]);

const DEFAULT_CONTENT_PILLAR_RATIOS = Object.freeze({
  money_education: 25,
  money_psychology: 15,
  wealth_and_wellness: 15,
  relatable_money_moments: 15,
  interactive: 10,
  pink_paisa_resources: 15,
  curated_wellness_and_affiliate_products: 5,
});

const GROWTH_CONTENT_MIX_KEYS = Object.freeze([
  "MONEY",
  "BODY_FITNESS",
  "WELLNESS_BEAUTY",
  "WOMEN_LIFE",
  "PINK_PAISA",
]);

const DEFAULT_GROWTH_CONTENT_MIX = Object.freeze({
  MONEY: 40,
  BODY_FITNESS: 20,
  WELLNESS_BEAUTY: 15,
  WOMEN_LIFE: 15,
  PINK_PAISA: 10,
});

const SOCIAL_SERIES_KEYS = Object.freeze([
  "PINK_PAISA_RULES",
  "WOULD_I_BUY_IT",
  "RICH_GIRL_MATH",
  "AFTER_40",
  "PINK_PAISA_FINDS",
]);

const SOCIAL_HOOK_FORMULA = Object.freeze(["HOOK", "TENSION", "VALUE", "IDENTITY", "CTA"]);

const DEFAULT_SOCIAL_MANAGER_SETTINGS = Object.freeze({
  settings_version: 5,
  feature_enabled: true,
  brand_profile: {
    name: "Pink Paisa",
    positioning: "Wealth | Wellness | Women",
    website_base_url: "https://pinkpaisa.in",
    locale: "en-IN",
    primary_currency: "INR",
    promise: "Financial confidence without complexity, judgment, jargon, or stress.",
    primary_audience: [
      "Indian women",
      "Young professionals",
      "First-time investors",
      "Women starting or considering SIPs",
      "Women rebuilding financial confidence",
      "Women interested in financial and personal wellness",
    ],
    voice: [
      "simple",
      "approachable",
      "empowering",
      "practical",
      "conversational",
      "warm",
      "modern",
      "Indian and culturally relevant",
      "smart friend, not a bank",
    ],
    avoid: [
      "guaranteed returns",
      "personalised financial advice",
      "unsupported financial predictions",
      "unsupported health claims",
      "fear-based selling",
      "get-rich-quick messaging",
      "generic motivational filler",
      "clickbait",
    ],
  },
  visual_brand: {
    heading_font: "DM Serif Display",
    body_font: "DM Sans",
    background_color: "#FFF8F5",
    primary_color: "#D95F86",
    text_color: "#30282B",
    secondary_color: "#8BA888",
    use_logo: true,
    logo_policy: REQUIRED_BRAND_LOGO_POLICY,
  },
  business_priorities: [],
  important_dates: [],
  campaign_priorities: [],
  content_pillar_ratios: DEFAULT_CONTENT_PILLAR_RATIOS,
  content_strategy: {
    rolling_window_weeks: 4,
    growth_content_mix: DEFAULT_GROWTH_CONTENT_MIX,
    series_keys: SOCIAL_SERIES_KEYS,
    hook_formula: SOCIAL_HOOK_FORMULA,
    talking_head_policy: "SCRIPT_SHOT_LIST_ONLY",
  },
  scoring_weights: {
    brand_relevance: 25,
    audience_usefulness: 20,
    timeliness: 15,
    originality: 15,
    engagement_potential: 10,
    business_alignment: 10,
    evidence_quality: 5,
    compliance_risk_penalty_max: 30,
  },
  generation: {
    candidate_count: 5,
    alternative_count: 2,
    hashtag_minimum: 5,
    hashtag_maximum: 10,
    full_ai_generation: true,
    allow_deterministic_content_fallback: false,
    allow_template_only_visual_fallback: false,
    max_content_revisions: 3,
    max_image_retries: 3,
    default_visual_mode: "FULL_AI_GRAPHIC",
    fallback_mode: "DISABLED",
  },
  daily_generation: {
    enabled: false,
    hour_ist: 8,
    minute_ist: 0,
    timezone: SOCIAL_MANAGER_TIMEZONE,
  },
  weekly_planning: {
    enabled: true,
    cadence: "WEEKLY",
    candidate_count: 8,
    maximum_feed_posts: 5,
    max_feed_posts_per_week: 5,
    planning_weekday: "SUNDAY",
    planning_hour_ist: 18,
    planning_minute_ist: 0,
    prepublication_lead_hours: 24,
    research_digest_cache_hours: 168,
    companion_stories_enabled: true,
    timezone: SOCIAL_MANAGER_TIMEZONE,
    posting_slots: [
      { slot_number: 1, weekday: "MONDAY", hour_ist: 11, minute_ist: 0 },
      { slot_number: 2, weekday: "TUESDAY", hour_ist: 18, minute_ist: 0 },
      { slot_number: 3, weekday: "WEDNESDAY", hour_ist: 11, minute_ist: 0 },
      { slot_number: 4, weekday: "THURSDAY", hour_ist: 18, minute_ist: 0 },
      { slot_number: 5, weekday: "FRIDAY", hour_ist: 11, minute_ist: 0 },
    ],
  },
  default_posting_time: {
    hour_ist: 11,
    minute_ist: 0,
    timezone: SOCIAL_MANAGER_TIMEZONE,
  },
  research: {
    enabled: true,
    provider: "AUTO",
    web_search_enabled: false,
    trusted_feeds_enabled: true,
    allow_domains: [],
    block_domains: ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"],
    maximum_source_age_hours: 168,
    request_timeout_ms: 12000,
    maximum_sources: 12,
    require_source_for_current_claims: true,
  },
  models: {
    text_provider: "openai",
    supervisor_model: "gpt-5.6-luna",
    research_model: "gpt-5.6-luna",
    audience_model: "gpt-5.6-luna",
    audience_intelligence_model: "gpt-5.6-luna",
    weekly_planner_model: "gpt-5.6-luna",
    strategy_model: "gpt-5.6-luna",
    copy_model: "gpt-5.6-luna",
    compliance_model: "gpt-5.6-luna",
    visual_direction_model: "gpt-5.6-luna",
    assembly_model: "gpt-5.6-luna",
    growth_analyst_model: "gpt-5.6-luna",
    community_model: "gpt-5.6-luna",
    image_provider: "openai",
    image_model: "gpt-image-2",
    image_size: "1088x1360",
    image_quality: "medium",
    image_output_format: "png",
  },
  cost_controls: {
    monthly_budget_inr: 5000,
    cache_enabled: true,
    request_timeout_ms: 90000,
    retry_limit: 2,
  },
  duplicate_prevention: {
    lookback_days: 90,
    text_similarity_threshold: 0.72,
    semantic_similarity_enabled: false,
    semantic_similarity_threshold: 0.84,
    promotion_lookback_posts: 10,
    maximum_promotional_posts: 2,
  },
  approval: {
    require_human_approval: true,
    allow_self_approval: true,
    require_asset_validation: true,
    require_disclosures: true,
  },
  publishing: {
    enabled: false,
    auto_publish: false,
    provider: "DRAFT_ONLY",
    retry_limit: 3,
    retry_base_delay_seconds: 30,
  },
  analytics: {
    enabled: true,
    snapshot_intervals_hours: DEFAULT_ANALYTICS_INTERVAL_HOURS,
    same_format_baseline_days: 28,
    same_pillar_baseline_days: 90,
    account_baseline_days: 28,
    include_instagram: true,
    include_ga4: true,
    include_search_console: true,
    aggregate_only_for_ai: true,
  },
  watchlists: {
    competitor_accounts: [],
    hashtags: [],
  },
  community: {
    enabled: true,
    webhooks_enabled: false,
    require_human_approval: true,
    auto_reply: false,
    auto_dm: false,
    auto_hide_spam: false,
    classification_confidence_threshold: 0.8,
    reply_confidence_threshold: 0.9,
    sensitive_requires_escalation: true,
    aggregate_only_for_planning: true,
  },
  disclosures: {
    financial_disclaimer: "Educational content only. This is not personalised investment advice.",
    affiliate_disclosure: "Affiliate disclosure: Pink Paisa may earn a commission if you use this link, at no extra cost to you.",
  },
  utm: {
    source: "instagram",
    medium: "organic_social",
    campaign_prefix: "pink_paisa_social",
    lowercase: true,
  },
  notifications: {
    reviewer_emails: [],
    notify_on_draft: true,
    notify_on_failure: true,
    notify_on_publish: true,
  },
});

let cachedSettings = null;
let cachedSettingsExpiresAt = 0;

class SocialManagerSettingsValidationError extends Error {
  constructor(issues) {
    super(`Invalid Social Media Manager settings: ${issues.join("; ")}`);
    this.name = "SocialManagerSettingsValidationError";
    this.code = "social_manager_settings_invalid";
    this.statusCode = 400;
    this.issues = issues;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function firstEnvironmentValue(...names) {
  for (const name of names) {
    if (process.env[name] !== undefined && String(process.env[name]).trim()) return process.env[name];
  }
  return undefined;
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function clampInteger(value, fallback, minimum, maximum) {
  return Math.round(clampNumber(value, fallback, minimum, maximum));
}

function normalizeString(value, fallback, maximumLength = 1000) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maximumLength) : fallback;
}

function normalizeStringArray(value, fallback, maximumItems = 50, maximumLength = 300) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    .slice(0, maximumItems)
    .map((item) => item.slice(0, maximumLength));
}

function normalizeIntegerArray(value, fallback, {
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
  maximumItems = 20,
} = {}) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= minimum && item <= maximum))]
    .sort((left, right) => left - right)
    .slice(0, maximumItems);
}

function normalizePostingSlots(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const seenSlots = new Set();
  return source
    .filter(isPlainObject)
    .map((slot, index) => ({
      slot_number: clampInteger(slot.slot_number, index + 1, 1, 14),
      weekday: SOCIAL_WEEKDAYS.includes(String(slot.weekday || "").trim().toUpperCase())
        ? String(slot.weekday).trim().toUpperCase()
        : null,
      hour_ist: clampInteger(slot.hour_ist, 11, 0, 23),
      minute_ist: clampInteger(slot.minute_ist, 0, 0, 59),
    }))
    .filter((slot) => slot.weekday && !seenSlots.has(slot.slot_number) && seenSlots.add(slot.slot_number))
    .slice(0, 14);
}

function environmentList(name) {
  if (process.env[name] === undefined) return undefined;
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function environmentJsonArray(name) {
  if (process.env[name] === undefined || !String(process.env[name]).trim()) return undefined;
  try {
    const parsed = JSON.parse(process.env[name]);
    if (!Array.isArray(parsed)) throw new Error("value is not an array");
    return parsed;
  } catch (error) {
    throw new SocialManagerSettingsValidationError([
      `${name} must contain a valid JSON array: ${error.message}`,
    ]);
  }
}

function mergeKnown(base, updates) {
  if (!isPlainObject(base) || !isPlainObject(updates)) return clone(base);
  const result = clone(base);
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(updates, key) || updates[key] === undefined) continue;
    if (isPlainObject(base[key]) && isPlainObject(updates[key])) {
      result[key] = mergeKnown(base[key], updates[key]);
    } else {
      result[key] = clone(updates[key]);
    }
  }
  return result;
}

function normalizeRatios(value) {
  const raw = {};
  for (const key of CONTENT_PILLAR_KEYS) {
    raw[key] = clampNumber(value?.[key], DEFAULT_CONTENT_PILLAR_RATIOS[key], 0, 100);
  }
  const total = Object.values(raw).reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return { ...DEFAULT_CONTENT_PILLAR_RATIOS };

  const normalized = {};
  for (const key of CONTENT_PILLAR_KEYS) {
    normalized[key] = Number(((raw[key] / total) * 100).toFixed(2));
  }
  const normalizedTotal = Object.values(normalized).reduce((sum, amount) => sum + amount, 0);
  const adjustmentKey = [...CONTENT_PILLAR_KEYS].sort((left, right) => normalized[right] - normalized[left])[0];
  normalized[adjustmentKey] = Number((normalized[adjustmentKey] + (100 - normalizedTotal)).toFixed(2));
  return normalized;
}

function normalizeGrowthContentMix(value) {
  const source = isPlainObject(value) ? value : DEFAULT_GROWTH_CONTENT_MIX;
  const raw = Object.fromEntries(GROWTH_CONTENT_MIX_KEYS.map((key) => [
    key,
    clampNumber(source[key], DEFAULT_GROWTH_CONTENT_MIX[key], 0, 100),
  ]));
  const total = Object.values(raw).reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return { ...DEFAULT_GROWTH_CONTENT_MIX };
  const normalized = Object.fromEntries(GROWTH_CONTENT_MIX_KEYS.map((key) => [
    key,
    Number(((raw[key] / total) * 100).toFixed(2)),
  ]));
  const normalizedTotal = Object.values(normalized).reduce((sum, amount) => sum + amount, 0);
  normalized.MONEY = Number((normalized.MONEY + (100 - normalizedTotal)).toFixed(2));
  return normalized;
}

function normalizeDomain(value) {
  const input = String(value || "").trim().toLowerCase();
  if (!input) return "";
  try {
    const parsed = new URL(input.includes("://") ? input : `https://${input}`);
    return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function normalizeDomains(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map(normalizeDomain).filter(Boolean))].slice(0, 100);
}

function normalizeDateKey(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : "";
}

function normalizeLandingPage(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized.slice(0, 2048);
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "https:" ? parsed.toString().slice(0, 2048) : null;
  } catch {
    return null;
  }
}

function normalizeImportantDates(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((item) => ({
      date: normalizeDateKey(item.date),
      title: normalizeString(item.title, "", 200),
      description: normalizeString(item.description, "", 1000) || null,
      content_pillar: normalizeString(item.content_pillar, "", 120) || null,
      recurring_annually: parseBoolean(item.recurring_annually, false),
      is_active: parseBoolean(item.is_active, true),
    }))
    .filter((item) => item.date && item.title)
    .slice(0, 100);
}

function normalizeCampaignPriorities(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isPlainObject)
    .map((item) => ({
      key: normalizeString(item.key, "", 100)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, ""),
      title: normalizeString(item.title, "", 200),
      objective: SOCIAL_OBJECTIVES.includes(String(item.objective || "").trim().toUpperCase())
        ? String(item.objective).trim().toUpperCase()
        : "AWARENESS",
      landing_page: normalizeLandingPage(item.landing_page),
      starts_on: normalizeDateKey(item.starts_on) || null,
      ends_on: normalizeDateKey(item.ends_on) || null,
      priority: clampInteger(item.priority, 50, 0, 100),
      is_active: parseBoolean(item.is_active, true),
      notes: normalizeString(item.notes, "", 1000) || null,
    }))
    .filter((item) => item.key && item.title)
    .slice(0, 50);
}

function normaliseSocialManagerSettings(input = {}) {
  const merged = mergeKnown(DEFAULT_SOCIAL_MANAGER_SETTINGS, isPlainObject(input) ? input : {});
  const defaults = DEFAULT_SOCIAL_MANAGER_SETTINGS;
  const suppliedWeeklyPlanning = isPlainObject(input.weekly_planning) ? input.weekly_planning : {};
  const legacyCadenceSettings = Number(input.settings_version || 3) < 4;
  const weeklyMaximumFeedPosts = clampInteger(
    legacyCadenceSettings
      ? defaults.weekly_planning.maximum_feed_posts
      : suppliedWeeklyPlanning.maximum_feed_posts
        ?? suppliedWeeklyPlanning.max_feed_posts_per_week
        ?? merged.weekly_planning.maximum_feed_posts,
    5,
    1,
    5
  );
  const suppliedModels = isPlainObject(input.models) ? input.models : {};
  const audienceModel = normalizeString(
    suppliedModels.audience_model
      ?? suppliedModels.audience_intelligence_model
      ?? merged.models.audience_model,
    defaults.models.audience_model,
    200
  );

  return {
    settings_version: 5,
    feature_enabled: parseBoolean(merged.feature_enabled, defaults.feature_enabled),
    brand_profile: {
      name: normalizeString(merged.brand_profile.name, defaults.brand_profile.name, 100),
      positioning: normalizeString(merged.brand_profile.positioning, defaults.brand_profile.positioning, 200),
      website_base_url: normalizeString(
        merged.brand_profile.website_base_url,
        defaults.brand_profile.website_base_url,
        500
      ).replace(/\/$/, ""),
      locale: normalizeString(merged.brand_profile.locale, defaults.brand_profile.locale, 20),
      primary_currency: normalizeString(
        merged.brand_profile.primary_currency,
        defaults.brand_profile.primary_currency,
        10
      ).toUpperCase(),
      promise: normalizeString(merged.brand_profile.promise, defaults.brand_profile.promise, 700),
      primary_audience: normalizeStringArray(
        merged.brand_profile.primary_audience,
        defaults.brand_profile.primary_audience,
        30,
        300
      ),
      voice: normalizeStringArray(merged.brand_profile.voice, defaults.brand_profile.voice, 30, 200),
      avoid: normalizeStringArray(merged.brand_profile.avoid, defaults.brand_profile.avoid, 50, 300),
    },
    visual_brand: {
      heading_font: normalizeString(merged.visual_brand.heading_font, defaults.visual_brand.heading_font, 100),
      body_font: normalizeString(merged.visual_brand.body_font, defaults.visual_brand.body_font, 100),
      background_color: normalizeString(
        merged.visual_brand.background_color,
        defaults.visual_brand.background_color,
        20
      ).toUpperCase(),
      primary_color: normalizeString(merged.visual_brand.primary_color, defaults.visual_brand.primary_color, 20).toUpperCase(),
      text_color: normalizeString(merged.visual_brand.text_color, defaults.visual_brand.text_color, 20).toUpperCase(),
      secondary_color: normalizeString(
        merged.visual_brand.secondary_color,
        defaults.visual_brand.secondary_color,
        20
      ).toUpperCase(),
      // The legacy flag remains readable for old clients, but generation policy
      // is fail-closed and cannot be switched off.
      use_logo: true,
      logo_policy: {
        ...REQUIRED_BRAND_LOGO_POLICY,
        accepted_width_range_px: [...REQUIRED_BRAND_LOGO_POLICY.accepted_width_range_px],
      },
    },
    business_priorities: normalizeStringArray(merged.business_priorities, [], 20, 500),
    important_dates: normalizeImportantDates(merged.important_dates),
    campaign_priorities: normalizeCampaignPriorities(merged.campaign_priorities),
    content_pillar_ratios: normalizeRatios(merged.content_pillar_ratios),
    content_strategy: {
      rolling_window_weeks: 4,
      growth_content_mix: normalizeGrowthContentMix(merged.content_strategy?.growth_content_mix),
      series_keys: [...SOCIAL_SERIES_KEYS],
      hook_formula: [...SOCIAL_HOOK_FORMULA],
      talking_head_policy: "SCRIPT_SHOT_LIST_ONLY",
    },
    scoring_weights: {
      brand_relevance: clampNumber(merged.scoring_weights.brand_relevance, 25, 0, 25),
      audience_usefulness: clampNumber(merged.scoring_weights.audience_usefulness, 20, 0, 20),
      timeliness: clampNumber(merged.scoring_weights.timeliness, 15, 0, 15),
      originality: clampNumber(merged.scoring_weights.originality, 15, 0, 15),
      engagement_potential: clampNumber(merged.scoring_weights.engagement_potential, 10, 0, 10),
      business_alignment: clampNumber(merged.scoring_weights.business_alignment, 10, 0, 10),
      evidence_quality: clampNumber(merged.scoring_weights.evidence_quality, 5, 0, 5),
      compliance_risk_penalty_max: clampNumber(
        merged.scoring_weights.compliance_risk_penalty_max,
        30,
        0,
        30
      ),
    },
    generation: {
      candidate_count: clampInteger(merged.generation.candidate_count, 5, 5, 8),
      alternative_count: 2,
      hashtag_minimum: clampInteger(merged.generation.hashtag_minimum, 5, 5, 10),
      hashtag_maximum: clampInteger(merged.generation.hashtag_maximum, 10, 5, 10),
      full_ai_generation: parseBoolean(merged.generation.full_ai_generation, true),
      allow_deterministic_content_fallback: parseBoolean(
        merged.generation.allow_deterministic_content_fallback,
        false
      ),
      allow_template_only_visual_fallback: parseBoolean(
        merged.generation.allow_template_only_visual_fallback,
        false
      ),
      max_content_revisions: clampInteger(merged.generation.max_content_revisions, 3, 1, 3),
      max_image_retries: clampInteger(merged.generation.max_image_retries, 3, 1, 3),
      default_visual_mode: merged.generation.default_visual_mode === "AI_ARTWORK_ONLY"
        ? "AI_BRANDED_ARTWORK"
        : SOCIAL_VISUAL_MODES.includes(merged.generation.default_visual_mode)
          ? merged.generation.default_visual_mode
          : defaults.generation.default_visual_mode,
      fallback_mode: "DISABLED",
    },
    daily_generation: {
      enabled: parseBoolean(merged.daily_generation.enabled, defaults.daily_generation.enabled),
      hour_ist: clampInteger(merged.daily_generation.hour_ist, 8, 0, 23),
      minute_ist: clampInteger(merged.daily_generation.minute_ist, 0, 0, 59),
      timezone: SOCIAL_MANAGER_TIMEZONE,
    },
    weekly_planning: {
      enabled: parseBoolean(merged.weekly_planning.enabled, defaults.weekly_planning.enabled),
      cadence: "WEEKLY",
      candidate_count: clampInteger(merged.weekly_planning.candidate_count, 8, 8, 30),
      maximum_feed_posts: weeklyMaximumFeedPosts,
      max_feed_posts_per_week: weeklyMaximumFeedPosts,
      planning_weekday: SOCIAL_WEEKDAYS.includes(String(merged.weekly_planning.planning_weekday || "").toUpperCase())
        ? String(merged.weekly_planning.planning_weekday).toUpperCase()
        : defaults.weekly_planning.planning_weekday,
      planning_hour_ist: clampInteger(merged.weekly_planning.planning_hour_ist, 18, 0, 23),
      planning_minute_ist: clampInteger(merged.weekly_planning.planning_minute_ist, 0, 0, 59),
      prepublication_lead_hours: clampInteger(merged.weekly_planning.prepublication_lead_hours, 24, 1, 168),
      research_digest_cache_hours: clampInteger(merged.weekly_planning.research_digest_cache_hours, 168, 1, 336),
      companion_stories_enabled: true,
      timezone: SOCIAL_MANAGER_TIMEZONE,
      posting_slots: normalizePostingSlots(
        legacyCadenceSettings ? defaults.weekly_planning.posting_slots : merged.weekly_planning.posting_slots,
        defaults.weekly_planning.posting_slots
      ),
    },
    default_posting_time: {
      hour_ist: clampInteger(merged.default_posting_time.hour_ist, 11, 0, 23),
      minute_ist: clampInteger(merged.default_posting_time.minute_ist, 0, 0, 59),
      timezone: SOCIAL_MANAGER_TIMEZONE,
    },
    research: {
      enabled: parseBoolean(merged.research.enabled, defaults.research.enabled),
      provider: ["AUTO", "OPENAI_WEB_SEARCH", "TRUSTED_FEEDS", "DISABLED"].includes(merged.research.provider)
        ? merged.research.provider
        : defaults.research.provider,
      web_search_enabled: parseBoolean(merged.research.web_search_enabled, defaults.research.web_search_enabled),
      trusted_feeds_enabled: parseBoolean(
        merged.research.trusted_feeds_enabled,
        defaults.research.trusted_feeds_enabled
      ),
      allow_domains: normalizeDomains(merged.research.allow_domains, defaults.research.allow_domains),
      block_domains: normalizeDomains(merged.research.block_domains, defaults.research.block_domains),
      maximum_source_age_hours: clampInteger(merged.research.maximum_source_age_hours, 168, 1, 8760),
      request_timeout_ms: clampInteger(merged.research.request_timeout_ms, 12000, 1000, 30000),
      maximum_sources: clampInteger(merged.research.maximum_sources, 12, 1, 30),
      require_source_for_current_claims: true,
    },
    models: {
      text_provider: ["openai", "google", "openrouter"].includes(merged.models.text_provider)
        ? merged.models.text_provider
        : defaults.models.text_provider,
      supervisor_model: normalizeString(merged.models.supervisor_model, defaults.models.supervisor_model, 200),
      research_model: normalizeString(merged.models.research_model, defaults.models.research_model, 200),
      audience_model: audienceModel,
      audience_intelligence_model: audienceModel,
      weekly_planner_model: normalizeString(
        merged.models.weekly_planner_model,
        defaults.models.weekly_planner_model,
        200
      ),
      strategy_model: normalizeString(merged.models.strategy_model, defaults.models.strategy_model, 200),
      copy_model: normalizeString(merged.models.copy_model, defaults.models.copy_model, 200),
      compliance_model: normalizeString(merged.models.compliance_model, defaults.models.compliance_model, 200),
      visual_direction_model: normalizeString(
        merged.models.visual_direction_model,
        defaults.models.visual_direction_model,
        200
      ),
      assembly_model: normalizeString(merged.models.assembly_model, defaults.models.assembly_model, 200),
      growth_analyst_model: normalizeString(
        merged.models.growth_analyst_model,
        defaults.models.growth_analyst_model,
        200
      ),
      community_model: normalizeString(merged.models.community_model, defaults.models.community_model, 200),
      image_provider: ["openai", "google", "openrouter", "none"].includes(merged.models.image_provider)
        ? merged.models.image_provider
        : defaults.models.image_provider,
      image_model: merged.models.image_model
        ? normalizeString(merged.models.image_model, null, 200)
        : defaults.models.image_model,
      image_size: normalizeString(merged.models.image_size, defaults.models.image_size, 40),
      image_quality: ["low", "medium", "high", "auto"].includes(merged.models.image_quality)
        ? merged.models.image_quality
        : defaults.models.image_quality,
      image_output_format: ["png", "jpeg", "webp"].includes(merged.models.image_output_format)
        ? merged.models.image_output_format
        : defaults.models.image_output_format,
    },
    cost_controls: {
      monthly_budget_inr: clampNumber(merged.cost_controls.monthly_budget_inr, 5000, 0, 1000000),
      cache_enabled: parseBoolean(merged.cost_controls.cache_enabled, defaults.cost_controls.cache_enabled),
      request_timeout_ms: clampInteger(merged.cost_controls.request_timeout_ms, 90000, 5000, 180000),
      retry_limit: clampInteger(merged.cost_controls.retry_limit, 2, 0, 5),
    },
    duplicate_prevention: {
      lookback_days: clampInteger(merged.duplicate_prevention.lookback_days, 90, 60, 90),
      text_similarity_threshold: clampNumber(
        merged.duplicate_prevention.text_similarity_threshold,
        0.72,
        0.5,
        1
      ),
      semantic_similarity_enabled: parseBoolean(
        merged.duplicate_prevention.semantic_similarity_enabled,
        false
      ),
      semantic_similarity_threshold: clampNumber(
        merged.duplicate_prevention.semantic_similarity_threshold,
        0.84,
        0.5,
        1
      ),
      promotion_lookback_posts: clampInteger(merged.duplicate_prevention.promotion_lookback_posts, 10, 3, 30),
      maximum_promotional_posts: clampInteger(merged.duplicate_prevention.maximum_promotional_posts, 2, 0, 10),
    },
    approval: {
      require_human_approval: true,
      allow_self_approval: parseBoolean(merged.approval.allow_self_approval, true),
      require_asset_validation: parseBoolean(merged.approval.require_asset_validation, true),
      require_disclosures: parseBoolean(merged.approval.require_disclosures, true),
    },
    publishing: {
      enabled: parseBoolean(merged.publishing.enabled, false),
      auto_publish: parseBoolean(merged.publishing.auto_publish, false),
      provider: ["DRAFT_ONLY", "INSTAGRAM_GRAPH"].includes(merged.publishing.provider)
        ? merged.publishing.provider
        : defaults.publishing.provider,
      retry_limit: clampInteger(merged.publishing.retry_limit, 3, 0, 10),
      retry_base_delay_seconds: clampInteger(merged.publishing.retry_base_delay_seconds, 30, 5, 3600),
    },
    analytics: {
      enabled: parseBoolean(merged.analytics.enabled, defaults.analytics.enabled),
      snapshot_intervals_hours: normalizeIntegerArray(
        merged.analytics.snapshot_intervals_hours,
        defaults.analytics.snapshot_intervals_hours,
        { minimum: 1, maximum: 24 * 365, maximumItems: 12 }
      ),
      same_format_baseline_days: clampInteger(merged.analytics.same_format_baseline_days, 28, 7, 365),
      same_pillar_baseline_days: clampInteger(merged.analytics.same_pillar_baseline_days, 90, 7, 730),
      account_baseline_days: clampInteger(merged.analytics.account_baseline_days, 28, 7, 365),
      include_instagram: parseBoolean(merged.analytics.include_instagram, true),
      include_ga4: parseBoolean(merged.analytics.include_ga4, true),
      include_search_console: parseBoolean(merged.analytics.include_search_console, true),
      aggregate_only_for_ai: true,
    },
    watchlists: {
      competitor_accounts: normalizeStringArray(
        merged.watchlists.competitor_accounts,
        defaults.watchlists.competitor_accounts,
        100,
        200
      ).map((item) => item.toLowerCase()),
      hashtags: normalizeStringArray(merged.watchlists.hashtags, defaults.watchlists.hashtags, 100, 120)
        .map((item) => `#${item.replace(/^#+/, "").replace(/\s+/g, "")}`.toLowerCase())
        .filter((item) => item.length > 1),
    },
    community: {
      enabled: parseBoolean(merged.community.enabled, defaults.community.enabled),
      webhooks_enabled: parseBoolean(merged.community.webhooks_enabled, defaults.community.webhooks_enabled),
      require_human_approval: true,
      auto_reply: parseBoolean(merged.community.auto_reply, false),
      auto_dm: parseBoolean(merged.community.auto_dm, false),
      auto_hide_spam: parseBoolean(merged.community.auto_hide_spam, false),
      classification_confidence_threshold: clampNumber(
        merged.community.classification_confidence_threshold,
        0.8,
        0,
        1
      ),
      reply_confidence_threshold: clampNumber(merged.community.reply_confidence_threshold, 0.9, 0, 1),
      sensitive_requires_escalation: true,
      aggregate_only_for_planning: true,
    },
    disclosures: {
      financial_disclaimer: normalizeString(
        merged.disclosures.financial_disclaimer,
        defaults.disclosures.financial_disclaimer,
        1000
      ),
      affiliate_disclosure: normalizeString(
        merged.disclosures.affiliate_disclosure,
        defaults.disclosures.affiliate_disclosure,
        1000
      ),
    },
    utm: {
      source: "instagram",
      medium: "organic_social",
      campaign_prefix: normalizeString(merged.utm.campaign_prefix, defaults.utm.campaign_prefix, 80)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, ""),
      lowercase: parseBoolean(merged.utm.lowercase, true),
    },
    notifications: {
      reviewer_emails: normalizeStringArray(
        merged.notifications.reviewer_emails,
        defaults.notifications.reviewer_emails,
        20,
        320
      )
        .map((email) => email.toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
      notify_on_draft: parseBoolean(merged.notifications.notify_on_draft, true),
      notify_on_failure: parseBoolean(merged.notifications.notify_on_failure, true),
      notify_on_publish: parseBoolean(merged.notifications.notify_on_publish, true),
    },
  };
}

const normalizeSocialManagerSettings = normaliseSocialManagerSettings;

function findUnknownPaths(value, template, prefix = "", issues = []) {
  if (!isPlainObject(value)) return issues;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(template, key)) {
      issues.push(`${path} is not allowed`);
      continue;
    }
    if (isPlainObject(child) && isPlainObject(template[key])) {
      findUnknownPaths(child, template[key], path, issues);
    }
  }
  return issues;
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function validateSocialManagerSettings(input, { partial = false } = {}) {
  const issues = [];
  if (!isPlainObject(input)) {
    throw new SocialManagerSettingsValidationError(["settings must be an object"]);
  }

  findUnknownPaths(input, DEFAULT_SOCIAL_MANAGER_SETTINGS, "", issues);
  const objectSections = Object.keys(DEFAULT_SOCIAL_MANAGER_SETTINGS).filter((key) =>
    isPlainObject(DEFAULT_SOCIAL_MANAGER_SETTINGS[key])
  );
  for (const section of objectSections) {
    if (Object.hasOwn(input, section) && !isPlainObject(input[section])) {
      issues.push(`${section} must be an object`);
    }
  }

  if (input.settings_version !== undefined && ![2, 3, 4, 5].includes(Number(input.settings_version))) {
    issues.push("settings_version must be 2, 3, 4, or 5");
  }
  if (input.weekly_planning?.companion_stories_enabled === false && Number(input.settings_version || 4) >= 4) {
    issues.push("weekly_planning.companion_stories_enabled cannot be disabled for the approved daily Story cadence");
  }
  if (input.approval?.require_human_approval === false) {
    issues.push("approval.require_human_approval cannot be disabled");
  }
  if (input.visual_brand?.use_logo === false) {
    issues.push("visual_brand.use_logo cannot be disabled");
  }
  if (input.generation?.default_visual_mode === "AI_ARTWORK_ONLY") {
    issues.push(
      "generation.default_visual_mode cannot be AI_ARTWORK_ONLY because BRAND_LOGO_REQUIRED; use AI_BRANDED_ARTWORK"
    );
  }
  const logoPolicy = input.visual_brand?.logo_policy;
  if (logoPolicy && isPlainObject(logoPolicy)) {
    for (const [key, expected] of Object.entries(REQUIRED_BRAND_LOGO_POLICY)) {
      if (logoPolicy[key] === undefined) continue;
      const actual = logoPolicy[key];
      const matches = Array.isArray(expected)
        ? JSON.stringify(actual) === JSON.stringify(expected)
        : actual === expected;
      if (!matches) issues.push(`visual_brand.logo_policy.${key} is locked by the mandatory brand policy`);
    }
  }
  if (input.research?.require_source_for_current_claims === false) {
    issues.push("research.require_source_for_current_claims cannot be disabled");
  }
  if (input.community?.require_human_approval === false) {
    issues.push("community.require_human_approval cannot be disabled");
  }
  if (input.community?.sensitive_requires_escalation === false) {
    issues.push("community.sensitive_requires_escalation cannot be disabled");
  }
  if (input.community?.aggregate_only_for_planning === false) {
    issues.push("community.aggregate_only_for_planning cannot be disabled");
  }
  if (input.analytics?.aggregate_only_for_ai === false) {
    issues.push("analytics.aggregate_only_for_ai cannot be disabled");
  }
  if (input.utm?.source !== undefined && input.utm.source !== "instagram") {
    issues.push("utm.source must be instagram");
  }
  if (input.utm?.medium !== undefined && input.utm.medium !== "organic_social") {
    issues.push("utm.medium must be organic_social");
  }
  for (const timezonePath of ["daily_generation", "weekly_planning", "default_posting_time"]) {
    const supplied = input[timezonePath]?.timezone;
    if (supplied !== undefined && supplied !== SOCIAL_MANAGER_TIMEZONE) {
      issues.push(`${timezonePath}.timezone must be ${SOCIAL_MANAGER_TIMEZONE}`);
    }
  }

  if (input.weekly_planning?.posting_slots !== undefined) {
    const slots = input.weekly_planning.posting_slots;
    if (!Array.isArray(slots)) {
      issues.push("weekly_planning.posting_slots must be an array");
    } else {
      if (slots.length > 14) issues.push("weekly_planning.posting_slots cannot contain more than 14 items");
      const slotNumbers = [];
      slots.forEach((slot, index) => {
        if (!isPlainObject(slot)) {
          issues.push(`weekly_planning.posting_slots[${index}] must be an object`);
          return;
        }
        const allowedKeys = new Set(["slot_number", "weekday", "hour_ist", "minute_ist"]);
        Object.keys(slot).filter((key) => !allowedKeys.has(key)).forEach((key) => {
          issues.push(`weekly_planning.posting_slots[${index}].${key} is not allowed`);
        });
        const slotNumber = Number(slot.slot_number);
        if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 14) {
          issues.push(`weekly_planning.posting_slots[${index}].slot_number must be an integer between 1 and 14`);
        } else {
          slotNumbers.push(slotNumber);
        }
        if (!SOCIAL_WEEKDAYS.includes(String(slot.weekday || "").trim().toUpperCase())) {
          issues.push(`weekly_planning.posting_slots[${index}].weekday is not supported`);
        }
        for (const [field, maximum] of [["hour_ist", 23], ["minute_ist", 59]]) {
          const amount = Number(slot[field]);
          if (!Number.isInteger(amount) || amount < 0 || amount > maximum) {
            issues.push(`weekly_planning.posting_slots[${index}].${field} must be between 0 and ${maximum}`);
          }
        }
      });
      if (new Set(slotNumbers).size !== slotNumbers.length) {
        issues.push("weekly_planning.posting_slots slot_number values must be unique");
      }
    }
  }

  if (input.analytics?.snapshot_intervals_hours !== undefined) {
    const intervals = input.analytics.snapshot_intervals_hours;
    if (!Array.isArray(intervals) || intervals.length === 0 || intervals.length > 12) {
      issues.push("analytics.snapshot_intervals_hours must contain between 1 and 12 intervals");
    } else if (intervals.some((value) => !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 24 * 365)) {
      issues.push("analytics.snapshot_intervals_hours values must be whole hours between 1 and 8760");
    } else if (new Set(intervals.map(Number)).size !== intervals.length) {
      issues.push("analytics.snapshot_intervals_hours values must be unique");
    }
  }

  for (const watchlistPath of ["competitor_accounts", "hashtags"]) {
    const entries = input.watchlists?.[watchlistPath];
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((item) => typeof item !== "string"))) {
      issues.push(`watchlists.${watchlistPath} must be an array of strings`);
    } else if (entries?.length > 100) {
      issues.push(`watchlists.${watchlistPath} cannot contain more than 100 items`);
    }
  }

  if (input.brand_profile?.website_base_url !== undefined) {
    try {
      const parsed = new URL(input.brand_profile.website_base_url);
      if (parsed.protocol !== "https:") issues.push("brand_profile.website_base_url must use HTTPS");
    } catch {
      issues.push("brand_profile.website_base_url must be a valid URL");
    }
  }

  for (const [key, value] of Object.entries(input.content_pillar_ratios || {})) {
    if (!CONTENT_PILLAR_KEYS.includes(key)) continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      issues.push(`content_pillar_ratios.${key} must be between 0 and 100`);
    }
  }

  for (const [key, value] of Object.entries(input.content_strategy?.growth_content_mix || {})) {
    if (!GROWTH_CONTENT_MIX_KEYS.includes(key)) continue;
    if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      issues.push(`content_strategy.growth_content_mix.${key} must be between 0 and 100`);
    }
  }
  if (input.content_strategy?.rolling_window_weeks !== undefined
    && Number(input.content_strategy.rolling_window_weeks) !== 4) {
    issues.push("content_strategy.rolling_window_weeks must remain 4");
  }
  if (input.content_strategy?.talking_head_policy !== undefined
    && input.content_strategy.talking_head_policy !== "SCRIPT_SHOT_LIST_ONLY") {
    issues.push("content_strategy.talking_head_policy must remain SCRIPT_SHOT_LIST_ONLY");
  }
  if (input.content_strategy?.series_keys !== undefined
    && JSON.stringify(input.content_strategy.series_keys) !== JSON.stringify(SOCIAL_SERIES_KEYS)) {
    issues.push("content_strategy.series_keys must contain the approved Pink Paisa series keys in canonical order");
  }
  if (input.content_strategy?.hook_formula !== undefined
    && JSON.stringify(input.content_strategy.hook_formula) !== JSON.stringify(SOCIAL_HOOK_FORMULA)) {
    issues.push("content_strategy.hook_formula must remain HOOK, TENSION, VALUE, IDENTITY, CTA");
  }

  for (const listPath of ["primary_audience", "voice", "avoid"]) {
    const value = input.brand_profile?.[listPath];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
      issues.push(`brand_profile.${listPath} must be an array of strings`);
    }
  }
  if (
    input.business_priorities !== undefined
    && (!Array.isArray(input.business_priorities) || input.business_priorities.some((item) => typeof item !== "string"))
  ) {
    issues.push("business_priorities must be an array of strings");
  } else if (input.business_priorities?.length > 20) {
    issues.push("business_priorities cannot contain more than 20 items");
  }
  if (input.important_dates !== undefined) {
    if (!Array.isArray(input.important_dates)) {
      issues.push("important_dates must be an array");
    } else {
      if (input.important_dates.length > 100) issues.push("important_dates cannot contain more than 100 items");
      input.important_dates.forEach((item, index) => {
        if (!isPlainObject(item)) {
          issues.push(`important_dates[${index}] must be an object`);
          return;
        }
        if (!normalizeDateKey(item.date)) issues.push(`important_dates[${index}].date must use YYYY-MM-DD`);
        if (!String(item.title || "").trim()) issues.push(`important_dates[${index}].title is required`);
        const allowedKeys = new Set(["date", "title", "description", "content_pillar", "recurring_annually", "is_active"]);
        Object.keys(item).filter((key) => !allowedKeys.has(key)).forEach((key) => {
          issues.push(`important_dates[${index}].${key} is not allowed`);
        });
        if (
          item.content_pillar != null
          && !Object.values(CONTENT_PILLAR_DISPLAY_NAMES).includes(String(item.content_pillar).trim())
        ) {
          issues.push(`important_dates[${index}].content_pillar is not supported`);
        }
      });
    }
  }
  if (input.campaign_priorities !== undefined) {
    if (!Array.isArray(input.campaign_priorities)) {
      issues.push("campaign_priorities must be an array");
    } else {
      if (input.campaign_priorities.length > 50) {
        issues.push("campaign_priorities cannot contain more than 50 items");
      }
      input.campaign_priorities.forEach((item, index) => {
        if (!isPlainObject(item)) {
          issues.push(`campaign_priorities[${index}] must be an object`);
          return;
        }
        if (!String(item.key || "").trim()) issues.push(`campaign_priorities[${index}].key is required`);
        if (!String(item.title || "").trim()) issues.push(`campaign_priorities[${index}].title is required`);
        const allowedKeys = new Set([
          "key",
          "title",
          "objective",
          "landing_page",
          "starts_on",
          "ends_on",
          "priority",
          "is_active",
          "notes",
        ]);
        Object.keys(item).filter((key) => !allowedKeys.has(key)).forEach((key) => {
          issues.push(`campaign_priorities[${index}].${key} is not allowed`);
        });
        if (
          item.objective != null
          && !SOCIAL_OBJECTIVES.includes(String(item.objective).trim().toUpperCase())
        ) {
          issues.push(`campaign_priorities[${index}].objective is not supported`);
        }
        if (
          item.priority != null
          && (!Number.isFinite(Number(item.priority)) || Number(item.priority) < 0 || Number(item.priority) > 100)
        ) {
          issues.push(`campaign_priorities[${index}].priority must be between 0 and 100`);
        }
        if (item.starts_on != null && !normalizeDateKey(item.starts_on)) {
          issues.push(`campaign_priorities[${index}].starts_on must use YYYY-MM-DD`);
        }
        if (item.ends_on != null && !normalizeDateKey(item.ends_on)) {
          issues.push(`campaign_priorities[${index}].ends_on must use YYYY-MM-DD`);
        }
        if (
          normalizeDateKey(item.starts_on)
          && normalizeDateKey(item.ends_on)
          && item.ends_on < item.starts_on
        ) {
          issues.push(`campaign_priorities[${index}].ends_on cannot be before starts_on`);
        }
        if (item.landing_page != null && !normalizeLandingPage(item.landing_page)) {
          issues.push(`campaign_priorities[${index}].landing_page must be a relative path or HTTPS URL`);
        }
      });
    }
  }

  const numericRanges = [
    ["scoring_weights.brand_relevance", 0, 25],
    ["scoring_weights.audience_usefulness", 0, 20],
    ["scoring_weights.timeliness", 0, 15],
    ["scoring_weights.originality", 0, 15],
    ["scoring_weights.engagement_potential", 0, 10],
    ["scoring_weights.business_alignment", 0, 10],
    ["scoring_weights.evidence_quality", 0, 5],
    ["scoring_weights.compliance_risk_penalty_max", 0, 30],
    ["generation.candidate_count", 5, 8],
    ["generation.alternative_count", 2, 2],
    ["generation.hashtag_minimum", 5, 10],
    ["generation.hashtag_maximum", 5, 10],
    ["generation.max_content_revisions", 1, 3],
    ["generation.max_image_retries", 1, 3],
    ["daily_generation.hour_ist", 0, 23],
    ["daily_generation.minute_ist", 0, 59],
    ["weekly_planning.candidate_count", 8, 30],
    ["weekly_planning.maximum_feed_posts", 1, 5],
    ["weekly_planning.max_feed_posts_per_week", 1, 5],
    ["weekly_planning.planning_hour_ist", 0, 23],
    ["weekly_planning.planning_minute_ist", 0, 59],
    ["weekly_planning.prepublication_lead_hours", 1, 168],
    ["weekly_planning.research_digest_cache_hours", 1, 336],
    ["default_posting_time.hour_ist", 0, 23],
    ["default_posting_time.minute_ist", 0, 59],
    ["research.maximum_source_age_hours", 1, 8760],
    ["research.request_timeout_ms", 1000, 30000],
    ["research.maximum_sources", 1, 30],
    ["cost_controls.monthly_budget_inr", 0, 1000000],
    ["cost_controls.request_timeout_ms", 5000, 180000],
    ["cost_controls.retry_limit", 0, 5],
    ["duplicate_prevention.lookback_days", 60, 90],
    ["duplicate_prevention.text_similarity_threshold", 0.5, 1],
    ["duplicate_prevention.semantic_similarity_threshold", 0.5, 1],
    ["duplicate_prevention.promotion_lookback_posts", 3, 30],
    ["duplicate_prevention.maximum_promotional_posts", 0, 10],
    ["publishing.retry_limit", 0, 10],
    ["publishing.retry_base_delay_seconds", 5, 3600],
    ["analytics.same_format_baseline_days", 7, 365],
    ["analytics.same_pillar_baseline_days", 7, 730],
    ["analytics.account_baseline_days", 7, 365],
    ["community.classification_confidence_threshold", 0, 1],
    ["community.reply_confidence_threshold", 0, 1],
  ];
  for (const [path, minimum, maximum] of numericRanges) {
    const supplied = valueAtPath(input, path);
    if (supplied === undefined) continue;
    if (!Number.isFinite(Number(supplied)) || Number(supplied) < minimum || Number(supplied) > maximum) {
      issues.push(`${path} must be between ${minimum} and ${maximum}`);
    }
  }

  const enumValues = [
    ["generation.fallback_mode", ["DISABLED"]],
    ["generation.default_visual_mode", SOCIAL_VISUAL_MODES],
    ["weekly_planning.cadence", ["WEEKLY"]],
    ["weekly_planning.planning_weekday", SOCIAL_WEEKDAYS],
    ["research.provider", ["AUTO", "OPENAI_WEB_SEARCH", "TRUSTED_FEEDS", "DISABLED"]],
    ["models.text_provider", ["openai", "google", "openrouter"]],
    ["models.image_provider", ["openai", "google", "openrouter", "none"]],
    ["models.image_quality", ["low", "medium", "high", "auto"]],
    ["models.image_output_format", ["png", "jpeg", "webp"]],
    ["publishing.provider", ["DRAFT_ONLY", "INSTAGRAM_GRAPH"]],
  ];
  for (const [path, allowed] of enumValues) {
    const supplied = valueAtPath(input, path);
    if (supplied !== undefined && !allowed.includes(supplied)) {
      issues.push(`${path} is not an allowed value`);
    }
  }

  for (const domainPath of ["allow_domains", "block_domains"]) {
    const domains = input.research?.[domainPath];
    if (domains !== undefined) {
      if (!Array.isArray(domains) || domains.some((domain) => !normalizeDomain(domain))) {
        issues.push(`research.${domainPath} must contain valid domains or IP addresses`);
      }
    }
  }

  const reviewerEmails = input.notifications?.reviewer_emails;
  if (reviewerEmails !== undefined) {
    if (!Array.isArray(reviewerEmails)) {
      issues.push("notifications.reviewer_emails must be an array");
    } else {
      if (reviewerEmails.length > 20) {
        issues.push("notifications.reviewer_emails cannot contain more than 20 items");
      }
      for (const email of reviewerEmails) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim())) {
          issues.push(`notifications.reviewer_emails contains an invalid email: ${email}`);
        }
      }
    }
  }

  const colors = input.visual_brand || {};
  for (const key of ["background_color", "primary_color", "text_color", "secondary_color"]) {
    if (colors[key] !== undefined && !/^#[A-Fa-f0-9]{6}$/.test(String(colors[key]))) {
      issues.push(`visual_brand.${key} must be a six-digit hex color`);
    }
  }

  if (issues.length) throw new SocialManagerSettingsValidationError(issues);

  if (partial) return input;
  const normalized = normaliseSocialManagerSettings(input);
  if (normalized.generation.hashtag_minimum > normalized.generation.hashtag_maximum) {
    throw new SocialManagerSettingsValidationError([
      "generation.hashtag_minimum cannot exceed generation.hashtag_maximum",
    ]);
  }
  if (normalized.weekly_planning.enabled && normalized.weekly_planning.posting_slots.length === 0) {
    throw new SocialManagerSettingsValidationError([
      "weekly_planning.posting_slots requires at least one configured slot when weekly planning is enabled",
    ]);
  }
  if (normalized.weekly_planning.candidate_count < normalized.weekly_planning.max_feed_posts_per_week) {
    throw new SocialManagerSettingsValidationError([
      "weekly_planning.candidate_count cannot be less than weekly_planning.max_feed_posts_per_week",
    ]);
  }
  if (normalized.analytics.enabled && normalized.analytics.snapshot_intervals_hours.length === 0) {
    throw new SocialManagerSettingsValidationError([
      "analytics.snapshot_intervals_hours requires at least one interval when analytics is enabled",
    ]);
  }
  if (!normalized.generation.full_ai_generation) {
    throw new SocialManagerSettingsValidationError([
      "generation.full_ai_generation must remain enabled for the Social Media Manager",
    ]);
  }
  if (normalized.generation.allow_deterministic_content_fallback) {
    throw new SocialManagerSettingsValidationError([
      "generation.allow_deterministic_content_fallback must remain disabled",
    ]);
  }
  if (normalized.generation.allow_template_only_visual_fallback) {
    throw new SocialManagerSettingsValidationError([
      "generation.allow_template_only_visual_fallback must remain disabled",
    ]);
  }
  if (normalized.generation.default_visual_mode === "MANUAL_TEMPLATE") {
    throw new SocialManagerSettingsValidationError([
      "generation.default_visual_mode cannot be MANUAL_TEMPLATE in full AI mode",
    ]);
  }
  if (normalized.models.text_provider !== "openai") {
    throw new SocialManagerSettingsValidationError([
      "Full AI generation requires models.text_provider openai",
    ]);
  }
  if (normalized.models.image_provider !== "openai" || !normalized.models.image_model) {
    throw new SocialManagerSettingsValidationError([
      "Full AI generation requires models.image_provider openai and a configured image_model",
    ]);
  }
  if (!/^\d+x\d+$/.test(normalized.models.image_size) && normalized.models.image_size !== "auto") {
    throw new SocialManagerSettingsValidationError([
      "models.image_size must be WIDTHxHEIGHT or auto",
    ]);
  }
  if (normalized.publishing.auto_publish && !normalized.publishing.enabled) {
    throw new SocialManagerSettingsValidationError([
      "publishing.auto_publish requires publishing.enabled",
    ]);
  }
  if (normalized.publishing.auto_publish && normalized.publishing.provider !== "INSTAGRAM_GRAPH") {
    throw new SocialManagerSettingsValidationError([
      "publishing.auto_publish requires publishing.provider INSTAGRAM_GRAPH",
    ]);
  }
  if (normalized.publishing.provider === "INSTAGRAM_GRAPH" && !normalized.publishing.enabled) {
    throw new SocialManagerSettingsValidationError([
      "publishing.provider INSTAGRAM_GRAPH requires publishing.enabled",
    ]);
  }
  return normalized;
}

function getSocialManagerDefaults() {
  if (process.env.SOCIAL_TIMEZONE !== undefined
    && String(process.env.SOCIAL_TIMEZONE).trim() !== SOCIAL_MANAGER_TIMEZONE) {
    throw new SocialManagerSettingsValidationError([
      `SOCIAL_TIMEZONE must be ${SOCIAL_MANAGER_TIMEZONE}`,
    ]);
  }
  const reviewerEmails = String(process.env.SOCIAL_MANAGER_REVIEWER_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const textModel = firstEnvironmentValue(
    "OPENAI_SOCIAL_TEXT_MODEL",
    "OPENAI_SOCIAL_MODEL",
    "OPENAI_CAPTION_MODEL"
  );
  const envOverrides = {
    feature_enabled: parseBoolean(process.env.SOCIAL_MANAGER_ENABLED, DEFAULT_SOCIAL_MANAGER_SETTINGS.feature_enabled),
    daily_generation: {
      enabled: parseBoolean(
        process.env.SOCIAL_MANAGER_DAILY_GENERATION_ENABLED,
        DEFAULT_SOCIAL_MANAGER_SETTINGS.daily_generation.enabled
      ),
      hour_ist: process.env.SOCIAL_MANAGER_GENERATION_HOUR_IST,
      minute_ist: process.env.SOCIAL_MANAGER_GENERATION_MINUTE_IST,
    },
    weekly_planning: {
      enabled: parseBoolean(
        process.env.SOCIAL_WEEKLY_PLANNING_ENABLED,
        DEFAULT_SOCIAL_MANAGER_SETTINGS.weekly_planning.enabled
      ),
      candidate_count: process.env.SOCIAL_WEEKLY_CANDIDATE_COUNT,
      maximum_feed_posts: process.env.SOCIAL_MAX_FEED_POSTS_PER_WEEK,
      max_feed_posts_per_week: process.env.SOCIAL_MAX_FEED_POSTS_PER_WEEK,
      planning_weekday: process.env.SOCIAL_WEEKLY_PLANNING_WEEKDAY,
      planning_hour_ist: process.env.SOCIAL_WEEKLY_PLANNING_HOUR_IST,
      planning_minute_ist: process.env.SOCIAL_WEEKLY_PLANNING_MINUTE_IST,
      prepublication_lead_hours: process.env.SOCIAL_PREPUBLICATION_LEAD_HOURS,
      research_digest_cache_hours: process.env.SOCIAL_RESEARCH_DIGEST_CACHE_HOURS,
      posting_slots: environmentJsonArray("SOCIAL_POSTING_SLOTS_JSON"),
    },
    research: {
      web_search_enabled: parseBoolean(process.env.SOCIAL_MANAGER_WEB_SEARCH_ENABLED, false),
    },
    generation: {
      full_ai_generation: parseBoolean(process.env.SOCIAL_AI_FULL_GENERATION, true),
      allow_deterministic_content_fallback: parseBoolean(
        process.env.SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK,
        false
      ),
      allow_template_only_visual_fallback: parseBoolean(
        process.env.SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK,
        false
      ),
      max_content_revisions: process.env.SOCIAL_MAX_CONTENT_REVISIONS,
      max_image_retries: process.env.SOCIAL_MAX_IMAGE_RETRIES,
      default_visual_mode: process.env.SOCIAL_DEFAULT_VISUAL_MODE,
      fallback_mode: "DISABLED",
    },
    models: {
      text_provider: process.env.SOCIAL_MANAGER_TEXT_PROVIDER,
      supervisor_model: process.env.OPENAI_SOCIAL_SUPERVISOR_MODEL || textModel,
      research_model: firstEnvironmentValue(
        "OPENAI_SOCIAL_RESEARCH_MODEL",
        "SOCIAL_MANAGER_RESEARCH_MODEL"
      ) || textModel,
      audience_model: firstEnvironmentValue(
        "OPENAI_SOCIAL_AUDIENCE_MODEL",
        "OPENAI_SOCIAL_AUDIENCE_INTELLIGENCE_MODEL"
      ) || textModel,
      audience_intelligence_model: firstEnvironmentValue(
        "OPENAI_SOCIAL_AUDIENCE_MODEL",
        "OPENAI_SOCIAL_AUDIENCE_INTELLIGENCE_MODEL"
      ) || textModel,
      weekly_planner_model: process.env.OPENAI_SOCIAL_WEEKLY_PLANNER_MODEL || textModel,
      strategy_model: firstEnvironmentValue("OPENAI_SOCIAL_STRATEGY_MODEL", "SOCIAL_MANAGER_STRATEGY_MODEL") || textModel,
      copy_model: firstEnvironmentValue("OPENAI_SOCIAL_COPY_MODEL", "SOCIAL_MANAGER_COPY_MODEL") || textModel,
      compliance_model: firstEnvironmentValue(
        "OPENAI_SOCIAL_COMPLIANCE_MODEL",
        "SOCIAL_MANAGER_COMPLIANCE_MODEL"
      ) || textModel,
      visual_direction_model: process.env.SOCIAL_MANAGER_VISUAL_DIRECTION_MODEL || textModel,
      assembly_model: firstEnvironmentValue("OPENAI_SOCIAL_ASSEMBLY_MODEL", "SOCIAL_MANAGER_ASSEMBLY_MODEL") || textModel,
      growth_analyst_model: process.env.OPENAI_SOCIAL_GROWTH_ANALYST_MODEL || textModel,
      community_model: process.env.OPENAI_SOCIAL_COMMUNITY_MODEL || textModel,
      image_provider: process.env.SOCIAL_MANAGER_IMAGE_PROVIDER,
      image_model: firstEnvironmentValue(
        "OPENAI_SOCIAL_IMAGE_MODEL",
        "SOCIAL_MANAGER_IMAGE_MODEL"
      ),
      image_size: firstEnvironmentValue("OPENAI_SOCIAL_IMAGE_SIZE"),
      image_quality: firstEnvironmentValue("OPENAI_SOCIAL_IMAGE_QUALITY"),
      image_output_format: firstEnvironmentValue("OPENAI_SOCIAL_IMAGE_OUTPUT_FORMAT"),
    },
    approval: {
      require_human_approval: parseBoolean(
        firstEnvironmentValue("SOCIAL_REQUIRE_HUMAN_APPROVAL", "SOCIAL_REQUIRE_APPROVAL"),
        true
      ),
    },
    publishing: {
      enabled: parseBoolean(process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED, false),
      auto_publish: parseBoolean(
        firstEnvironmentValue("SOCIAL_MANAGER_AUTO_PUBLISH", "SOCIAL_AUTO_PUBLISH"),
        false
      ),
      provider: parseBoolean(process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED, false)
        ? "INSTAGRAM_GRAPH"
        : "DRAFT_ONLY",
    },
    analytics: {
      enabled: parseBoolean(process.env.SOCIAL_ANALYTICS_ENABLED, true),
      snapshot_intervals_hours: environmentList("SOCIAL_ANALYTICS_SNAPSHOT_INTERVALS_HOURS"),
    },
    watchlists: {
      competitor_accounts: environmentList("SOCIAL_COMPETITOR_WATCHLIST"),
      hashtags: environmentList("SOCIAL_HASHTAG_WATCHLIST"),
    },
    community: {
      enabled: parseBoolean(process.env.SOCIAL_COMMUNITY_ENABLED, true),
      webhooks_enabled: parseBoolean(process.env.SOCIAL_COMMUNITY_WEBHOOKS_ENABLED, false),
      require_human_approval: true,
      auto_reply: parseBoolean(process.env.SOCIAL_AUTO_REPLY, false),
      auto_dm: parseBoolean(process.env.SOCIAL_AUTO_DM, false),
      auto_hide_spam: parseBoolean(process.env.SOCIAL_AUTO_HIDE_SPAM, false),
    },
    notifications: {
      reviewer_emails: reviewerEmails,
    },
  };
  const normalized = normaliseSocialManagerSettings(envOverrides);
  if (!parseBoolean(firstEnvironmentValue("SOCIAL_REQUIRE_HUMAN_APPROVAL", "SOCIAL_REQUIRE_APPROVAL"), true)) {
    throw new SocialManagerSettingsValidationError([
      "SOCIAL_REQUIRE_HUMAN_APPROVAL cannot be false",
    ]);
  }
  validateSocialManagerSettings(normalized);
  return normalized;
}

function socialManagerSettingsPersistence(input = {}) {
  const normalized = normaliseSocialManagerSettings(input);
  validateSocialManagerSettings(normalized);
  return clone(normalized);
}

function buildSocialManagerRuntimeSettings(input = {}) {
  const settings = normaliseSocialManagerSettings(input);
  const contentPillars = CONTENT_PILLAR_KEYS.map((key) => ({
    name: CONTENT_PILLAR_DISPLAY_NAMES[key],
    ratio: settings.content_pillar_ratios[key],
    enabled: settings.content_pillar_ratios[key] > 0,
  }));
  const contentMix = Object.fromEntries(contentPillars.map((pillar) => [pillar.name, pillar.ratio]));
  const researchProvider = !settings.research.enabled || settings.research.provider === "DISABLED"
    ? "disabled"
    : settings.research.provider === "OPENAI_WEB_SEARCH"
      || (settings.research.provider === "AUTO" && settings.research.web_search_enabled)
      ? "openai_web"
      : settings.research.trusted_feeds_enabled
        ? "trusted_rss"
        : "disabled";

  return {
    ...clone(settings),
    target_audience: [...settings.brand_profile.primary_audience],
    content_pillars: contentPillars,
    content_mix: contentMix,
    business_priorities: [...settings.business_priorities],
    important_dates: clone(settings.important_dates),
    campaign_priorities: clone(settings.campaign_priorities),
    growth_content_mix: clone(settings.content_strategy.growth_content_mix),
    social_series_keys: [...settings.content_strategy.series_keys],
    social_hook_formula: [...settings.content_strategy.hook_formula],
    talking_head_policy: settings.content_strategy.talking_head_policy,
    research_enabled: settings.research.enabled,
    research_provider: researchProvider,
    research_domains: [...settings.research.allow_domains],
    blocked_domains: [...settings.research.block_domains],
    duplicate_lookback_days: settings.duplicate_prevention.lookback_days,
    duplicate_similarity_threshold: settings.duplicate_prevention.text_similarity_threshold,
    ai_enabled: settings.feature_enabled,
    full_ai_generation: settings.generation.full_ai_generation,
    allow_deterministic_content_fallback: settings.generation.allow_deterministic_content_fallback,
    allow_template_only_visual_fallback: settings.generation.allow_template_only_visual_fallback,
    max_content_revisions: settings.generation.max_content_revisions,
    max_image_retries: settings.generation.max_image_retries,
    default_visual_mode: settings.generation.default_visual_mode,
    strategy_provider: settings.feature_enabled ? settings.models.text_provider : "disabled",
    ai_model: settings.models.strategy_model,
    image_model: settings.models.image_model,
    image_provider: settings.models.image_provider,
    image_size: settings.models.image_size,
    image_quality: settings.models.image_quality,
    image_output_format: settings.models.image_output_format,
    financial_disclaimer: settings.disclosures.financial_disclaimer,
    affiliate_disclosure: settings.disclosures.affiliate_disclosure,
    brand_tokens: {
      heading_font: settings.visual_brand.heading_font,
      body_font: settings.visual_brand.body_font,
      background_color: settings.visual_brand.background_color,
      primary_color: settings.visual_brand.primary_color,
      text_color: settings.visual_brand.text_color,
      secondary_color: settings.visual_brand.secondary_color,
      use_logo: settings.visual_brand.use_logo,
      logo_policy: clone(settings.visual_brand.logo_policy),
    },
    publishing_enabled: settings.publishing.enabled,
    auto_publish: settings.publishing.auto_publish,
    reviewer_emails: [...settings.notifications.reviewer_emails],
    generation_enabled: settings.daily_generation.enabled,
    generation_hour_ist: settings.daily_generation.hour_ist,
    generation_minute_ist: settings.daily_generation.minute_ist,
    weekly_planning_enabled: settings.weekly_planning.enabled,
    weekly_candidate_count: settings.weekly_planning.candidate_count,
    maximum_feed_posts: settings.weekly_planning.maximum_feed_posts,
    max_feed_posts_per_week: settings.weekly_planning.max_feed_posts_per_week,
    weekly_planning_weekday: settings.weekly_planning.planning_weekday,
    weekly_planning_hour_ist: settings.weekly_planning.planning_hour_ist,
    weekly_planning_minute_ist: settings.weekly_planning.planning_minute_ist,
    prepublication_lead_hours: settings.weekly_planning.prepublication_lead_hours,
    weekly_posting_slots: clone(settings.weekly_planning.posting_slots),
    analytics_snapshot_intervals_hours: [...settings.analytics.snapshot_intervals_hours],
    competitor_watchlist: [...settings.watchlists.competitor_accounts],
    hashtag_watchlist: [...settings.watchlists.hashtags],
    auto_reply: settings.community.auto_reply,
    auto_dm: settings.community.auto_dm,
    auto_hide_spam: settings.community.auto_hide_spam,
    retry_limit: settings.cost_controls.retry_limit,
    publishing_retry_limit: settings.publishing.retry_limit,
    monthly_budget_inr: settings.cost_controls.monthly_budget_inr,
  };
}

function clearSocialManagerSettingsCache() {
  cachedSettings = null;
  cachedSettingsExpiresAt = 0;
}

async function getSocialManagerSettings({ bypass_cache = false } = {}) {
  if (!bypass_cache && cachedSettings && cachedSettingsExpiresAt > Date.now()) {
    return clone(cachedSettings);
  }
  const defaults = getSocialManagerDefaults();
  const settingsDocument = await AdminSettings.findOne({ key: SOCIAL_MANAGER_SETTINGS_KEY })
    .select("social_manager_settings")
    .lean();
  const normalized = normaliseSocialManagerSettings(
    mergeKnown(defaults, settingsDocument?.social_manager_settings || {})
  );
  // Explicit false environment values are deployment-level kill switches. A
  // persisted admin setting can be more restrictive, but cannot override them.
  if (process.env.SOCIAL_MANAGER_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_MANAGER_ENABLED, true)) {
    normalized.feature_enabled = false;
  }
  if (process.env.SOCIAL_MANAGER_DAILY_GENERATION_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_MANAGER_DAILY_GENERATION_ENABLED, true)) {
    normalized.daily_generation.enabled = false;
  }
  if (process.env.SOCIAL_WEEKLY_PLANNING_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_WEEKLY_PLANNING_ENABLED, true)) {
    normalized.weekly_planning.enabled = false;
  }
  if (process.env.SOCIAL_ANALYTICS_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_ANALYTICS_ENABLED, true)) {
    normalized.analytics.enabled = false;
  }
  if (process.env.SOCIAL_COMMUNITY_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_COMMUNITY_ENABLED, true)) {
    normalized.community.enabled = false;
  }
  if (process.env.SOCIAL_COMMUNITY_WEBHOOKS_ENABLED !== undefined
    && !parseBoolean(process.env.SOCIAL_COMMUNITY_WEBHOOKS_ENABLED, true)) {
    normalized.community.webhooks_enabled = false;
  }
  for (const [environmentName, settingName] of [
    ["SOCIAL_AUTO_REPLY", "auto_reply"],
    ["SOCIAL_AUTO_DM", "auto_dm"],
    ["SOCIAL_AUTO_HIDE_SPAM", "auto_hide_spam"],
  ]) {
    if (process.env[environmentName] !== undefined && !parseBoolean(process.env[environmentName], true)) {
      normalized.community[settingName] = false;
    }
  }
  if (process.env.SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK !== undefined
    && !parseBoolean(process.env.SOCIAL_ALLOW_DETERMINISTIC_CONTENT_FALLBACK, false)) {
    normalized.generation.allow_deterministic_content_fallback = false;
  }
  if (process.env.SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK !== undefined
    && !parseBoolean(process.env.SOCIAL_ALLOW_TEMPLATE_ONLY_VISUAL_FALLBACK, false)) {
    normalized.generation.allow_template_only_visual_fallback = false;
  }
  normalized.approval.require_human_approval = true;
  normalized.community.require_human_approval = true;
  normalized.community.sensitive_requires_escalation = true;
  normalized.community.aggregate_only_for_planning = true;
  normalized.analytics.aggregate_only_for_ai = true;
  validateSocialManagerSettings(normalized);
  cachedSettings = normalized;
  cachedSettingsExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  return clone(normalized);
}

async function saveSocialManagerSettings(input = {}) {
  validateSocialManagerSettings(input, { partial: true });
  const current = await getSocialManagerSettings({ bypass_cache: true });
  const normalized = normaliseSocialManagerSettings(mergeKnown(current, input));
  validateSocialManagerSettings(normalized);

  const saved = await AdminSettings.findOneAndUpdate(
    { key: SOCIAL_MANAGER_SETTINGS_KEY },
    {
      $set: { social_manager_settings: normalized },
      $setOnInsert: { key: SOCIAL_MANAGER_SETTINGS_KEY },
    },
    { new: true, upsert: true, lean: true, runValidators: true }
  );
  cachedSettings = normaliseSocialManagerSettings(saved?.social_manager_settings || normalized);
  cachedSettingsExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  return clone(cachedSettings);
}

module.exports = {
  CONTENT_PILLAR_DISPLAY_NAMES,
  CONTENT_PILLAR_KEYS,
  DEFAULT_ANALYTICS_INTERVAL_HOURS,
  DEFAULT_CONTENT_PILLAR_RATIOS,
  DEFAULT_GROWTH_CONTENT_MIX,
  GROWTH_CONTENT_MIX_KEYS,
  DEFAULT_SOCIAL_MANAGER_SETTINGS,
  REQUIRED_BRAND_LOGO_POLICY,
  SETTINGS_CACHE_MS,
  SOCIAL_MANAGER_SETTINGS_KEY,
  SOCIAL_MANAGER_TIMEZONE,
  SOCIAL_OBJECTIVES,
  SOCIAL_HOOK_FORMULA,
  SOCIAL_SERIES_KEYS,
  SOCIAL_VISUAL_MODES,
  SOCIAL_WEEKDAYS,
  SocialManagerSettingsValidationError,
  buildSocialManagerRuntimeSettings,
  clearSocialManagerSettingsCache,
  getSocialManagerDefaults,
  getSocialManagerSettings,
  normaliseSocialManagerSettings,
  normalizeSocialManagerSettings,
  saveSocialManagerSettings,
  socialManagerSettingsPersistence,
  validateSocialManagerSettings,
};
