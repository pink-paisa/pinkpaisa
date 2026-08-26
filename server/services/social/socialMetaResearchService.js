const crypto = require("node:crypto");
const SocialResearchObservation = require("../../models/SocialResearchObservation");
const {
  getInstagramCapabilityMatrix,
  _private: { redactText },
} = require("./socialGrowthConnectors");

const ROLLING_UNIQUE_HASHTAG_LIMIT = 30;
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MEDIA_LIMIT = 25;
const MAX_WATCHLIST_ITEMS = 100;

const THEME_PATTERNS = Object.freeze([
  ["MONEY_EDUCATION", /\b(?:money|saving|budget|finance|financial|invest|investment|sip|mutual\s*fund|stock|tax|credit|debt|loan|insurance|retire|wealth)\b/iu],
  ["MONEY_CONFIDENCE", /\b(?:confidence|independent|empower|habit|mindset|anxiety|stress|fear|freedom)\b/iu],
  ["WELLNESS", /\b(?:wellness|health|mindful|fitness|sleep|nutrition|self[-\s]?care|mental)\b/iu],
  ["CAREER_AND_BUSINESS", /\b(?:career|salary|work|job|entrepreneur|business|founder|freelance|income)\b/iu],
  ["PRODUCT_OR_RESOURCE", /\b(?:product|guide|workbook|calculator|quiz|workshop|course|download|link\s+in\s+bio)\b/iu],
]);
const DIRECTIONAL_QUESTIONS = Object.freeze({
  MONEY_EDUCATION: "Which practical money concept could be explained more clearly for a beginner?",
  MONEY_CONFIDENCE: "Which money-confidence barrier is not addressed in this bounded sample?",
  WELLNESS: "How can a wealth decision be connected responsibly to everyday wellbeing?",
  CAREER_AND_BUSINESS: "Which career, income, or entrepreneurship money question remains underserved?",
  PRODUCT_OR_RESOURCE: "Which verified Pink Paisa resource could answer an unmet practical need without forced promotion?",
});

class SocialMetaResearchError extends Error {
  constructor(message, { code = "META_RESEARCH_ERROR", status = null } = {}) {
    super(message);
    this.name = "SocialMetaResearchError";
    this.code = code;
    this.status = status;
  }
}

