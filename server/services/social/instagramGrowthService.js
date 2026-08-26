const crypto = require("node:crypto");
const axios = require("axios");
const {
  INSTAGRAM_LOGIN_PROFILES,
  getInstagramCapabilityMatrix,
  _private: { redactText, withDeadline },
} = require("./socialGrowthConnectors");

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_TIMEOUT_MS = 30000;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_COMMENT_LENGTH = 2200;
const MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_INSIGHT_METRICS = new Set([
  "reach",
  "profile_views",
  "follower_count",
  "website_clicks",
  "online_followers",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "saved",
  "replies",
  "follows_and_unfollows",
  "profile_links_taps",
  "views",
]);

const COMMENT_FIELDS = new Set([
  "id",
  "from",
  "text",
  "timestamp",
  "username",
  "like_count",
  "hidden",
  "media",
  "parent_id",
  "replies",
]);

const MEDIA_FIELDS = new Set([
  "id",
  "caption",
  "comments_count",
  "like_count",
  "media_product_type",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "username",
]);

const HASHTAG_FIELDS = new Set(["id", "name"]);
const RESEARCH_MEDIA_FIELDS = new Set([
  "id",
  "caption",
  "comments_count",
  "like_count",
  "media_type",
  "permalink",
  "timestamp",
]);

class InstagramGrowthError extends Error {
  constructor(message, { code = "INSTAGRAM_GROWTH_ERROR", status = null, operation = null } = {}) {
    super(message);
    this.name = "InstagramGrowthError";
    this.code = code;
    this.status = status;
    this.operation = operation;
  }
}