function trimValue(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeHashtag(value) {
  const hashtag = trimValue(value).replace(/^#+/, "").normalize("NFKC").toLowerCase();
  return /^[\p{L}\p{N}_]{1,100}$/u.test(hashtag) ? hashtag : "";
}

function normalizeUsername(value) {
  const username = trimValue(value).replace(/^@+/, "").toLowerCase();
  return /^(?=.{1,30}$)(?!.*\.\.)[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])?$/.test(username) ? username : "";
}

function watchlistsFromSettings(settings = {}) {
  const hashtags = settings.watchlists?.hashtags || settings.hashtag_watchlist || [];
  const accounts = settings.watchlists?.competitor_accounts || settings.competitor_watchlist || [];
  return {
    hashtags: unique((Array.isArray(hashtags) ? hashtags : []).map(normalizeHashtag).filter(Boolean)).slice(0, MAX_WATCHLIST_ITEMS),
    accounts: unique((Array.isArray(accounts) ? accounts : []).map(normalizeUsername).filter(Boolean)).slice(0, MAX_WATCHLIST_ITEMS),
  };
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function boundedCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateRelevance(value, now) {
  const date = safeDate(value);
  if (!date) return "UNKNOWN";
  const age = now.getTime() - date.getTime();
  if (age < -5 * 60 * 1000) return "UNKNOWN";
  if (age <= 48 * 60 * 60 * 1000) return "CURRENT";
  if (age <= ROLLING_WINDOW_MS) return "RECENT";
  return "STALE";
}

function safeInstagramPermalink(value) {
  try {
    const parsed = new URL(trimValue(value));
    if (parsed.protocol !== "https:" || !["instagram.com", "www.instagram.com"].includes(parsed.hostname.toLowerCase())) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function mediaFormat(media = {}) {
  const product = trimValue(media.mediaProductType || media.media_product_type).toUpperCase();
  const type = trimValue(media.mediaType || media.media_type).toUpperCase();
  if (product === "REELS") return "REEL";
  if (product === "STORY") return "STORY";
  if (type === "CAROUSEL_ALBUM") return "CAROUSEL";
  if (type === "IMAGE") return "SINGLE_IMAGE";
  if (type === "VIDEO" && product === "FEED") return "VIDEO_FEED";
  return type || product || "UNKNOWN";
}

function mediaCaption(media = {}) {
  return trimValue(media.caption).slice(0, 2200);
}

function resultForMedia(media, { resultType, topic, now }) {
  const id = trimValue(media.id);
  if (!id) return null;
  const publishedAt = safeDate(media.timestamp);
  const format = mediaFormat(media);
  const likes = boundedCount(media.likeCount ?? media.like_count);
  const comments = boundedCount(media.commentsCount ?? media.comments_count);
  const metrics = {};
  if (likes !== null) metrics.likes = likes;
  if (comments !== null) metrics.comments = comments;
  return {
    result_key: `instagram-media:${id}`,
    result_type: resultType,
    topic,
    observation_summary: `${format === "UNKNOWN" ? "Public media" : format.replace(/_/g, " ")} observed through the official Meta API; public indicators are descriptive, not a quality ranking.`,
    format,
    published_at: publishedAt,
    date_relevance: dateRelevance(publishedAt, now),
    account_type: null,
    source_url: safeInstagramPermalink(media.permalink),
    aggregate_metrics: metrics,
  };
}

function commonFormats(media = []) {
  const counts = new Map();
  for (const item of media) counts.set(mediaFormat(item), Number(counts.get(mediaFormat(item)) || 0) + 1);
  const total = media.length;
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([format, occurrenceCount]) => ({
      format,
      occurrence_count: occurrenceCount,
      share: total ? occurrenceCount / total : null,
      concise_note: "Observed format share within this bounded public-media sample.",
    }));
}

function captionPatterns(media = []) {
  const definitions = [
    ["NO_CAPTION", "No caption text was present in the returned public-media object.", (text) => !text],
    ["SHORT_CAPTION", "Caption length was 280 characters or fewer.", (text) => text.length > 0 && text.length <= 280],
    ["MEDIUM_CAPTION", "Caption length was between 281 and 1,000 characters.", (text) => text.length > 280 && text.length <= 1000],
    ["LONG_CAPTION", "Caption length exceeded 1,000 characters.", (text) => text.length > 1000],
    ["QUESTION_STRUCTURE", "Caption used a question structure.", (text) => text.includes("?")],
    ["LIST_STRUCTURE", "Caption used a multi-line or numbered-list structure.", (text) => /(?:^|\n)\s*(?:[-•]|\d+[.)])\s+/u.test(text)],
    ["ENGAGEMENT_CTA", "Caption used a save, share, comment, follow, or link-in-bio call to action.", (text) => /\b(?:save|share|comment|follow|link\s+in\s+bio)\b/iu.test(text)],
    ["HASHTAG_DENSE", "Caption contained at least five hashtag tokens.", (text) => (text.match(/#[\p{L}\p{N}_]+/gu) || []).length >= 5],
  ];
  const texts = media.map(mediaCaption);
  return definitions.map(([patternKey, abstractPattern, matches]) => {
    const count = texts.filter(matches).length;
    return count ? {
      pattern_key: patternKey,
      abstract_pattern: abstractPattern,
      occurrence_count: count,
      confidence: texts.length ? count / texts.length : 0,
    } : null;
  }).filter(Boolean);
}

function themeClusters(media = [], resultKeys = []) {
  return THEME_PATTERNS.map(([label, pattern]) => {
    const matchedKeys = [];
    media.forEach((item, index) => {
      if (pattern.test(mediaCaption(item))) matchedKeys.push(resultKeys[index]);
      pattern.lastIndex = 0;
    });
    return matchedKeys.length ? {
      label,
      concise_summary: "Controlled topic classifier matched this theme in the bounded sample; no source caption is stored.",
      occurrence_count: matchedKeys.length,
      confidence: Math.min(0.45 + (matchedKeys.length / Math.max(media.length, 1)) * 0.4, 0.85),
      result_keys: matchedKeys,
    } : null;
  }).filter(Boolean);
}

function summarizeIndicators(media = []) {
  const likes = media.map((item) => boundedCount(item.likeCount ?? item.like_count)).filter((value) => value !== null);
  const comments = media.map((item) => boundedCount(item.commentsCount ?? item.comments_count)).filter((value) => value !== null);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    observed_media_count: media.length,
    public_likes_total: likes.length ? sum(likes) : null,
    public_comments_total: comments.length ? sum(comments) : null,
    average_public_likes: likes.length ? sum(likes) / likes.length : null,
    average_public_comments: comments.length ? sum(comments) / comments.length : null,
  };
}

function connectionFingerprint(summary = {}) {
  return sha256({
    provider: trimValue(summary.provider || "instagram_login").toLowerCase(),
    accountId: trimValue(summary.instagram_user_id || summary.accountId),
  }).slice(0, 20);
}

function capabilityContext(summary = {}) {
  const provider = trimValue(summary.provider || "instagram_login").toLowerCase();
  const accountId = trimValue(summary.instagram_user_id || summary.accountId);
  const accountType = trimValue(summary.account_type || summary.accountType).toUpperCase();
  const pageId = trimValue(summary.facebook_page_id || summary.pageId);
  const scopes = summary.granted_scopes || summary.scopes || [];
  const matrix = getInstagramCapabilityMatrix({ provider, accountType, pageId, scopes });
  return { provider, accountId, accountType, pageId, scopes, matrix };
}

function operationError(error, fallbackCode = "META_RESEARCH_REQUEST_FAILED") {
  const message = redactText(trimValue(error?.message || "Meta research request failed"))
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .slice(0, 400);
  return {
    code: trimValue(error?.code || fallbackCode).slice(0, 120),
    message,
    status: Number(error?.status || error?.statusCode || 0) || null,
  };
}

function publicErrors(errors = []) {
  const byKey = new Map();
  for (const error of errors) {
    const normalized = {
      code: trimValue(error?.code || "META_RESEARCH_REQUEST_FAILED").slice(0, 120),
      message: trimValue(error?.message || "Meta research request failed").slice(0, 400),
      ...(Number(error?.status) ? { status: Number(error.status) } : {}),
      retryable: [408, 425, 429, 500, 502, 503, 504].includes(Number(error?.status)),
    };
    const key = `${normalized.code}:${normalized.message}`;
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return [...byKey.values()];
}

function toObject(value) {
  if (!value) return null;
  if (typeof value.toObject === "function") return value.toObject({ virtuals: false, flattenMaps: true });
  return JSON.parse(JSON.stringify(value));
}

function publicObservation(value) {
  const row = toObject(value);
  if (!row) return null;
  return {
    id: String(row._id || row.id || ""),
    observation_key: row.observation_key,
    provider: row.provider,
    source: row.source,
    query_key: row.query_key,
    observation_date: row.observation_date,
    observation_type: row.observation_type,
    status: row.status,
    results: row.results || [],
    topic_clusters: row.topic_clusters || [],
    common_formats: row.common_formats || [],
    caption_patterns: row.caption_patterns || [],
    date_relevance: row.date_relevance,
    account_type: row.account_type || null,
    aggregate_summary: row.aggregate_summary || null,
    provenance: row.provenance || null,
    created_at: row.created_at || null,
  };
}

async function findExisting(Model, idempotencyKey) {
  const query = Model.findOne({ idempotency_key: idempotencyKey });
  return query && typeof query.lean === "function" ? query.lean() : query;
}

async function persistObservation(record, dependencies = {}) {
  const Model = dependencies.SocialResearchObservation || SocialResearchObservation;
  const existing = await findExisting(Model, record.idempotency_key);
  if (existing) return existing;
  try {
    return await Model.findOneAndUpdate(
      { idempotency_key: record.idempotency_key },
      { $setOnInsert: record },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return findExisting(Model, record.idempotency_key);
  }
}

function baseObservation({ type, queryKey, source, status, now, fingerprint, rawValue, accountType = null, limitations = [], attemptKey = null }) {
  const kind = type === "HASHTAG_SEARCH" ? "hashtag" : "business";
  const attemptSuffix = attemptKey ? `:${sha256(attemptKey).slice(0, 16)}` : "";
  return {
    idempotency_key: `meta-research:${kind}:${isoDate(now)}:${fingerprint}:${sha256(queryKey).slice(0, 24)}:${status.toLowerCase()}${attemptSuffix}`,
    observation_key: `meta-research:${kind}:${queryKey}`,
    provider: "META",
    source,
    query_key: queryKey,
    observation_date: isoDate(now),
    observation_type: type,
    status,
    results: [],
    topic_clusters: [],
    common_formats: [],
    caption_patterns: [],
    date_relevance: "CURRENT",
    relevant_from: now,
    relevant_until: new Date(now.getTime() + ROLLING_WINDOW_MS),
    account_type: accountType,
    aggregate_summary: null,
    provenance: {
      adapter: type === "HASHTAG_SEARCH" ? "meta_hashtag_search_watchlist" : "meta_business_discovery_watchlist",
      adapter_version: "1.0.0",
      connection_fingerprint: fingerprint,
      connection_health_id: null,
      source_ids: [],
      source_urls: [],
      retrieved_at: now,
      provider_request_id: null,
      evidence_limitations: limitations,
    },
    raw_response_hash: sha256(rawValue),
  };
}

function normaliseRollingRows(rows, now) {
  const cutoff = new Date(now.getTime() - ROLLING_WINDOW_MS);
  const entries = new Map();
  for (const value of rows || []) {
    const row = typeof value === "string" ? { query_key: value } : (toObject(value) || {});
    const hashtag = normalizeHashtag(row.query_key || row.hashtag || row.name);
    if (!hashtag) continue;
    const summary = row.aggregate_summary || {};
    const hasExplicitWindow = Object.prototype.hasOwnProperty.call(row, "rolling_window_started_at")
      || Object.prototype.hasOwnProperty.call(summary, "rolling_window_started_at");
    if (hasExplicitWindow && !(row.rolling_window_started_at || summary.rolling_window_started_at)) continue;
    const windowStartedAt = safeDate(
      row.rolling_window_started_at
      || summary.rolling_window_started_at
      || row.provenance?.retrieved_at
      || now,
    );
    if (!windowStartedAt || windowStartedAt < cutoff || windowStartedAt > now) continue;
    const candidate = {
      hashtag,
      windowStartedAt,
      hashtagIdHash: trimValue(row.meta_hashtag_id_hash || summary.meta_hashtag_id_hash) || null,
    };
    const current = entries.get(hashtag);
    if (!current || candidate.windowStartedAt < current.windowStartedAt) entries.set(hashtag, candidate);
  }
  return { entries, names: [...entries.keys()] };
}

async function localRollingHashtags({ now, fingerprint, dependencies = {} }) {
  if (typeof dependencies.listRollingHashtagQueries === "function") {
    return normaliseRollingRows(await dependencies.listRollingHashtagQueries({ now, fingerprint }), now);
  }
  const Model = dependencies.SocialResearchObservation || SocialResearchObservation;
  const earliest = new Date(now.getTime() - ROLLING_WINDOW_MS);
  let query = Model.find({
    provider: "META",
    observation_type: "HASHTAG_SEARCH",
    status: { $in: ["COMPLETE", "PARTIAL"] },
    "provenance.connection_fingerprint": fingerprint,
    "provenance.retrieved_at": { $gte: earliest, $lte: now },
  });
  if (query && typeof query.select === "function") query = query.select("query_key aggregate_summary provenance.retrieved_at");
  if (query && typeof query.lean === "function") query = query.lean();
  const rows = await query;
  return normaliseRollingRows(rows, now);
}

async function persistUnavailableQueries({ watchlists, capability, code: suppliedCode = null, limitation: suppliedLimitation = null, now, fingerprint, dependencies }) {
  const limitation = suppliedLimitation || capability?.limitation || "The connected Instagram account does not provide this official Meta research capability.";
  const code = suppliedCode || (capability?.supported === false ? "PROVIDER_CAPABILITY_UNAVAILABLE" : "MISSING_PERMISSION");
  const documents = [];
  for (const hashtag of watchlists.hashtags) {
    const record = baseObservation({
      type: "HASHTAG_SEARCH",
      queryKey: hashtag,
      source: "Instagram Graph API Hashtag Search",
      status: code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE",
      now,
      fingerprint,
      rawValue: { code, hashtag },
      limitations: [limitation],
    });
    record.aggregate_summary = { error_code: code, error_message: limitation, provider_request_made: false };
    documents.push(await persistObservation(record, dependencies));
  }
  for (const username of watchlists.accounts) {
    const record = baseObservation({
      type: "BUSINESS_DISCOVERY",
      queryKey: username,
      source: "Instagram Graph API Business Discovery",
      status: code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE",
      now,
      fingerprint,
      rawValue: { code, username },
      limitations: [limitation],
    });
    record.aggregate_summary = { error_code: code, error_message: limitation, provider_request_made: false };
    documents.push(await persistObservation(record, dependencies));
  }
  return { documents, error: { code, message: limitation } };
}

async function observeHashtag({ hashtag, instagram, operationContext, now, fingerprint, mediaLimit, rollingWindowStartedAt = null, dependencies }) {
  const queryKey = normalizeHashtag(hashtag);
  const idempotencyKey = baseObservation({
    type: "HASHTAG_SEARCH", queryKey, source: "Instagram Graph API Hashtag Search", status: "COMPLETE", now, fingerprint, rawValue: queryKey,
  }).idempotency_key;
  const existing = await findExisting(dependencies.SocialResearchObservation || SocialResearchObservation, idempotencyKey);
  if (existing) return { document: existing, reused: true };
  let search;
  try {
    search = await instagram.searchHashtag({ ...operationContext, hashtag: queryKey });
    if (!search?.hashtagId) {
      throw new SocialMetaResearchError("Meta returned no hashtag identifier for the approved watchlist entry", {
        code: "HASHTAG_NOT_FOUND",
      });
    }
    const edges = await Promise.allSettled([
      instagram.getHashtagMedia({ ...operationContext, hashtagId: search.hashtagId, edge: "recent_media", limit: mediaLimit }),
      instagram.getHashtagMedia({ ...operationContext, hashtagId: search.hashtagId, edge: "top_media", limit: mediaLimit }),
    ]);
    const recent = edges[0].status === "fulfilled" ? edges[0].value?.media || [] : [];
    const top = edges[1].status === "fulfilled" ? edges[1].value?.media || [] : [];
    const edgeFailures = edges
      .filter((edge) => edge.status === "rejected")
      .map((edge) => operationError(edge.reason, "HASHTAG_MEDIA_FAILED"));
    const byId = new Map();
    for (const [collection, rows] of [["RECENT", recent], ["TOP", top]]) {
      for (const media of rows) {
        const id = trimValue(media.id);
        if (!id) continue;
        const known = byId.get(id) || { media, collections: [] };
        known.collections.push(collection);
        byId.set(id, known);
      }
    }
    const media = [...byId.values()].map((item) => item.media);
    const results = [...byId.values()].map(({ media: item, collections }) => resultForMedia(item, {
      resultType: collections.length > 1 ? "RECENT_AND_TOP" : `${collections[0]}_MEDIA`,
      topic: `#${queryKey}`,
      now,
    })).filter(Boolean);
    const limitations = [
      "Only public media returned by Meta is represented; availability, ordering and fields are platform-controlled.",
      "Captions were reduced to structural pattern counts in memory and are not stored or reproduced.",
      ...edges.filter((edge) => edge.status === "rejected").map((edge) => operationError(edge.reason).message),
    ];
    const record = baseObservation({
      type: "HASHTAG_SEARCH",
      queryKey,
      source: "Instagram Graph API Hashtag Search",
      status: edgeFailures.length ? "PARTIAL" : "COMPLETE",
      now,
      fingerprint,
      rawValue: { search, recent, top },
      limitations,
      attemptKey: edgeFailures.length ? now.toISOString() : null,
    });
    record.results = results;
    record.topic_clusters = [{
      label: `#${queryKey}`,
      concise_summary: "Approved hashtag conversation represented by a bounded official Meta public-media sample.",
      occurrence_count: results.length,
      confidence: results.length ? 0.8 : 0.4,
      result_keys: results.map((row) => row.result_key),
    }];
    record.common_formats = commonFormats(media);
    record.caption_patterns = captionPatterns(media);
    record.aggregate_summary = {
      hashtag: `#${queryKey}`,
      meta_hashtag_id_hash: sha256(search.hashtagId),
      provider_request_made: true,
      rolling_window_started_at: safeDate(rollingWindowStartedAt)?.toISOString() || null,
      recent_media_count: recent.length,
      top_media_count: top.length,
      ...summarizeIndicators(media),
      ranking_use_prohibited: true,
      provider_errors: publicErrors(edgeFailures),
    };
    record.provenance.source_urls = unique(results.map((row) => row.source_url).filter(Boolean));
    return {
      document: await persistObservation(record, dependencies),
      reused: false,
      errors: edgeFailures,
      ...(edgeFailures[0] ? { error: edgeFailures[0] } : {}),
    };
  } catch (error) {
    const failure = operationError(error, "HASHTAG_SEARCH_FAILED");
    const record = baseObservation({
      type: "HASHTAG_SEARCH",
      queryKey,
      source: "Instagram Graph API Hashtag Search",
      status: failure.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : failure.code === "PROVIDER_CAPABILITY_UNAVAILABLE" || failure.code === "MISSING_PERMISSION" ? "UNAVAILABLE" : "ERROR",
      now,
      fingerprint,
      rawValue: { failure, search: search ? { hashtag: search.hashtag, hashtagIdHash: search.hashtagId ? sha256(search.hashtagId) : null } : null },
      limitations: [failure.message],
      attemptKey: now.toISOString(),
    });
    record.aggregate_summary = {
      error_code: failure.code,
      error_message: failure.message,
      provider_status: failure.status,
      provider_request_made: Boolean(search?.hashtagId),
      rolling_window_started_at: search?.hashtagId ? (safeDate(rollingWindowStartedAt)?.toISOString() || null) : null,
      meta_hashtag_id_hash: search?.hashtagId ? sha256(search.hashtagId) : null,
    };
    return { document: await persistObservation(record, dependencies), reused: false, error: failure };
  }
}

async function observeBusiness({ username, instagram, operationContext, now, fingerprint, mediaLimit, dependencies }) {
  const queryKey = normalizeUsername(username);
  const idempotencyKey = baseObservation({
    type: "BUSINESS_DISCOVERY", queryKey, source: "Instagram Graph API Business Discovery", status: "COMPLETE", now, fingerprint, rawValue: queryKey,
  }).idempotency_key;
  const existing = await findExisting(dependencies.SocialResearchObservation || SocialResearchObservation, idempotencyKey);
  if (existing) return { document: existing, reused: true };
  try {
    const discovery = await instagram.getBusinessDiscovery({ ...operationContext, username: queryKey, mediaLimit });
    const account = discovery?.account || {};
    const media = (Array.isArray(account.media) ? account.media : []).filter((item) => trimValue(item?.id));
    const results = media.map((item) => resultForMedia(item, {
      resultType: "BUSINESS_MEDIA",
      topic: `@${queryKey} public pattern`,
      now,
    })).filter(Boolean);
    const resultKeys = results.map((row) => row.result_key);
    const timestamps = media.map((item) => safeDate(item.timestamp)).filter(Boolean).sort((left, right) => left - right);
    const spanDays = timestamps.length > 1 ? (timestamps[timestamps.length - 1] - timestamps[0]) / (24 * 60 * 60 * 1000) : null;
    const estimatedPostsPerWeek = spanDays && spanDays > 0 ? ((timestamps.length - 1) / spanDays) * 7 : null;
    const clusters = themeClusters(media, resultKeys);
    const observedLabels = new Set(clusters.map((cluster) => cluster.label));
    const whiteSpace = THEME_PATTERNS.map(([label]) => label).filter((label) => !observedLabels.has(label));
    const limitations = [
      "Business Discovery covers eligible public professional accounts only; private and consumer accounts are unavailable.",
      "Frequency, themes and public indicators describe only the bounded returned sample and do not rank accounts by follower count.",
      "Captions were reduced to controlled topic and structural pattern counts in memory and are not stored or reproduced.",
    ];
    const record = baseObservation({
      type: "BUSINESS_DISCOVERY",
      queryKey,
      source: "Instagram Graph API Business Discovery",
      status: "COMPLETE",
      now,
      fingerprint,
      rawValue: discovery,
      accountType: account.accountType || null,
      limitations,
    });
    record.results = results;
    record.topic_clusters = clusters.length ? clusters : [{
      label: media.length ? "NO_CONTROLLED_THEME_MATCH" : "NO_RECENT_PUBLIC_MEDIA",
      concise_summary: media.length
        ? "No controlled Pink Paisa theme classifier matched the bounded sample; source captions are not stored."
        : "Meta returned an eligible professional account but no recent public media in the bounded sample.",
      occurrence_count: media.length,
      confidence: media.length ? 0.5 : 0.8,
      result_keys: resultKeys,
    }];
    record.common_formats = commonFormats(media);
    record.caption_patterns = captionPatterns(media);
    record.aggregate_summary = {
      username: `@${queryKey}`,
      followers_count: boundedCount(account.followersCount),
      follows_count: boundedCount(account.followsCount),
      provider_media_count: boundedCount(account.mediaCount),
      observed_posts_per_week: estimatedPostsPerWeek,
      observed_span_days: spanDays,
      repeated_theme_labels: clusters.filter((cluster) => cluster.occurrence_count > 1).map((cluster) => cluster.label),
      directional_white_space_themes: whiteSpace,
      directional_under_served_questions: whiteSpace.map((label) => DIRECTIONAL_QUESTIONS[label]).filter(Boolean),
      ...summarizeIndicators(media),
      follower_count_ranking_prohibited: true,
    };
    record.provenance.source_urls = unique(results.map((row) => row.source_url).filter(Boolean));
    return { document: await persistObservation(record, dependencies), reused: false };
  } catch (error) {
    const failure = operationError(error, "BUSINESS_DISCOVERY_FAILED");
    const record = baseObservation({
      type: "BUSINESS_DISCOVERY",
      queryKey,
      source: "Instagram Graph API Business Discovery",
      status: failure.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : failure.code === "PROVIDER_CAPABILITY_UNAVAILABLE" || failure.code === "MISSING_PERMISSION" || failure.code === "BUSINESS_DISCOVERY_NOT_FOUND" ? "UNAVAILABLE" : "ERROR",
      now,
      fingerprint,
      rawValue: failure,
      limitations: [failure.message],
      attemptKey: now.toISOString(),
    });
    record.aggregate_summary = { error_code: failure.code, error_message: failure.message, provider_status: failure.status };
    return { document: await persistObservation(record, dependencies), reused: false, error: failure };
  }
}

async function refreshMetaResearchWatchlists({
  settings = {},
  instagramSummary = {},
  now = new Date(),
  mediaLimit = DEFAULT_MEDIA_LIMIT,
  dependencies = {},
} = {}) {
  const resolvedNow = new Date(now);
  if (!Number.isFinite(resolvedNow.getTime())) throw new SocialMetaResearchError("Meta research time is invalid", { code: "INVALID_REQUEST" });
  const watchlists = watchlistsFromSettings(settings);
  const context = capabilityContext(instagramSummary);
  const fingerprint = connectionFingerprint(instagramSummary);
  const requested = watchlists.hashtags.length + watchlists.accounts.length;
  if (!requested) {
    return {
      state: "NOT_CONFIGURED",
      checked_at: resolvedNow.toISOString(),
      message: "Add administrator-approved hashtag or professional-account watchlist entries before refreshing Meta research.",
      capabilities: context.matrix.capabilities,
      hashtags: { requested: 0, completed: 0, skipped: 0, rolling_limit: ROLLING_UNIQUE_HASHTAG_LIMIT },
      businesses: { requested: 0, completed: 0 },
      observations: [],
      errors: [],
    };
  }
  if (!context.accountId || instagramSummary?.is_connected === false) {
    const unavailable = await persistUnavailableQueries({
      watchlists,
      capability: null,
      code: "NOT_CONFIGURED",
      limitation: "Connect an eligible Instagram professional account before refreshing official Meta research.",
      now: resolvedNow,
      fingerprint,
      dependencies,
    });
    return {
      state: "NOT_CONFIGURED",
      checked_at: resolvedNow.toISOString(),
      message: unavailable.error.message,
      capabilities: context.matrix.capabilities,
      hashtags: { requested: watchlists.hashtags.length, completed: 0, skipped: watchlists.hashtags.length, rolling_limit: ROLLING_UNIQUE_HASHTAG_LIMIT, rolling_window_days: 7 },
      businesses: { requested: watchlists.accounts.length, completed: 0, skipped: watchlists.accounts.length },
      observations: unavailable.documents.map(publicObservation).filter(Boolean),
      errors: [unavailable.error],
    };
  }
  const hashtagCapability = context.matrix.capabilities?.hashtag_search;
  const businessCapability = context.matrix.capabilities?.business_discovery;
  const documents = [];
  const errors = [];
  if ((!hashtagCapability?.available && watchlists.hashtags.length) || (!businessCapability?.available && watchlists.accounts.length)) {
    const unavailableHashtags = hashtagCapability?.available ? [] : watchlists.hashtags;
    const unavailableAccounts = businessCapability?.available ? [] : watchlists.accounts;
    const unavailable = await persistUnavailableQueries({
      watchlists: { hashtags: unavailableHashtags, accounts: unavailableAccounts },
      capability: unavailableHashtags.length ? hashtagCapability : businessCapability,
      now: resolvedNow,
      fingerprint,
      dependencies,
    });
    documents.push(...unavailable.documents);
    errors.push(unavailable.error);
  }
  const instagram = dependencies.instagramGrowthService || require("../instagramGrowthService");
  const operationContext = { dependencies: dependencies.instagramDependencies || dependencies };
  let hashtagCompleted = 0;
  let hashtagSkipped = 0;
  if (hashtagCapability?.available && watchlists.hashtags.length) {
    const localRecent = await localRollingHashtags({ now: resolvedNow, fingerprint, dependencies });
    let providerRecentNames = [];
    let providerRecentCount = 0;
    let providerHistoryAvailable = false;
    const providerRecentIdHashes = new Set();
    try {
      const recent = await instagram.getRecentlySearchedHashtags({ ...operationContext, limit: ROLLING_UNIQUE_HASHTAG_LIMIT });
      providerHistoryAvailable = true;
      const providerRows = Array.isArray(recent?.hashtags) ? recent.hashtags.filter((item) => trimValue(item?.id)) : [];
      providerRecentCount = providerRows.length;
      providerRecentNames = providerRows.map((item) => normalizeHashtag(item.name)).filter(Boolean);
      providerRows.forEach((item) => providerRecentIdHashes.add(sha256(trimValue(item.id))));

      const unresolved = providerRows.filter((item) => !normalizeHashtag(item.name));
      if (unresolved.length && typeof instagram.getHashtag === "function") {
        const resolutions = await Promise.allSettled(unresolved.map((item) => instagram.getHashtag({
          ...operationContext,
          hashtagId: item.id,
        })));
        providerRecentNames.push(...resolutions
          .filter((result) => result.status === "fulfilled")
          .map((result) => normalizeHashtag(result.value?.hashtag?.name))
          .filter(Boolean));
        const rejected = resolutions.find((result) => result.status === "rejected");
        if (rejected) errors.push(operationError(rejected.reason, "RECENT_HASHTAG_NAME_RESOLUTION_PARTIAL"));
      }
    } catch (error) {
      errors.push(operationError(error, "RECENT_HASHTAG_HISTORY_UNAVAILABLE"));
    }
    for (const entry of localRecent.entries.values()) {
      if (entry.hashtagIdHash && providerRecentIdHashes.has(entry.hashtagIdHash)) providerRecentNames.push(entry.hashtag);
    }
    const used = new Set([...localRecent.names, ...providerRecentNames]);
    const localAdditionalCount = [...localRecent.entries.values()].filter((entry) => (
      !providerRecentNames.includes(entry.hashtag)
      && (!entry.hashtagIdHash || !providerRecentIdHashes.has(entry.hashtagIdHash))
    )).length;
    const providerReservedCount = providerHistoryAvailable
      ? Math.min(providerRecentCount + localAdditionalCount, ROLLING_UNIQUE_HASHTAG_LIMIT)
      : localRecent.entries.size;
    let remainingUnique = Math.max(ROLLING_UNIQUE_HASHTAG_LIMIT - providerReservedCount, 0);
    for (const hashtag of watchlists.hashtags) {
      const isPreviouslyCounted = used.has(hashtag);
      if (!isPreviouslyCounted && remainingUnique <= 0) {
        hashtagSkipped += 1;
        const limitation = `Meta permits at most ${ROLLING_UNIQUE_HASHTAG_LIMIT} unique hashtag queries for an Instagram professional account in a rolling seven-day window.`;
        const record = baseObservation({
          type: "HASHTAG_SEARCH",
          queryKey: hashtag,
          source: "Instagram Graph API Hashtag Search",
          status: "UNAVAILABLE",
          now: resolvedNow,
          fingerprint,
          rawValue: { code: "META_HASHTAG_ROLLING_LIMIT", hashtag },
          limitations: [limitation],
        });
        record.aggregate_summary = {
          error_code: "META_HASHTAG_ROLLING_LIMIT",
          error_message: limitation,
          provider_request_made: false,
          rolling_unique_hashtags_observed: Math.max(used.size, providerRecentCount),
        };
        documents.push(await persistObservation(record, dependencies));
        errors.push({ code: "META_HASHTAG_ROLLING_LIMIT", message: limitation });
        continue;
      }
      if (!isPreviouslyCounted) {
        used.add(hashtag);
        remainingUnique -= 1;
      }
      const outcome = await observeHashtag({
        hashtag,
        instagram,
        operationContext,
        now: resolvedNow,
        fingerprint,
        mediaLimit: Math.min(Math.max(Number(mediaLimit) || DEFAULT_MEDIA_LIMIT, 1), 50),
        rollingWindowStartedAt: localRecent.entries.get(hashtag)?.windowStartedAt || (!isPreviouslyCounted ? resolvedNow : null),
        dependencies,
      });
      documents.push(outcome.document);
      if (outcome.errors?.length) errors.push(...outcome.errors);
      else if (outcome.error) errors.push(outcome.error);
      else hashtagCompleted += 1;
    }
  }
  let businessCompleted = 0;
  if (businessCapability?.available && watchlists.accounts.length) {
    for (const username of watchlists.accounts) {
      const outcome = await observeBusiness({
        username,
        instagram,
        operationContext,
        now: resolvedNow,
        fingerprint,
        mediaLimit: Math.min(Math.max(Number(mediaLimit) || DEFAULT_MEDIA_LIMIT, 1), 50),
        dependencies,
      });
      documents.push(outcome.document);
      if (outcome.error) errors.push(outcome.error);
      else businessCompleted += 1;
    }
  }
  const hasUsableObservation = documents.some((document) => ["COMPLETE", "PARTIAL"].includes(String(document?.status || "").toUpperCase()));
  const state = errors.length ? (hasUsableObservation ? "PARTIAL" : "UNAVAILABLE") : "OK";
  return {
    state,
    checked_at: resolvedNow.toISOString(),
    message: state === "OK"
      ? "Approved Meta research watchlists were refreshed through official APIs."
      : "Meta research is limited by the connected login family, permissions, account eligibility, provider rolling quota, or a provider error.",
    capabilities: context.matrix.capabilities,
    hashtags: {
      requested: watchlists.hashtags.length,
      completed: hashtagCompleted,
      skipped: hashtagSkipped + (hashtagCapability?.available ? 0 : watchlists.hashtags.length),
      rolling_limit: ROLLING_UNIQUE_HASHTAG_LIMIT,
      rolling_window_days: 7,
    },
    businesses: {
      requested: watchlists.accounts.length,
      completed: businessCompleted,
      skipped: businessCapability?.available ? 0 : watchlists.accounts.length,
    },
    observations: documents.map(publicObservation).filter(Boolean),
    errors: publicErrors(errors),
  };
}

async function listRecentObservations({ now, days, limit, dependencies }) {
  if (typeof dependencies.listMetaResearchObservations === "function") {
    return dependencies.listMetaResearchObservations({ now, days, limit });
  }
  const Model = dependencies.SocialResearchObservation || SocialResearchObservation;
  const earliest = isoDate(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  let query = Model.find({ provider: "META", observation_date: { $gte: earliest } });
  if (query && typeof query.sort === "function") query = query.sort({ created_at: -1, observation_date: -1 });
  if (query && typeof query.limit === "function") query = query.limit(limit);
  if (query && typeof query.lean === "function") query = query.lean();
  return (await query) || [];
}

function conciseObservation(row) {
  const summary = row.aggregate_summary || {};
  if (row.observation_type === "HASHTAG_SEARCH") {
    if (!["COMPLETE", "PARTIAL"].includes(row.status)) return `#${row.query_key}: ${summary.error_message || row.status.toLowerCase().replace(/_/g, " ")}.`;
    const formats = (row.common_formats || []).slice(0, 3).map((entry) => `${entry.format} ${entry.occurrence_count}`).join(", ");
    return `#${row.query_key}: ${Number(summary.observed_media_count || row.results?.length || 0)} public posts observed${formats ? `; format sample ${formats}` : ""}.`;
  }
  if (!["COMPLETE", "PARTIAL"].includes(row.status)) return `@${row.query_key}: ${summary.error_message || row.status.toLowerCase().replace(/_/g, " ")}.`;
  const cadence = Number.isFinite(Number(summary.observed_posts_per_week))
    ? `; observed cadence about ${Number(summary.observed_posts_per_week).toFixed(1)} posts/week`
    : "";
  return `@${row.query_key}: ${Number(summary.observed_media_count || row.results?.length || 0)} recent public posts observed${cadence}.`;
}

async function getMetaResearchDesk({ now = new Date(), days = 7, limit = 200, settings = null, dependencies = {} } = {}) {
  const resolvedNow = new Date(now);
  const rows = await listRecentObservations({
    now: resolvedNow,
    days: Math.min(Math.max(Number(days) || 7, 1), 30),
    limit: Math.min(Math.max(Number(limit) || 200, 1), 500),
    dependencies,
  });
  const latestByKey = new Map();
  for (const value of rows) {
    const row = toObject(value);
    if (row && !latestByKey.has(row.observation_key)) latestByKey.set(row.observation_key, row);
  }
  let observations = [...latestByKey.values()];
  if (settings) {
    const approved = watchlistsFromSettings(settings);
    const approvedHashtags = new Set(approved.hashtags);
    const approvedAccounts = new Set(approved.accounts);
    observations = observations.filter((row) => (
      (row.observation_type === "HASHTAG_SEARCH" && approvedHashtags.has(normalizeHashtag(row.query_key)))
      || (row.observation_type === "BUSINESS_DISCOVERY" && approvedAccounts.has(normalizeUsername(row.query_key)))
    ));
  }
  const sources = [];
  const seenUrls = new Set();
  for (const row of observations) {
    for (const result of row.results || []) {
      const url = safeInstagramPermalink(result.source_url);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      sources.push({
        title: `${row.observation_type === "HASHTAG_SEARCH" ? `#${row.query_key}` : `@${row.query_key}`} public-media pattern`,
        url,
        publisher: "Instagram",
        published_at: result.published_at || null,
        accessed_at: row.provenance?.retrieved_at || row.created_at || null,
        claim_supported: result.observation_summary,
        confidence: ["COMPLETE", "PARTIAL"].includes(row.status) ? 0.7 : 0.3,
        freshness: result.date_relevance || "UNKNOWN",
      });
      if (sources.length >= 50) break;
    }
    if (sources.length >= 50) break;
  }
  const retrievedTimes = observations
    .map((row) => safeDate(row.provenance?.retrieved_at || row.created_at))
    .filter(Boolean)
    .sort((left, right) => right - left);
  const errors = publicErrors(observations.flatMap((row) => {
    const summary = row.aggregate_summary || {};
    if (Array.isArray(summary.provider_errors) && summary.provider_errors.length) return summary.provider_errors;
    if (["ERROR", "UNAVAILABLE", "NOT_CONFIGURED"].includes(row.status)) {
      return [{
        code: summary.error_code || row.status,
        message: summary.error_message || row.provenance?.evidence_limitations?.[0] || `Meta research is ${String(row.status).toLowerCase()}.`,
        status: summary.provider_status || null,
      }];
    }
    return [];
  }));
  const hasUsableObservations = observations.some((row) => ["COMPLETE", "PARTIAL"].includes(row.status));
  const status = observations.length
    ? (errors.length ? (hasUsableObservations ? "PARTIAL" : "UNAVAILABLE") : "READY")
    : "NOT_GENERATED";
  return {
    status,
    state: status,
    summary: observations.length
      ? "Official Meta watchlist observations are stored as bounded patterns and aggregate public indicators; captions and creative assets are not copied."
      : "No official Meta watchlist observations have been collected yet.",
    hashtag_observations: observations.filter((row) => row.observation_type === "HASHTAG_SEARCH").map(conciseObservation),
    competitor_observations: observations.filter((row) => row.observation_type === "BUSINESS_DISCOVERY").map(conciseObservation),
    planning_signals: observations
      .filter((row) => ["COMPLETE", "PARTIAL"].includes(row.status))
      .map((row) => ({
        observation_type: row.observation_type,
        query_key: row.query_key,
        summary: conciseObservation(row),
      })),
    sources,
    observations: observations.map(publicObservation).filter(Boolean),
    errors,
    generated_at: retrievedTimes[0]?.toISOString() || null,
  };
}

module.exports = {
  ROLLING_UNIQUE_HASHTAG_LIMIT,
  ROLLING_WINDOW_MS,
  SocialMetaResearchError,
  getMetaResearchDesk,
  refreshMetaResearchWatchlists,
  _private: {
    captionPatterns,
    commonFormats,
    connectionFingerprint,
    dateRelevance,
    mediaFormat,
    normalizeHashtag,
    normalizeUsername,
    operationError,
    publicErrors,
    publicObservation,
    resultForMedia,
    safeInstagramPermalink,
    summarizeIndicators,
    themeClusters,
    watchlistsFromSettings,
  },
};