function trimValue(value) {
  return String(value == null ? "" : value).trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(trimValue).filter(Boolean))];
  return [...new Set(trimValue(value).split(/[\s,]+/).map(trimValue).filter(Boolean))];
}

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizeSettings(settings = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const source = settings.instagram || settings;
  const provider = trimValue(firstValue(source.provider, source.loginType, env.INSTAGRAM_LOGIN_TYPE, "instagram_login")).toLowerCase();
  const profile = INSTAGRAM_LOGIN_PROFILES[provider];
  const defaultBaseUrl = profile ? `https://${profile.graphHost}` : "";
  const apiVersion = trimValue(firstValue(source.apiVersion, env.INSTAGRAM_GRAPH_API_VERSION, "v24.0"));
  if (!/^v\d{1,2}\.\d{1,2}$/.test(apiVersion)) {
    throw new InstagramGrowthError("Instagram Graph API version is invalid", { code: "INVALID_CONFIGURATION" });
  }
  const baseUrl = trimValue(firstValue(source.baseUrl, defaultBaseUrl)).replace(/\/+$/, "");
  assertOfficialGraphBase(baseUrl, provider);
  return {
    provider,
    profile,
    baseUrl,
    apiVersion,
    timeoutMs: Math.floor(clampNumber(firstValue(source.timeoutMs, env.INSTAGRAM_GROWTH_TIMEOUT_MS), 250, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    accountId: trimValue(firstValue(source.accountId, source.instagramUserId, env.INSTAGRAM_USER_ID)),
    accountType: trimValue(firstValue(source.accountType, env.INSTAGRAM_ACCOUNT_TYPE)).toUpperCase(),
    pageId: trimValue(firstValue(source.pageId, source.facebookPageId, env.INSTAGRAM_FACEBOOK_PAGE_ID)),
    accessToken: trimValue(firstValue(source.accessToken, source.pageAccessToken, env.INSTAGRAM_ACCESS_TOKEN)),
    scopes: parseList(firstValue(source.scopes, source.grantedScopes, env.INSTAGRAM_REQUIRED_SCOPES)),
    appSecret: trimValue(firstValue(source.appSecret, env.INSTAGRAM_APP_SECRET)),
    productTaggingApproved: source.productTaggingApproved === true,
    allowedInsightMetrics: new Set(parseList(firstValue(source.allowedInsightMetrics, [...DEFAULT_INSIGHT_METRICS]))),
  };
}

function assertOfficialGraphBase(baseUrl, provider) {
  let parsed;
  try { parsed = new URL(baseUrl); } catch (_error) {
    throw new InstagramGrowthError("Instagram Graph base URL is invalid", { code: "INVALID_CONFIGURATION" });
  }
  const expectedHost = INSTAGRAM_LOGIN_PROFILES[provider]?.graphHost;
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) {
    throw new InstagramGrowthError("Instagram Graph base URL must match the selected official Meta host", { code: "INVALID_CONFIGURATION" });
  }
}

function assertGraphId(value, label) {
  const id = trimValue(value);
  if (!/^[0-9_]{1,160}$/.test(id)) {
    throw new InstagramGrowthError(`${label} is invalid`, { code: "INVALID_REQUEST" });
  }
  return id;
}

function assertCursor(value) {
  const cursor = trimValue(value);
  if (cursor && !/^[A-Za-z0-9._~-]{1,1000}$/.test(cursor)) {
    throw new InstagramGrowthError("Instagram paging cursor is invalid", { code: "INVALID_REQUEST" });
  }
  return cursor;
}

function assertText(value, label, maximum) {
  const text = trimValue(value);
  if (!text || text.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new InstagramGrowthError(`${label} is invalid`, { code: "INVALID_REQUEST" });
  }
  return text;
}

function assertFields(values, allowed, fallback) {
  const fields = parseList(values?.length ? values : fallback);
  if (!fields.length || fields.length > 20 || fields.some((field) => !allowed.has(field))) {
    throw new InstagramGrowthError("Instagram fields contain an unsupported value", { code: "INVALID_REQUEST" });
  }
  return fields;
}

function assertHashtag(value) {
  const hashtag = trimValue(value).replace(/^#+/, "").normalize("NFKC").toLowerCase();
  if (!/^[\p{L}\p{N}_]{1,100}$/u.test(hashtag)) {
    throw new InstagramGrowthError("Instagram hashtag is invalid", {
      code: "INVALID_REQUEST",
      operation: "hashtag_search",
    });
  }
  return hashtag;
}

function assertProfessionalUsername(value) {
  const username = trimValue(value).replace(/^@+/, "").toLowerCase();
  if (!/^(?=.{1,30}$)(?!.*\.\.)[a-z0-9_](?:[a-z0-9_.]*[a-z0-9_])?$/.test(username)) {
    throw new InstagramGrowthError("Instagram professional-account username is invalid", {
      code: "INVALID_REQUEST",
      operation: "business_discovery",
    });
  }
  return username;
}

function toInstagramError(error, { operation, token } = {}) {
  if (error instanceof InstagramGrowthError) return error;
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const graphError = error?.response?.data?.error;
  const raw = graphError?.message || error?.response?.data?.message || error?.message || "Instagram Graph request failed";
  return new InstagramGrowthError(redactText(raw, [token]).slice(0, 500), {
    code: graphError?.code ? `META_${graphError.code}` : "INSTAGRAM_GRAPH_REQUEST_FAILED",
    status,
    operation,
  });
}

function capabilityFor(config, name) {
  const matrix = getInstagramCapabilityMatrix({
    provider: config.provider,
    accountType: config.accountType,
    pageId: config.pageId,
    scopes: config.scopes,
    productTaggingApproved: config.productTaggingApproved,
  });
  return { matrix, capability: matrix.capabilities?.[name] };
}

function assertOperationConfigured(config, capabilityName, operation, {
  allowProviderAuthorizationProbe = false,
} = {}) {
  if (!config.profile || !config.accountId) {
    throw new InstagramGrowthError("Instagram growth connector is not configured", {
      code: "NOT_CONFIGURED",
      operation,
    });
  }
  const { matrix, capability } = capabilityFor(config, capabilityName);
  if (!capability?.supported) {
    throw new InstagramGrowthError(capability?.limitation || `${operation} is unsupported for this login provider`, {
      code: "PROVIDER_CAPABILITY_UNAVAILABLE",
      operation,
    });
  }
  if (!matrix.accountRequirementsMet) {
    throw new InstagramGrowthError("Instagram account requirements are not met", {
      code: "ACCOUNT_NOT_ELIGIBLE",
      operation,
    });
  }
  if (!capability.available && !allowProviderAuthorizationProbe) {
    throw new InstagramGrowthError(`Instagram permissions are insufficient for ${operation}`, {
      code: "MISSING_PERMISSION",
      operation,
    });
  }
}

async function resolveAccessToken(config, dependencies, operation) {
  if (config.accessToken) return config.accessToken;
  if (typeof dependencies.getAccessToken !== "function") {
    throw new InstagramGrowthError("Instagram access token is not configured", { code: "NOT_CONFIGURED", operation });
  }
  const result = await withDeadline(
    () => dependencies.getAccessToken({ provider: config.provider, operation }),
    config.timeoutMs,
    "Instagram credential resolution"
  );
  const token = trimValue(result?.accessToken || result?.access_token || result?.page_access_token || result);
  if (!token) throw new InstagramGrowthError("Instagram credential provider returned no access token", {
    code: "NOT_CONFIGURED",
    operation,
  });
  return token;
}

async function graphRequest(config, dependencies, {
  operation,
  capabilityName,
  allowProviderAuthorizationProbe = false,
  method = "GET",
  path,
  params,
  data,
  headers = {},
}) {
  assertOperationConfigured(config, capabilityName, operation, { allowProviderAuthorizationProbe });
  const token = await resolveAccessToken(config, dependencies, operation);
  const client = dependencies.httpClient || axios;
  if (!client || typeof client.request !== "function") {
    throw new InstagramGrowthError("HTTP client is unavailable", { code: "HTTP_CLIENT_UNAVAILABLE", operation });
  }
  try {
    const requestParams = { ...(params || {}) };
    if (config.appSecret) {
      requestParams.appsecret_proof = crypto
        .createHmac("sha256", config.appSecret)
        .update(token)
        .digest("hex");
    }
    const response = await withDeadline(() => client.request({
      method,
      url: `${config.baseUrl}/${config.apiVersion}${path}`,
      params: requestParams,
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      timeout: config.timeoutMs,
      maxContentLength: 4 * 1024 * 1024,
      maxBodyLength: 512 * 1024,
      maxRedirects: 0,
    }), config.timeoutMs, `Instagram ${operation}`);
    return response?.data || {};
  } catch (error) {
    throw toInstagramError(error, { operation, token });
  }
}

function normalizePaging(paging = {}) {
  return {
    before: trimValue(paging?.cursors?.before) || null,
    after: trimValue(paging?.cursors?.after) || null,
    hasNext: Boolean(paging?.next),
    hasPrevious: Boolean(paging?.previous),
  };
}

function sanitizeComment(comment = {}) {
  return {
    id: trimValue(comment.id) || null,
    text: trimValue(comment.text).slice(0, MAX_COMMENT_LENGTH),
    timestamp: trimValue(comment.timestamp) || null,
    username: trimValue(comment.username).slice(0, 100) || null,
    from: comment.from && typeof comment.from === "object" ? {
      id: trimValue(comment.from.id) || null,
      username: trimValue(comment.from.username).slice(0, 100) || null,
    } : null,
    likeCount: Number.isFinite(Number(comment.like_count)) ? Number(comment.like_count) : null,
    hidden: typeof comment.hidden === "boolean" ? comment.hidden : null,
    parentId: trimValue(comment.parent_id) || null,
    replies: Array.isArray(comment.replies?.data)
      ? comment.replies.data.slice(0, 50).map(sanitizeComment)
      : [],
  };
}

function sanitizeMedia(media = {}) {
  return {
    id: trimValue(media.id) || null,
    caption: trimValue(media.caption).slice(0, 2200),
    mediaType: trimValue(media.media_type) || null,
    mediaProductType: trimValue(media.media_product_type) || null,
    mediaUrl: trimValue(media.media_url) || null,
    thumbnailUrl: trimValue(media.thumbnail_url) || null,
    permalink: trimValue(media.permalink) || null,
    timestamp: trimValue(media.timestamp) || null,
    username: trimValue(media.username).slice(0, 100) || null,
    commentsCount: Number.isFinite(Number(media.comments_count)) ? Number(media.comments_count) : null,
    likeCount: Number.isFinite(Number(media.like_count)) ? Number(media.like_count) : null,
  };
}

function sanitizeHashtag(hashtag = {}) {
  return {
    id: trimValue(hashtag.id) || null,
    name: trimValue(hashtag.name).replace(/^#+/, "").normalize("NFKC").toLowerCase() || null,
  };
}

function sanitizeBusinessDiscovery(value = {}) {
  const media = Array.isArray(value?.media?.data) ? value.media.data : [];
  return {
    id: trimValue(value.id) || null,
    username: trimValue(value.username).toLowerCase() || null,
    accountType: trimValue(value.account_type).toUpperCase() || null,
    followersCount: Number.isFinite(Number(value.followers_count)) ? Number(value.followers_count) : null,
    followsCount: Number.isFinite(Number(value.follows_count)) ? Number(value.follows_count) : null,
    mediaCount: Number.isFinite(Number(value.media_count)) ? Number(value.media_count) : null,
    media: media.map(sanitizeMedia),
    paging: normalizePaging(value?.media?.paging),
  };
}

function normalizeInsight(insight = {}) {
  return {
    id: trimValue(insight.id) || null,
    name: trimValue(insight.name) || null,
    period: trimValue(insight.period) || null,
    title: trimValue(insight.title).slice(0, 200) || null,
    description: trimValue(insight.description).slice(0, 500) || null,
    values: Array.isArray(insight.values)
      ? insight.values.slice(0, 400).map((entry) => ({
        value: typeof entry?.value === "number" ? entry.value : entry?.value ?? null,
        endTime: trimValue(entry?.end_time) || null,
      }))
      : [],
    totalValue: insight.total_value?.value ?? null,
  };
}

function normalizeTimeParameter(value, label) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) return Math.floor(Number(value));
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new InstagramGrowthError(`${label} is invalid`, { code: "INVALID_REQUEST" });
  return Math.floor(timestamp / 1000);
}

function createInstagramGrowthService({ settings = {}, dependencies = {} } = {}) {
  const config = normalizeSettings(settings, dependencies);
  const now = () => new Date((dependencies.now || (() => new Date()))());

  async function requestInsights({
    objectId = config.accountId,
    metrics = ["reach", "profile_views"],
    period = "day",
    since = null,
    until = null,
    metricType = null,
  } = {}, { allowProviderAuthorizationProbe = false } = {}) {
    const id = assertGraphId(objectId, "Instagram insight object ID");
    const metricNames = parseList(metrics);
    if (!metricNames.length || metricNames.length > 20 || metricNames.some((metric) => !config.allowedInsightMetrics.has(metric))) {
      throw new InstagramGrowthError("Instagram insight metrics contain an unsupported value", { code: "INVALID_REQUEST", operation: "insights" });
    }
    const params = { metric: metricNames.join(",") };
    if (period !== null && period !== "") {
      const normalizedPeriod = trimValue(period);
      if (!new Set(["day", "week", "days_28", "month", "lifetime", "total_over_range"]).has(normalizedPeriod)) {
        throw new InstagramGrowthError("Instagram insight period is invalid", { code: "INVALID_REQUEST", operation: "insights" });
      }
      params.period = normalizedPeriod;
    }
    const normalizedSince = normalizeTimeParameter(since, "Instagram insight since");
    const normalizedUntil = normalizeTimeParameter(until, "Instagram insight until");
    if (normalizedSince != null) params.since = normalizedSince;
    if (normalizedUntil != null) params.until = normalizedUntil;
    if (metricType) params.metric_type = assertText(metricType, "Instagram metric type", 80);
    const response = await graphRequest(config, dependencies, {
      operation: "insights",
      capabilityName: "insights",
      allowProviderAuthorizationProbe,
      path: `/${encodeURIComponent(id)}/insights`,
      params,
    });
    return {
      source: "instagram_graph_api",
      objectId: id,
      data: (response.data || []).map(normalizeInsight),
      paging: normalizePaging(response.paging),
    };
  }

  async function getInsights(options = {}) {
    return requestInsights(options);
  }

  // Instagram Login does not consistently expose a token-permissions edge.
  // A health probe therefore skips only the local scope-list preflight and lets
  // Meta authorize this read-only request. Provider rejection still fails closed.
  async function probeInsightsAccess(options = {}) {
    return requestInsights(options, { allowProviderAuthorizationProbe: true });
  }

  async function listComments({
    mediaId,
    fields,
    limit = 50,
    after = null,
  } = {}) {
    const id = assertGraphId(mediaId, "Instagram media ID");
    const selectedFields = assertFields(fields, COMMENT_FIELDS, ["id", "from", "text", "timestamp", "username", "like_count", "hidden", "replies"]);
    const params = { fields: selectedFields.join(","), limit: Math.floor(clampNumber(limit, 1, 100, 50)) };
    const cursor = assertCursor(after);
    if (cursor) params.after = cursor;
    const response = await graphRequest(config, dependencies, {
      operation: "list_comments",
      capabilityName: "comments",
      path: `/${encodeURIComponent(id)}/comments`,
      params,
    });
    return {
      source: "instagram_graph_api",
      mediaId: id,
      comments: (response.data || []).map(sanitizeComment),
      paging: normalizePaging(response.paging),
    };
  }

  async function replyToComment({ commentId, message } = {}) {
    const id = assertGraphId(commentId, "Instagram comment ID");
    const text = assertText(message, "Instagram comment reply", MAX_COMMENT_LENGTH);
    const response = await graphRequest(config, dependencies, {
      operation: "reply_to_comment",
      capabilityName: "comments",
      method: "POST",
      path: `/${encodeURIComponent(id)}/replies`,
      data: { message: text },
    });
    const replyId = trimValue(response.id) || null;
    return { id: replyId, commentId: id, replyId };
  }

  async function setCommentHidden({ commentId, hidden } = {}) {
    if (typeof hidden !== "boolean") throw new InstagramGrowthError("Instagram hidden state must be boolean", { code: "INVALID_REQUEST", operation: "moderate_comment" });
    const id = assertGraphId(commentId, "Instagram comment ID");
    const response = await graphRequest(config, dependencies, {
      operation: hidden ? "hide_comment" : "unhide_comment",
      capabilityName: "comments",
      method: "POST",
      path: `/${encodeURIComponent(id)}`,
      data: { hide: hidden },
    });
    return { commentId: id, hidden, acknowledged: response.success === true };
  }

  async function deleteComment({ commentId } = {}) {
    const id = assertGraphId(commentId, "Instagram comment ID");
    const response = await graphRequest(config, dependencies, {
      operation: "delete_comment",
      capabilityName: "comments",
      method: "DELETE",
      path: `/${encodeURIComponent(id)}`,
    });
    return { commentId: id, deleted: response.success === true };
  }

  async function getMentions({ mediaId, fields } = {}) {
    const id = assertGraphId(mediaId, "Mentioned Instagram media ID");
    const selectedFields = assertFields(fields, MEDIA_FIELDS, ["id", "caption", "media_type", "permalink", "timestamp", "username"]);
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const response = await graphRequest(config, dependencies, {
      operation: "get_mentions",
      capabilityName: "mentions",
      path: `/${encodeURIComponent(accountId)}`,
      params: { fields: `mentioned_media.media_id(${id}){${selectedFields.join(",")}}` },
    });
    const mentioned = response.mentioned_media?.data || response.mentioned_media || response.data || [];
    return {
      source: "instagram_graph_api",
      mediaId: id,
      media: (Array.isArray(mentioned) ? mentioned : [mentioned]).filter(Boolean).map(sanitizeMedia),
    };
  }

  async function getTaggedMedia({ fields, limit = 50, after = null } = {}) {
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const selectedFields = assertFields(fields, MEDIA_FIELDS, ["id", "caption", "media_type", "permalink", "timestamp", "username"]);
    const params = { fields: selectedFields.join(","), limit: Math.floor(clampNumber(limit, 1, 100, 50)) };
    const cursor = assertCursor(after);
    if (cursor) params.after = cursor;
    const response = await graphRequest(config, dependencies, {
      operation: "get_tagged_media",
      capabilityName: "tagged_media",
      path: `/${encodeURIComponent(accountId)}/tags`,
      params,
    });
    return {
      source: "instagram_graph_api",
      media: (response.data || []).map(sanitizeMedia),
      paging: normalizePaging(response.paging),
    };
  }

  async function getRecentlySearchedHashtags({ limit = 30, after = null } = {}) {
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const params = {
      limit: Math.floor(clampNumber(limit, 1, 30, 30)),
    };
    const cursor = assertCursor(after);
    if (cursor) params.after = cursor;
    const response = await graphRequest(config, dependencies, {
      operation: "recently_searched_hashtags",
      capabilityName: "hashtag_search",
      path: `/${encodeURIComponent(accountId)}/recently_searched_hashtags`,
      params,
    });
    return {
      source: "instagram_graph_api",
      hashtags: (response.data || []).map(sanitizeHashtag).filter((item) => item.id),
      paging: normalizePaging(response.paging),
    };
  }

  async function getHashtag({ hashtagId, fields } = {}) {
    const id = assertGraphId(hashtagId, "Instagram hashtag ID");
    const selectedFields = assertFields(fields, HASHTAG_FIELDS, ["id", "name"]);
    const response = await graphRequest(config, dependencies, {
      operation: "get_hashtag",
      capabilityName: "hashtag_search",
      path: `/${encodeURIComponent(id)}`,
      params: { fields: selectedFields.join(",") },
    });
    return {
      source: "instagram_graph_api",
      hashtag: sanitizeHashtag(response),
    };
  }

  async function searchHashtag({ hashtag } = {}) {
    const normalizedHashtag = assertHashtag(hashtag);
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const response = await graphRequest(config, dependencies, {
      operation: "hashtag_search",
      capabilityName: "hashtag_search",
      path: "/ig_hashtag_search",
      params: { user_id: accountId, q: normalizedHashtag },
    });
    const matches = (Array.isArray(response.data) ? response.data : [])
      .map(sanitizeHashtag)
      .filter((item) => item.id);
    return {
      source: "instagram_graph_api",
      hashtag: normalizedHashtag,
      matches,
      hashtagId: matches[0]?.id || null,
    };
  }

  async function getHashtagMedia({ hashtagId, edge = "recent_media", fields, limit = 25, after = null } = {}) {
    const id = assertGraphId(hashtagId, "Instagram hashtag ID");
    const normalizedEdge = trimValue(edge).toLowerCase();
    if (!["recent_media", "top_media"].includes(normalizedEdge)) {
      throw new InstagramGrowthError("Instagram hashtag-media edge is invalid", {
        code: "INVALID_REQUEST",
        operation: "hashtag_media",
      });
    }
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const selectedFields = assertFields(fields, RESEARCH_MEDIA_FIELDS, [
      "id", "caption", "comments_count", "like_count", "media_type", "permalink", "timestamp",
    ]);
    const params = {
      user_id: accountId,
      fields: selectedFields.join(","),
      limit: Math.floor(clampNumber(limit, 1, 50, 25)),
    };
    const cursor = assertCursor(after);
    if (cursor) params.after = cursor;
    const response = await graphRequest(config, dependencies, {
      operation: `hashtag_${normalizedEdge}`,
      capabilityName: "hashtag_search",
      path: `/${encodeURIComponent(id)}/${normalizedEdge}`,
      params,
    });
    return {
      source: "instagram_graph_api",
      hashtagId: id,
      edge: normalizedEdge,
      media: (response.data || []).map(sanitizeMedia),
      paging: normalizePaging(response.paging),
    };
  }

  async function getBusinessDiscovery({ username, mediaLimit = 25 } = {}) {
    const targetUsername = assertProfessionalUsername(username);
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const boundedMediaLimit = Math.floor(clampNumber(mediaLimit, 1, 50, 25));
    const mediaFields = [
      "id", "caption", "comments_count", "like_count", "media_product_type", "media_type", "permalink", "timestamp",
    ].join(",");
    const fields = [
      "id",
      "followers_count",
      "follows_count",
      "media_count",
      "username",
      `media.limit(${boundedMediaLimit}){${mediaFields}}`,
    ].join(",");
    const response = await graphRequest(config, dependencies, {
      operation: "business_discovery",
      capabilityName: "business_discovery",
      path: `/${encodeURIComponent(accountId)}`,
      params: { fields: `business_discovery.username(${targetUsername}){${fields}}` },
    });
    const discovered = response.business_discovery;
    if (!discovered || typeof discovered !== "object") {
      throw new InstagramGrowthError("Meta returned no eligible professional account for Business Discovery", {
        code: "BUSINESS_DISCOVERY_NOT_FOUND",
        operation: "business_discovery",
      });
    }
    return {
      source: "instagram_graph_api",
      requestedUsername: targetUsername,
      account: sanitizeBusinessDiscovery(discovered),
    };
  }

  function assertMessagingPermissionContext(context = {}) {
    if (context.conversationInitiatedByRecipient !== true) {
      throw new InstagramGrowthError("Instagram messages require a recipient-initiated conversation", {
        code: "MESSAGING_POLICY_BLOCKED",
        operation: "send_message",
      });
    }
    const initiatedAt = new Date(context.recipientInitiatedAt || context.userInitiatedAt || 0);
    const age = now().getTime() - initiatedAt.getTime();
    if (!Number.isFinite(initiatedAt.getTime()) || age < -5 * 60 * 1000 || age > MESSAGE_WINDOW_MS) {
      throw new InstagramGrowthError("Instagram messaging window is not valid", {
        code: "MESSAGING_WINDOW_EXPIRED",
        operation: "send_message",
      });
    }
  }

  async function sendPermittedMessage({ recipientId, message, permissionContext = {} } = {}) {
    assertMessagingPermissionContext(permissionContext);
    const recipient = assertGraphId(recipientId, "Instagram-scoped recipient ID");
    const text = assertText(message, "Instagram message", MAX_MESSAGE_LENGTH);
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const response = await graphRequest(config, dependencies, {
      operation: "send_message",
      capabilityName: "messages",
      method: "POST",
      path: `/${encodeURIComponent(accountId)}/messages`,
      data: { recipient: { id: recipient }, message: { text } },
    });
    const resolvedRecipientId = trimValue(response.recipient_id || recipient);
    const messageId = trimValue(response.message_id) || null;
    return {
      recipient_id: resolvedRecipientId,
      message_id: messageId,
      recipientId: resolvedRecipientId,
      messageId,
    };
  }

  function assertPrivateReplyContext(context = {}) {
    const createdAt = new Date(context.commentCreatedAt || 0);
    const age = now().getTime() - createdAt.getTime();
    if (!Number.isFinite(createdAt.getTime()) || age < -5 * 60 * 1000 || age > PRIVATE_REPLY_WINDOW_MS) {
      throw new InstagramGrowthError("Instagram private-reply window is not valid", {
        code: "PRIVATE_REPLY_WINDOW_EXPIRED",
        operation: "private_reply",
      });
    }
    if (context.isLive === true && context.liveActive !== true) {
      throw new InstagramGrowthError("Instagram Live private replies are allowed only during the active broadcast", {
        code: "PRIVATE_REPLY_WINDOW_EXPIRED",
        operation: "private_reply",
      });
    }
  }

  async function sendPrivateReply({ commentId, message, permissionContext = {} } = {}) {
    assertPrivateReplyContext(permissionContext);
    const comment = assertGraphId(commentId, "Instagram comment ID");
    const text = assertText(message, "Instagram private reply", MAX_MESSAGE_LENGTH);
    if (typeof dependencies.hasPrivateReplyBeenSent === "function") {
      const alreadySent = await withDeadline(
        () => dependencies.hasPrivateReplyBeenSent({ commentId: comment }),
        config.timeoutMs,
        "Instagram private-reply idempotency check"
      );
      if (alreadySent) throw new InstagramGrowthError("An initial private reply has already been sent for this comment", {
        code: "PRIVATE_REPLY_ALREADY_SENT",
        operation: "private_reply",
      });
    }
    const accountId = assertGraphId(config.accountId, "Instagram account ID");
    const response = await graphRequest(config, dependencies, {
      operation: "private_reply",
      capabilityName: "private_reply",
      method: "POST",
      path: `/${encodeURIComponent(accountId)}/messages`,
      data: { recipient: { comment_id: comment }, message: { text } },
    });
    const recipientId = trimValue(response.recipient_id) || null;
    const messageId = trimValue(response.message_id) || null;
    return {
      commentId: comment,
      recipient_id: recipientId,
      message_id: messageId,
      recipientId,
      messageId,
    };
  }

  return {
    getCapabilityMatrix: () => getInstagramCapabilityMatrix({
      provider: config.provider,
      accountType: config.accountType,
      pageId: config.pageId,
      scopes: config.scopes,
      productTaggingApproved: config.productTaggingApproved,
    }),
    getInsights,
    probeInsightsAccess,
    listComments,
    replyToComment,
    setCommentHidden,
    hideComment: (options) => setCommentHidden({ ...options, hidden: true }),
    unhideComment: (options) => setCommentHidden({ ...options, hidden: false }),
    deleteComment,
    getMentions,
    getTaggedMedia,
    getRecentlySearchedHashtags,
    getHashtag,
    searchHashtag,
    getHashtagMedia,
    getBusinessDiscovery,
    sendPermittedMessage,
    sendPrivateReply,
  };
}

function verifyMetaWebhookSignature(rawBody, signature, secret) {
  const key = trimValue(secret);
  const supplied = trimValue(signature).toLowerCase();
  const validBody = Buffer.isBuffer(rawBody) || typeof rawBody === "string" || rawBody instanceof Uint8Array;
  if (!key || !validBody || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;
  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : (rawBody instanceof Uint8Array ? Buffer.from(rawBody) : Buffer.from(rawBody, "utf8"));
  const expected = `sha256=${crypto.createHmac("sha256", key).update(body).digest("hex")}`;
  const suppliedBuffer = Buffer.from(supplied, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function cleanWebhookText(value, maximum = 1000) {
  return trimValue(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "[removed]")
    .slice(0, maximum);
}

function toIsoTimestamp(value) {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function stableWebhookEventId(parts) {
  const joined = parts.map((part) => cleanWebhookText(part, 180)).filter(Boolean).join(":");
  if (joined.length <= 300) return joined;
  const digest = crypto.createHash("sha256").update(joined).digest("hex");
  return `${joined.slice(0, 235)}:${digest}`;
}

function sourceTypeForChange(field, value = {}) {
  const normalized = cleanWebhookText(field, 80).toLowerCase();
  if (new Set(["comments", "comment", "live_comments"]).has(normalized)) {
    return value.parent_id || value.parent?.id ? "REPLY" : "COMMENT";
  }
  if (new Set(["mentions", "mention"]).has(normalized)) return "MENTION";
  if (new Set(["story_mentions", "story_mention"]).has(normalized)) return "STORY_MENTION";
  if (new Set(["tags", "tagged_media", "tagged_post"]).has(normalized)) return "TAGGED_POST";
  if (new Set(["messages", "messaging"]).has(normalized)) return "DIRECT_MESSAGE";
  if (new Set(["private_reply", "private_replies"]).has(normalized)) return "PRIVATE_REPLY";
  return null;
}

function withPersistenceFields(event, sourceType) {
  const externalObjectId = event.subject?.commentId
    || event.subject?.messageId
    || event.subject?.mediaId
    || event.id;
  return {
    ...event,
    external_event_id: event.id,
    source_type: sourceType,
    external_object_id: externalObjectId,
    author_external_id: event.actor?.id || null,
    author_label: event.actor?.username || null,
    occurred_at: event.occurredAt,
  };
}

function normalizeChange(entry, change, index) {
  const value = change?.value || {};
  const field = cleanWebhookText(change?.field, 80) || "unknown";
  const sourceType = sourceTypeForChange(field, value);
  if (!sourceType) return null;
  const commentLike = new Set(["COMMENT", "REPLY"]).has(sourceType);
  const messageLike = new Set(["DIRECT_MESSAGE", "MESSAGE", "PRIVATE_REPLY"]).has(sourceType);
  const commentId = cleanWebhookText(value.comment_id || (commentLike ? value.id : null), 180) || null;
  const messageId = cleanWebhookText(value.message_id || (messageLike ? value.id : null), 180) || null;
  const mediaId = cleanWebhookText(value.media_id || value.media?.id || (!commentLike && !messageLike ? value.id : null), 180) || null;
  return withPersistenceFields({
    id: stableWebhookEventId([entry?.id, field, commentId || messageId || mediaId || index]),
    type: field,
    accountId: cleanWebhookText(entry?.id, 180) || null,
    occurredAt: toIsoTimestamp(entry?.time || value.created_time || value.timestamp),
    actor: {
      id: cleanWebhookText(value.from?.id || value.from_id, 180) || null,
      username: cleanWebhookText(value.from?.username || value.username, 100) || null,
    },
    subject: {
      commentId,
      messageId,
      mediaId,
    },
    text: cleanWebhookText(value.text, MAX_COMMENT_LENGTH) || null,
    untrusted: true,
  }, sourceType);
}

function normalizeMessaging(entry, messaging, index) {
  const message = messaging?.message || {};
  if (message.is_echo === true) return null;
  const postback = messaging?.postback || {};
  const reaction = messaging?.reaction || {};
  const type = message.mid ? "messages" : postback.payload ? "messaging_postbacks" : reaction.action ? "message_reactions" : "messaging";
  const messageId = cleanWebhookText(message.mid || reaction.mid, 180) || null;
  return withPersistenceFields({
    id: stableWebhookEventId([entry?.id, type, messageId || messaging?.timestamp || index]),
    type,
    accountId: cleanWebhookText(entry?.id || messaging?.recipient?.id, 180) || null,
    occurredAt: toIsoTimestamp(messaging?.timestamp || entry?.time),
    actor: {
      id: cleanWebhookText(messaging?.sender?.id, 180) || null,
      username: null,
    },
    subject: { messageId },
    text: cleanWebhookText(message.text || postback.title, MAX_MESSAGE_LENGTH) || null,
    postbackPayload: cleanWebhookText(postback.payload, 500) || null,
    attachmentTypes: Array.isArray(message.attachments)
      ? message.attachments.slice(0, 10).map((attachment) => cleanWebhookText(attachment?.type, 40)).filter(Boolean)
      : [],
    untrusted: true,
  }, message.mid ? "DIRECT_MESSAGE" : "MESSAGE");
}

function normalizeMetaWebhookEvents(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entry)) return [];
  const events = [];
  for (const entry of payload.entry.slice(0, 50)) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 50)) {
      if (events.length >= 100) break;
      const event = normalizeChange(entry, change, events.length);
      if (event) events.push(event);
    }
    for (const messaging of (Array.isArray(entry?.messaging) ? entry.messaging : []).slice(0, 50)) {
      if (events.length >= 100) break;
      const event = normalizeMessaging(entry, messaging, events.length);
      if (event) events.push(event);
    }
    if (events.length >= 100) break;
  }
  return events.filter((event) => event.id && event.accountId);
}

function verifyAndNormalizeMetaWebhook({ rawBody, signature, secret } = {}) {
  if (!verifyMetaWebhookSignature(rawBody, signature, secret)) {
    throw new InstagramGrowthError("Meta webhook signature is invalid", { code: "INVALID_WEBHOOK_SIGNATURE", operation: "webhook" });
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array
      ? Buffer.from(rawBody).toString("utf8")
      : rawBody);
  } catch (_error) {
    throw new InstagramGrowthError("Meta webhook payload is invalid JSON", { code: "INVALID_WEBHOOK_PAYLOAD", operation: "webhook" });
  }
  return normalizeMetaWebhookEvents(parsed);
}

function splitOperationOptions(options = {}) {
  const { settings = {}, dependencies = {}, ...operation } = options;
  return { service: createInstagramGrowthService({ settings, dependencies }), operation };
}

function getInstagramInsights(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getInsights(operation);
}

function probeInstagramInsightsAccess(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.probeInsightsAccess(operation);
}

function getInstagramMediaInsights(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  const { mediaId, objectId, ...rest } = operation;
  return service.getInsights({
    ...rest,
    objectId: objectId || mediaId,
    metrics: rest.metrics || ["reach", "likes", "comments", "saved", "shares", "total_interactions", "views"],
    // Media metrics are lifetime aggregates; Meta's media-insights request omits
    // the account-only period parameter and returns period=lifetime per metric.
    period: rest.period === undefined ? null : rest.period,
  });
}

function getInstagramComments(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.listComments(operation);
}

function replyToInstagramComment(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.replyToComment(operation);
}

function setInstagramCommentHidden(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.setCommentHidden(operation);
}

function hideInstagramComment(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.hideComment(operation);
}

function unhideInstagramComment(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.unhideComment(operation);
}

function deleteInstagramComment(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.deleteComment(operation);
}

function getInstagramMentions(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getMentions(operation);
}

function getInstagramTaggedMedia(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getTaggedMedia(operation);
}

function getInstagramRecentlySearchedHashtags(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getRecentlySearchedHashtags(operation);
}

function getInstagramHashtag(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getHashtag(operation);
}

function searchInstagramHashtag(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.searchHashtag(operation);
}

function getInstagramHashtagMedia(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getHashtagMedia(operation);
}

function getInstagramBusinessDiscovery(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.getBusinessDiscovery(operation);
}

function sendPermittedInstagramMessage(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.sendPermittedMessage(operation);
}

function sendInstagramPrivateReply(options = {}) {
  const { service, operation } = splitOperationOptions(options);
  return service.sendPrivateReply(operation);
}

module.exports = {
  InstagramGrowthError,
  createInstagramGrowthService,
  deleteComment: deleteInstagramComment,
  deleteInstagramComment,
  getComments: getInstagramComments,
  getInsights: getInstagramInsights,
  probeInsightsAccess: probeInstagramInsightsAccess,
  getInstagramCapabilityMatrix,
  getInstagramComments,
  getInstagramInsights,
  getInstagramBusinessDiscovery,
  getBusinessDiscovery: getInstagramBusinessDiscovery,
  getInstagramHashtagMedia,
  getHashtagMedia: getInstagramHashtagMedia,
  getInstagramHashtag,
  getHashtag: getInstagramHashtag,
  getInstagramMediaInsights,
  getInstagramMentions,
  getInstagramRecentlySearchedHashtags,
  getRecentlySearchedHashtags: getInstagramRecentlySearchedHashtags,
  getInstagramTaggedMedia,
  getMentions: getInstagramMentions,
  getMediaInsights: getInstagramMediaInsights,
  getTaggedMedia: getInstagramTaggedMedia,
  hideComment: hideInstagramComment,
  hideInstagramComment,
  listComments: getInstagramComments,
  normalizeMetaWebhookEvents,
  replyToComment: replyToInstagramComment,
  replyToInstagramComment,
  sendMessage: sendPermittedInstagramMessage,
  sendPermittedMessage: sendPermittedInstagramMessage,
  sendPrivateReply: sendInstagramPrivateReply,
  sendInstagramPrivateReply,
  sendPermittedInstagramMessage,
  setCommentHidden: setInstagramCommentHidden,
  setInstagramCommentHidden,
  searchHashtag: searchInstagramHashtag,
  searchInstagramHashtag,
  unhideComment: unhideInstagramComment,
  unhideInstagramComment,
  verifyAndNormalizeMetaWebhook,
  verifyMetaWebhookSignature,
  _private: {
    assertGraphId,
    assertHashtag,
    assertOfficialGraphBase,
    assertProfessionalUsername,
    cleanWebhookText,
    normalizeSettings,
    sanitizeComment,
    sanitizeBusinessDiscovery,
    sanitizeHashtag,
    sanitizeMedia,
    toIsoTimestamp,
  },
};
