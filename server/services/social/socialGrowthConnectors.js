const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const fs = require("node:fs").promises;
const net = require("node:net");
const axios = require("axios");

const CONNECTOR_STATES = Object.freeze({
  NOT_CONFIGURED: "NOT_CONFIGURED",
  MISCONFIGURED: "MISCONFIGURED",
  CONFIGURED: "CONFIGURED",
  CONNECTED: "CONNECTED",
  ERROR: "ERROR",
});

const DEFAULT_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 250;
const MAX_TIMEOUT_MS = 30000;
const MAX_N8N_PAYLOAD_BYTES = 256 * 1024;
const MAX_GOOGLE_CREDENTIAL_BYTES = 128 * 1024;
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = Object.freeze({
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  search_console: "https://www.googleapis.com/auth/webmasters.readonly",
});
const googleAccessTokenCache = new Map();

const DEFAULT_GA4_DIMENSIONS = new Set([
  "date",
  "sessionSource",
  "sessionMedium",
  "sessionCampaignName",
  "sessionManualAdContent",
  "eventName",
  "firstUserSource",
  "firstUserMedium",
  "landingPagePlusQueryString",
  "pagePath",
  "country",
  "deviceCategory",
]);

const DEFAULT_GA4_METRICS = new Set([
  "activeUsers",
  "newUsers",
  "returningUsers",
  "sessions",
  "engagedSessions",
  "engagementRate",
  "averageSessionDuration",
  "screenPageViews",
  "eventCount",
  "keyEvents",
  "totalRevenue",
]);

const DEFAULT_SEARCH_CONSOLE_DIMENSIONS = new Set([
  "date",
  "hour",
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
]);

const INSTAGRAM_LOGIN_PROFILES = Object.freeze({
  instagram_login: Object.freeze({
    id: "instagram_login",
    label: "Instagram API with Instagram Login",
    graphHost: "graph.instagram.com",
    tokenType: "instagram_user_access_token",
    requiresLinkedFacebookPage: false,
    supportedAccountTypes: ["BUSINESS", "CREATOR"],
    scopes: Object.freeze({
      basic: ["instagram_business_basic"],
      publish: ["instagram_business_content_publish"],
      insights: ["instagram_business_manage_insights"],
      comments: ["instagram_business_manage_comments"],
      messages: ["instagram_business_manage_messages"],
    }),
    limitations: [
      "Professional Instagram accounts only",
      "Ads are unavailable through this login family",
      "Tagging, tagged-media discovery, hashtag search, business discovery, and shopping tags are unavailable",
      "Story publishing is limited to Business accounts",
    ],
  }),
  facebook_login: Object.freeze({
    id: "facebook_login",
    label: "Instagram API with Facebook Login",
    graphHost: "graph.facebook.com",
    tokenType: "facebook_page_access_token",
    requiresLinkedFacebookPage: true,
    supportedAccountTypes: ["BUSINESS", "CREATOR"],
    scopes: Object.freeze({
      basic: ["instagram_basic", "pages_read_engagement"],
      publish: ["instagram_content_publish"],
      insights: ["instagram_manage_insights", "pages_read_engagement"],
      comments: ["instagram_manage_comments", "pages_read_engagement"],
      messages: ["instagram_manage_messages"],
      discovery: ["instagram_basic", "pages_read_engagement"],
      hashtagSearch: ["instagram_basic"],
      businessDiscovery: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"],
      pageLookup: ["pages_show_list"],
    }),
    limitations: [
      "Professional Instagram accounts only",
      "A linked Facebook Page is required",
      "Story publishing is limited to Business accounts",
      "Hashtag, business-discovery, tagged-media, and product-tagging access remains subject to App Review, Graph-version, and account/catalog eligibility",
    ],
  }),
});

class SocialGrowthConnectorError extends Error {
  constructor(message, { code = "CONNECTOR_ERROR", connector = null, status = null } = {}) {
    super(message);
    this.name = "SocialGrowthConnectorError";
    this.code = code;
    this.connector = connector;
    this.status = status;
  }
}

function trimValue(value) {
  return String(value == null ? "" : value).trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || String(value).toLowerCase() === "true" || String(value) === "1";
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

function normalizeTimeout(value) {
  return clampNumber(value, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

function isSensitiveKey(key) {
  return /(?:secret|token|authorization|api[_-]?key|credential|password|cookie|signature)/i.test(String(key));
}

function redactText(value, secrets = []) {
  let text = String(value == null ? "" : value);
  for (const secret of secrets.map(trimValue).filter(Boolean)) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:access_token|token|api_key|key|client_secret)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

function redactObject(value, secrets = [], seen = new WeakSet()) {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactText(value, secrets);
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactObject(entry, secrets, seen));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    isSensitiveKey(key) ? "[REDACTED]" : redactObject(entry, secrets, seen),
  ]));
}

function toConnectorError(error, { code, connector, secrets = [] } = {}) {
  if (error instanceof SocialGrowthConnectorError) return error;
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const sourceMessage = error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.message
    || "Connector request failed";
  return new SocialGrowthConnectorError(redactText(sourceMessage, secrets).slice(0, 500), {
    code: code || "CONNECTOR_REQUEST_FAILED",
    connector,
    status,
  });
}

async function withDeadline(work, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SocialGrowthConnectorError(`${label} timed out`, {
          code: "CONNECTOR_TIMEOUT",
        })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSettings(settings = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const source = settings.socialGrowthConnectors || settings.connectors || settings;
  const openAi = source.openAi || source.openai || {};
  const instagram = source.instagram || {};
  const ga4 = source.ga4 || source.googleAnalytics || {};
  const searchConsole = source.searchConsole || {};
  const n8n = source.n8n || {};
  const google = source.google || {};
  const googleToken = firstValue(source.googleAccessToken, env.GOOGLE_API_ACCESS_TOKEN);
  const serviceAccountJson = firstValue(
    google.serviceAccountJson,
    source.googleServiceAccountJson,
    env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  return {
    timeoutMs: normalizeTimeout(firstValue(source.timeoutMs, env.SOCIAL_GROWTH_CONNECTOR_TIMEOUT_MS)),
    googleAuth: {
      serviceAccountJson: serviceAccountJson || null,
      applicationCredentials: trimValue(firstValue(
        google.applicationCredentials,
        source.googleApplicationCredentials,
        env.GOOGLE_APPLICATION_CREDENTIALS
      )),
    },
    openAi: {
      apiKey: trimValue(firstValue(openAi.apiKey, env.OPENAI_API_KEY)),
      model: trimValue(firstValue(openAi.model, env.SOCIAL_OPENAI_MODEL, env.OPENAI_MODEL, "gpt-5.6-luna")),
      baseUrl: trimValue(firstValue(openAi.baseUrl, env.OPENAI_API_BASE, "https://api.openai.com/v1")).replace(/\/+$/, ""),
    },
    instagram: {
      provider: trimValue(firstValue(instagram.provider, instagram.loginType, env.INSTAGRAM_LOGIN_TYPE, "instagram_login")).toLowerCase(),
      accessToken: trimValue(firstValue(instagram.accessToken, env.INSTAGRAM_ACCESS_TOKEN)),
      accountId: trimValue(firstValue(instagram.accountId, instagram.instagramUserId, env.INSTAGRAM_USER_ID)),
      accountType: trimValue(firstValue(instagram.accountType, env.INSTAGRAM_ACCOUNT_TYPE)).toUpperCase(),
      pageId: trimValue(firstValue(instagram.pageId, env.INSTAGRAM_FACEBOOK_PAGE_ID)),
      scopes: parseList(firstValue(instagram.scopes, instagram.grantedScopes, env.INSTAGRAM_REQUIRED_SCOPES)),
      productTaggingApproved: parseBoolean(firstValue(instagram.productTaggingApproved, false)),
    },
    ga4: {
      propertyId: trimValue(firstValue(ga4.propertyId, env.GA4_PROPERTY_ID, env.GOOGLE_ANALYTICS_PROPERTY_ID)),
      accessToken: trimValue(firstValue(ga4.accessToken, googleToken)),
      baseUrl: trimValue(firstValue(ga4.baseUrl, "https://analyticsdata.googleapis.com/v1beta")).replace(/\/+$/, ""),
      allowedDimensions: new Set(parseList(firstValue(ga4.allowedDimensions, [...DEFAULT_GA4_DIMENSIONS]))),
      allowedMetrics: new Set(parseList(firstValue(ga4.allowedMetrics, [...DEFAULT_GA4_METRICS]))),
    },
    searchConsole: {
      siteUrl: trimValue(firstValue(searchConsole.siteUrl, env.GOOGLE_SEARCH_CONSOLE_SITE, env.SEARCH_CONSOLE_SITE_URL)),
      accessToken: trimValue(firstValue(searchConsole.accessToken, googleToken)),
      baseUrl: trimValue(firstValue(searchConsole.baseUrl, "https://www.googleapis.com/webmasters/v3")).replace(/\/+$/, ""),
      allowedDimensions: new Set(parseList(firstValue(searchConsole.allowedDimensions, [...DEFAULT_SEARCH_CONSOLE_DIMENSIONS]))),
    },
    n8n: {
      webhookUrl: trimValue(firstValue(n8n.webhookUrl, env.N8N_SOCIAL_WEBHOOK_URL)),
      signingSecret: trimValue(firstValue(n8n.signingSecret, env.N8N_SOCIAL_WEBHOOK_SECRET)),
      allowedHosts: parseList(firstValue(n8n.allowedHosts, env.N8N_SOCIAL_WEBHOOK_ALLOWED_HOSTS)),
      allowPrivateNetwork: parseBoolean(firstValue(n8n.allowPrivateNetwork, env.N8N_SOCIAL_WEBHOOK_ALLOW_PRIVATE_NETWORK), false),
      signatureHeader: trimValue(firstValue(n8n.signatureHeader, "X-Pink-Paisa-Signature")),
    },
  };
}

function hasEveryScope(scopes, required = []) {
  const granted = new Set(parseList(scopes));
  return required.every((scope) => granted.has(scope));
}

function capability(supported, available, requirements = [], limitation = null) {
  return {
    supported: Boolean(supported),
    available: Boolean(supported && available),
    requirements: [...requirements],
    ...(limitation ? { limitation } : {}),
  };
}

function getInstagramCapabilityMatrix(summary = {}) {
  const provider = trimValue(summary.provider || summary.login_type || summary.loginType || "instagram_login").toLowerCase();
  const profile = INSTAGRAM_LOGIN_PROFILES[provider];
  const scopes = parseList(summary.granted_scopes || summary.grantedScopes || summary.scopes);
  const accountType = trimValue(summary.account_type || summary.accountType).toUpperCase();
  const professional = profile?.supportedAccountTypes.includes(accountType);
  const linkedPage = Boolean(summary.facebook_page_id || summary.pageId || summary.linkedFacebookPage);
  const baseReady = Boolean(profile && professional && (!profile.requiresLinkedFacebookPage || linkedPage));
  const scopeReady = (name) => hasEveryScope(scopes, profile?.scopes?.[name] || []);
  const discoverySupported = provider === "facebook_login";
  const productApproved = summary.productTaggingApproved === true || summary.product_tagging_approved === true;

  if (!profile) {
    return {
      provider,
      valid: false,
      accountRequirementsMet: false,
      scopes,
      limitations: ["Unsupported Instagram login provider"],
      capabilities: {},
    };
  }

  return {
    provider,
    label: profile.label,
    valid: true,
    graphHost: profile.graphHost,
    tokenType: profile.tokenType,
    supportedAccountTypes: [...profile.supportedAccountTypes],
    requiresLinkedFacebookPage: profile.requiresLinkedFacebookPage,
    accountRequirementsMet: baseReady,
    scopes,
    requiredScopes: redactObject(profile.scopes),
    limitations: [...profile.limitations],
    capabilities: {
      profile: capability(true, baseReady && scopeReady("basic"), profile.scopes.basic),
      publish_image: capability(true, baseReady && scopeReady("publish"), profile.scopes.publish),
      publish_reel: capability(true, baseReady && scopeReady("publish"), profile.scopes.publish),
      publish_carousel: capability(true, baseReady && scopeReady("publish"), profile.scopes.publish),
      publish_story: capability(true, baseReady && accountType === "BUSINESS" && scopeReady("publish"), profile.scopes.publish, "Stories are limited to Business accounts"),
      insights: capability(true, baseReady && scopeReady("insights"), profile.scopes.insights),
      comments: capability(true, baseReady && scopeReady("comments"), profile.scopes.comments),
      messages: capability(true, baseReady && scopeReady("messages"), profile.scopes.messages, "Only policy-permitted, user-initiated conversations may be messaged"),
      private_reply: capability(true, baseReady && scopeReady("comments"), profile.scopes.comments, "One initial reply within Meta's comment reply window"),
      mentions: capability(discoverySupported, baseReady && scopeReady("discovery"), profile.scopes.discovery || [], discoverySupported ? null : "Read access is not exposed by Instagram Login"),
      tagged_media: capability(discoverySupported, baseReady && scopeReady("discovery"), profile.scopes.discovery || [], discoverySupported ? null : "Tagging is unavailable through Instagram Login"),
      hashtag_search: capability(
        discoverySupported,
        baseReady && scopeReady("hashtagSearch"),
        profile.scopes.hashtagSearch || [],
        discoverySupported
          ? "App Review and runtime quotas still apply; Meta can require an additional Page-role permission when access was granted through Business Manager"
          : "Unavailable through Instagram Login",
      ),
      business_discovery: capability(
        discoverySupported,
        baseReady && scopeReady("businessDiscovery"),
        profile.scopes.businessDiscovery || [],
        discoverySupported
          ? "App Review and target-account eligibility still apply; Business Manager-granted Page roles can also require ads_management or ads_read"
          : "Unavailable through Instagram Login",
      ),
      product_tagging: capability(discoverySupported, baseReady && scopeReady("publish") && productApproved, profile.scopes.publish, discoverySupported ? "Requires separately verified Instagram Shopping/catalog eligibility and current-version approval" : "Shopping tags are unavailable through Instagram Login"),
    },
  };
}

function connectionState(requiredValues, optionalValidation = true) {
  const present = requiredValues.map(Boolean);
  if (!present.some(Boolean)) return CONNECTOR_STATES.NOT_CONFIGURED;
  if (!present.every(Boolean) || !optionalValidation) return CONNECTOR_STATES.MISCONFIGURED;
  return CONNECTOR_STATES.CONFIGURED;
}

function hasGoogleServiceAccountInput(config) {
  return Boolean(config.googleAuth.serviceAccountJson || config.googleAuth.applicationCredentials);
}

function googleCredentialConfigurationIsValid(config) {
  if (config.googleAuth.serviceAccountJson) {
    try {
      parseGoogleServiceAccount(config.googleAuth.serviceAccountJson);
      return true;
    } catch (_error) {
      return false;
    }
  }
  const credentialPath = config.googleAuth.applicationCredentials;
  return !credentialPath || (credentialPath.length <= 2048 && !credentialPath.includes("\u0000"));
}

function buildConnectionOverview(settings = {}, dependencies = {}) {
  const config = normalizeSettings(settings, dependencies);
  const instagramProfile = INSTAGRAM_LOGIN_PROFILES[config.instagram.provider];
  const matrix = getInstagramCapabilityMatrix({
    provider: config.instagram.provider,
    accountType: config.instagram.accountType,
    pageId: config.instagram.pageId,
    scopes: config.instagram.scopes,
    productTaggingApproved: config.instagram.productTaggingApproved,
  });
  const instagramState = connectionState([
    config.instagram.accessToken || dependencies.getInstagramAccessToken,
    config.instagram.accountId,
    config.instagram.accountType,
  ], Boolean(instagramProfile && matrix.accountRequirementsMet));
  const openAiCredentialConfigured = Boolean(config.openAi.apiKey || dependencies.getOpenAiApiKey);
  const openAiState = !openAiCredentialConfigured
    ? CONNECTOR_STATES.NOT_CONFIGURED
    : connectionState([openAiCredentialConfigured, config.openAi.model]);
  const sharedGoogleCredentialConfigured = Boolean(
    dependencies.getGoogleAccessToken || hasGoogleServiceAccountInput(config)
  );
  const googleCredentialValid = googleCredentialConfigurationIsValid(config);
  let ga4ConfigValid = Boolean(config.ga4.accessToken || dependencies.getGoogleAccessToken) || googleCredentialValid;
  try {
    assertOfficialGoogleBase(config.ga4.baseUrl, {
      host: "analyticsdata.googleapis.com",
      path: "/v1beta",
      connector: "ga4",
    });
    if (config.ga4.propertyId && !/^\d{1,30}$/.test(config.ga4.propertyId)) ga4ConfigValid = false;
  } catch (_error) {
    ga4ConfigValid = false;
  }
  const ga4State = connectionState([
    config.ga4.propertyId,
    config.ga4.accessToken || sharedGoogleCredentialConfigured,
  ], ga4ConfigValid);
  let searchConfigValid = Boolean(config.searchConsole.accessToken || dependencies.getGoogleAccessToken) || googleCredentialValid;
  try {
    assertOfficialGoogleBase(config.searchConsole.baseUrl, {
      host: "www.googleapis.com",
      path: "/webmasters/v3",
      connector: "search_console",
    });
    if (config.searchConsole.siteUrl) validateSearchConsoleSiteUrl(config.searchConsole.siteUrl);
  } catch (_error) {
    searchConfigValid = false;
  }
  const searchState = connectionState([
    config.searchConsole.siteUrl,
    config.searchConsole.accessToken || sharedGoogleCredentialConfigured,
  ], searchConfigValid);
  let n8nUrlValid = false;
  if (config.n8n.webhookUrl) {
    try {
      assertN8nWebhookUrl(config.n8n.webhookUrl, config.n8n);
      n8nUrlValid = true;
    } catch (_error) {
      n8nUrlValid = false;
    }
  }
  const n8nState = connectionState([config.n8n.webhookUrl, config.n8n.signingSecret], n8nUrlValid);
  const targetOrigin = (() => {
    try { return new URL(config.n8n.webhookUrl).origin; } catch (_error) { return null; }
  })();

  return {
    generatedAt: new Date().toISOString(),
    states: CONNECTOR_STATES,
    connectors: {
      openai: {
        id: "openai",
        state: openAiState,
        configured: openAiState === CONNECTOR_STATES.CONFIGURED,
        checked: false,
        details: { model: config.openAi.model || null },
        capabilities: {
          structured_generation: capability(true, openAiState === CONNECTOR_STATES.CONFIGURED),
          image_generation: capability(true, openAiState === CONNECTOR_STATES.CONFIGURED),
        },
      },
      instagram: {
        id: "instagram",
        state: instagramState,
        configured: instagramState === CONNECTOR_STATES.CONFIGURED,
        checked: false,
        details: {
          provider: config.instagram.provider || null,
          accountIdPresent: Boolean(config.instagram.accountId),
          accountType: config.instagram.accountType || null,
          linkedFacebookPage: Boolean(config.instagram.pageId),
        },
        capabilityMatrix: matrix,
      },
      ga4: {
        id: "ga4",
        state: ga4State,
        configured: ga4State === CONNECTOR_STATES.CONFIGURED,
        checked: false,
        details: { propertyId: config.ga4.propertyId || null },
        capabilities: { aggregate_run_report: capability(true, ga4State === CONNECTOR_STATES.CONFIGURED) },
      },
      search_console: {
        id: "search_console",
        state: searchState,
        configured: searchState === CONNECTOR_STATES.CONFIGURED,
        checked: false,
        details: { siteUrl: config.searchConsole.siteUrl || null },
        capabilities: { aggregate_search_analytics: capability(true, searchState === CONNECTOR_STATES.CONFIGURED) },
      },
      n8n: {
        id: "n8n",
        state: n8nState,
        configured: n8nState === CONNECTOR_STATES.CONFIGURED,
        checked: false,
        details: { targetOrigin },
        capabilities: { signed_social_webhook: capability(true, n8nState === CONNECTOR_STATES.CONFIGURED) },
      },
    },
  };
}

function getConnectionOverview({ settings = {}, dependencies = {} } = {}) {
  return buildConnectionOverview(settings, dependencies);
}

async function checkAllConnections({ settings = {}, dependencies = {} } = {}) {
  const overview = buildConnectionOverview(settings, dependencies);
  const config = normalizeSettings(settings, dependencies);
  const configuredSecrets = [
    config.openAi.apiKey,
    config.instagram.accessToken,
    config.ga4.accessToken,
    config.searchConsole.accessToken,
    config.n8n.signingSecret,
  ];
  const checks = dependencies.connectionChecks || {};
  const entries = await Promise.all(Object.entries(overview.connectors).map(async ([id, status]) => {
    if (status.state !== CONNECTOR_STATES.CONFIGURED || typeof checks[id] !== "function") return [id, status];
    try {
      const result = await withDeadline(() => checks[id](), config.timeoutMs, `${id} connection check`);
      const connected = result === true || result?.ok === true || result?.connected === true;
      return [id, {
        ...status,
        state: connected ? CONNECTOR_STATES.CONNECTED : CONNECTOR_STATES.ERROR,
        checked: true,
        connected,
        ...(connected ? {} : { error: { code: "CONNECTION_CHECK_FAILED", message: "Connection check did not confirm connectivity" } }),
      }];
    } catch (error) {
      return [id, {
        ...status,
        state: CONNECTOR_STATES.ERROR,
        checked: true,
        connected: false,
        error: {
          code: error?.code || "CONNECTION_CHECK_FAILED",
          message: redactText(error?.message || "Connection check failed", configuredSecrets).slice(0, 300),
        },
      }];
    }
  }));
  return { ...overview, checkedAt: new Date().toISOString(), connectors: Object.fromEntries(entries) };
}

function assertConfigured(overview, connectorId) {
  const status = overview.connectors[connectorId];
  if (status?.state !== CONNECTOR_STATES.CONFIGURED && status?.state !== CONNECTOR_STATES.CONNECTED) {
    throw new SocialGrowthConnectorError(`${connectorId} connector is not configured`, {
      code: status?.state || CONNECTOR_STATES.NOT_CONFIGURED,
      connector: connectorId,
    });
  }
}

function validateNames(values, allowed, label, maximumCount) {
  const names = parseList(values);
  if (!names.length) throw new SocialGrowthConnectorError(`${label} requires at least one value`, { code: "INVALID_REQUEST" });
  if (names.length > maximumCount) throw new SocialGrowthConnectorError(`${label} exceeds the allowed count`, { code: "INVALID_REQUEST" });
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) || !allowed.has(name)) {
      throw new SocialGrowthConnectorError(`${label} contains a disallowed value`, { code: "INVALID_REQUEST" });
    }
  }
  return names;
}

function validateDate(value, label) {
  const date = trimValue(value);
  if (!/^(?:\d{4}-\d{2}-\d{2}|today|yesterday|\d{1,4}daysAgo)$/.test(date)) {
    throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST" });
  }
  return date;
}

function assertOfficialGoogleBase(value, { host, path, connector }) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) {
    throw new SocialGrowthConnectorError(`${connector} API base URL is invalid`, { code: "INVALID_CONFIGURATION", connector });
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (parsed.protocol !== "https:"
    || parsed.hostname !== host
    || normalizedPath !== path
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new SocialGrowthConnectorError(`${connector} API base URL must use the official Google endpoint`, {
      code: "INVALID_CONFIGURATION",
      connector,
    });
  }
}

function validateGa4Scalar(value, label) {
  if (typeof value === "string") {
    if (!value.length || value.length > 300 || /[\u0000-\u001F\u007F]/.test(value)) {
      throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
}

function normalizeGa4NumericValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
  }
  if (value.int64Value !== undefined && /^-?\d{1,20}$/.test(String(value.int64Value))) {
    return { int64Value: String(value.int64Value) };
  }
  if (value.doubleValue !== undefined && Number.isFinite(Number(value.doubleValue))) {
    return { doubleValue: Number(value.doubleValue) };
  }
  throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
}

function normalizeGa4FilterExpression(expression, allowedFields, label, depth = 0) {
  if (!expression || typeof expression !== "object" || Array.isArray(expression) || depth > 5) {
    throw new SocialGrowthConnectorError(`${label} is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
  }
  const variants = ["andGroup", "orGroup", "notExpression", "filter"].filter((key) => expression[key] !== undefined);
  if (variants.length !== 1) {
    throw new SocialGrowthConnectorError(`${label} must contain exactly one filter expression`, { code: "INVALID_REQUEST", connector: "ga4" });
  }
  const variant = variants[0];
  if (variant === "notExpression") {
    return { notExpression: normalizeGa4FilterExpression(expression.notExpression, allowedFields, label, depth + 1) };
  }
  if (variant === "andGroup" || variant === "orGroup") {
    const expressions = expression[variant]?.expressions;
    if (!Array.isArray(expressions) || !expressions.length || expressions.length > 20) {
      throw new SocialGrowthConnectorError(`${label} group is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
    }
    return {
      [variant]: {
        expressions: expressions.map((entry) => normalizeGa4FilterExpression(entry, allowedFields, label, depth + 1)),
      },
    };
  }
  const filter = expression.filter;
  const fieldName = trimValue(filter?.fieldName);
  if (!allowedFields.has(fieldName)) {
    throw new SocialGrowthConnectorError(`${label} references a disallowed field`, { code: "INVALID_REQUEST", connector: "ga4" });
  }
  const filterTypes = ["stringFilter", "inListFilter", "numericFilter", "betweenFilter", "emptyFilter"]
    .filter((key) => filter[key] !== undefined);
  if (filterTypes.length !== 1) {
    throw new SocialGrowthConnectorError(`${label} filter type is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
  }
  const filterType = filterTypes[0];
  if (filterType === "emptyFilter") return { filter: { fieldName, emptyFilter: {} } };
  if (filterType === "stringFilter") {
    const matchType = trimValue(filter.stringFilter?.matchType || "EXACT").toUpperCase();
    if (!new Set(["EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "FULL_REGEXP", "PARTIAL_REGEXP"]).has(matchType)) {
      throw new SocialGrowthConnectorError(`${label} string match type is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
    }
    return { filter: { fieldName, stringFilter: {
      matchType,
      value: validateGa4Scalar(filter.stringFilter?.value, `${label} string value`),
      caseSensitive: filter.stringFilter?.caseSensitive === true,
    } } };
  }
  if (filterType === "inListFilter") {
    const values = filter.inListFilter?.values;
    if (!Array.isArray(values) || !values.length || values.length > 50) {
      throw new SocialGrowthConnectorError(`${label} list is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
    }
    return { filter: { fieldName, inListFilter: {
      values: values.map((value) => validateGa4Scalar(value, `${label} list value`)),
      caseSensitive: filter.inListFilter?.caseSensitive === true,
    } } };
  }
  if (filterType === "numericFilter") {
    const operation = trimValue(filter.numericFilter?.operation).toUpperCase();
    if (!new Set(["EQUAL", "LESS_THAN", "LESS_THAN_OR_EQUAL", "GREATER_THAN", "GREATER_THAN_OR_EQUAL"]).has(operation)) {
      throw new SocialGrowthConnectorError(`${label} numeric operation is invalid`, { code: "INVALID_REQUEST", connector: "ga4" });
    }
    return { filter: { fieldName, numericFilter: {
      operation,
      value: normalizeGa4NumericValue(filter.numericFilter?.value, `${label} numeric value`),
    } } };
  }
  return { filter: { fieldName, betweenFilter: {
    fromValue: normalizeGa4NumericValue(filter.betweenFilter?.fromValue, `${label} lower value`),
    toValue: normalizeGa4NumericValue(filter.betweenFilter?.toValue, `${label} upper value`),
  } } };
}

function validateSearchConsoleSiteUrl(value) {
  const siteUrl = trimValue(value);
  if (/^sc-domain:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i.test(siteUrl)) return siteUrl;
  let parsed;
  try { parsed = new URL(siteUrl); } catch (_error) {
    throw new SocialGrowthConnectorError("Search Console siteUrl is invalid", { code: "INVALID_CONFIGURATION", connector: "search_console" });
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || siteUrl.length > 500) {
    throw new SocialGrowthConnectorError("Search Console siteUrl is invalid", { code: "INVALID_CONFIGURATION", connector: "search_console" });
  }
  return siteUrl;
}

function normalizeSearchConsoleFilterGroups(groups, allowedDimensions) {
  if (!Array.isArray(groups) || groups.length > 10) {
    throw new SocialGrowthConnectorError("Search Console filter groups are invalid", { code: "INVALID_REQUEST", connector: "search_console" });
  }
  const operators = new Set(["contains", "equals", "notContains", "notEquals", "includingRegex", "excludingRegex"]);
  return groups.map((group) => {
    if (trimValue(group?.groupType || "and") !== "and" || !Array.isArray(group?.filters) || !group.filters.length || group.filters.length > 20) {
      throw new SocialGrowthConnectorError("Search Console filter group is invalid", { code: "INVALID_REQUEST", connector: "search_console" });
    }
    return {
      groupType: "and",
      filters: group.filters.map((filter) => {
        const dimension = trimValue(filter?.dimension);
        const operator = trimValue(filter?.operator || "equals");
        const expression = trimValue(filter?.expression);
        if (!allowedDimensions.has(dimension) || !operators.has(operator) || !expression || expression.length > 500 || /[\u0000-\u001F\u007F]/.test(expression)) {
          throw new SocialGrowthConnectorError("Search Console filter is invalid", { code: "INVALID_REQUEST", connector: "search_console" });
        }
        return { dimension, operator, expression };
      }),
    };
  });
}

function assertOfficialGoogleTokenUri(value) {
  let parsed;
  try { parsed = new URL(value || GOOGLE_OAUTH_TOKEN_URL); } catch (_error) {
    throw new SocialGrowthConnectorError("Google OAuth token URI is invalid", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  if (parsed.toString() !== GOOGLE_OAUTH_TOKEN_URL) {
    throw new SocialGrowthConnectorError("Google OAuth must use the official token endpoint", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  return GOOGLE_OAUTH_TOKEN_URL;
}

function parseGoogleServiceAccount(rawValue) {
  let parsed = rawValue;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString("utf8");
  if (typeof parsed === "string") {
    if (!parsed.trim() || Buffer.byteLength(parsed) > MAX_GOOGLE_CREDENTIAL_BYTES) {
      throw new SocialGrowthConnectorError("Google service-account JSON is invalid", {
        code: "INVALID_CONFIGURATION",
        connector: "google",
      });
    }
    try { parsed = JSON.parse(parsed); } catch (_error) {
      throw new SocialGrowthConnectorError("Google service-account JSON is invalid", {
        code: "INVALID_CONFIGURATION",
        connector: "google",
      });
    }
  }
  const clientEmail = trimValue(parsed?.client_email);
  const privateKeyId = trimValue(parsed?.private_key_id);
  const privateKey = trimValue(parsed?.private_key).replace(/\\n/g, "\n");
  if (parsed?.type !== "service_account"
    || !/^[^\s@]{1,200}@[^\s@]{1,200}\.gserviceaccount\.com$/i.test(clientEmail)
    || !privateKey
    || privateKey.length > MAX_GOOGLE_CREDENTIAL_BYTES
    || (privateKeyId && !/^[A-Za-z0-9_-]{1,200}$/.test(privateKeyId))) {
    throw new SocialGrowthConnectorError("Google service-account credentials are invalid", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  try {
    const key = crypto.createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa") throw new Error("not RSA");
  } catch (_error) {
    throw new SocialGrowthConnectorError("Google service-account private key is invalid", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  return {
    clientEmail,
    privateKey,
    privateKeyId: privateKeyId || null,
    tokenUri: assertOfficialGoogleTokenUri(parsed.token_uri),
  };
}

async function loadGoogleServiceAccount(config, dependencies) {
  if (config.googleAuth.serviceAccountJson) {
    return parseGoogleServiceAccount(config.googleAuth.serviceAccountJson);
  }
  const credentialPath = config.googleAuth.applicationCredentials;
  if (!credentialPath) {
    throw new SocialGrowthConnectorError("Google credentials are not configured", {
      code: CONNECTOR_STATES.NOT_CONFIGURED,
      connector: "google",
    });
  }
  if (credentialPath.length > 2048 || credentialPath.includes("\u0000")) {
    throw new SocialGrowthConnectorError("Google credential file path is invalid", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  const fileSystem = dependencies.fileSystem || fs;
  if (typeof fileSystem.stat !== "function" || typeof fileSystem.readFile !== "function") {
    throw new SocialGrowthConnectorError("Google credential file reader is unavailable", {
      code: "GOOGLE_CREDENTIAL_LOAD_FAILED",
      connector: "google",
    });
  }
  let raw;
  try {
    const metadata = await withDeadline(
      () => fileSystem.stat(credentialPath),
      config.timeoutMs,
      "Google credential file metadata"
    );
    if (!metadata?.isFile?.() || !Number.isFinite(Number(metadata.size)) || Number(metadata.size) > MAX_GOOGLE_CREDENTIAL_BYTES) {
      throw new Error("invalid credential file");
    }
    raw = await withDeadline(
      () => fileSystem.readFile(credentialPath, "utf8"),
      config.timeoutMs,
      "Google credential file read"
    );
    if (Buffer.byteLength(raw) > MAX_GOOGLE_CREDENTIAL_BYTES) throw new Error("credential file too large");
  } catch (_error) {
    throw new SocialGrowthConnectorError("Google credential file could not be safely loaded", {
      code: "GOOGLE_CREDENTIAL_LOAD_FAILED",
      connector: "google",
    });
  }
  return parseGoogleServiceAccount(raw);
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createGoogleServiceAccountAssertion(credentials, scope, now = new Date()) {
  const issuedAt = Math.floor(new Date(now).getTime() / 1000);
  if (!Number.isFinite(issuedAt)) {
    throw new SocialGrowthConnectorError("Google OAuth clock is invalid", {
      code: "INVALID_CONFIGURATION",
      connector: "google",
    });
  }
  const header = { alg: "RS256", typ: "JWT", ...(credentials.privateKeyId ? { kid: credentials.privateKeyId } : {}) };
  const claim = {
    iss: credentials.clientEmail,
    scope,
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const unsigned = `${encodeJwtPart(header)}.${encodeJwtPart(claim)}`;
  try {
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned, "utf8"), credentials.privateKey).toString("base64url");
    return `${unsigned}.${signature}`;
  } catch (_error) {
    throw new SocialGrowthConnectorError("Google service-account assertion could not be signed", {
      code: "GOOGLE_AUTH_SIGNING_FAILED",
      connector: "google",
    });
  }
}

function googleCredentialCacheKey(credentials, scope) {
  return crypto.createHash("sha256")
    .update(credentials.clientEmail)
    .update("\u0000")
    .update(credentials.privateKeyId || "")
    .update("\u0000")
    .update(crypto.createHash("sha256").update(credentials.privateKey).digest())
    .update("\u0000")
    .update(scope)
    .digest("hex");
}

async function mintGoogleServiceAccountToken(config, dependencies, connector) {
  const scope = GOOGLE_SCOPES[connector];
  if (!scope) {
    throw new SocialGrowthConnectorError("Google OAuth scope is unavailable", {
      code: "INVALID_CONFIGURATION",
      connector,
    });
  }
  const credentials = await loadGoogleServiceAccount(config, dependencies);
  const cache = dependencies.googleAccessTokenCache instanceof Map
    ? dependencies.googleAccessTokenCache
    : googleAccessTokenCache;
  const cacheKey = googleCredentialCacheKey(credentials, scope);
  const nowValue = new Date((dependencies.now || (() => new Date()))());
  const nowMs = nowValue.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new SocialGrowthConnectorError("Google OAuth clock is invalid", {
      code: "INVALID_CONFIGURATION",
      connector,
    });
  }
  const cached = cache.get(cacheKey);
  if (cached?.token && cached.expiresAt > nowMs + 60000) return cached.token;
  if (cached?.promise) return (await cached.promise).token;

  const exchange = (async () => {
    const assertion = createGoogleServiceAccountAssertion(credentials, scope, nowValue);
    const client = dependencies.googleAuthHttpClient || dependencies.httpClient || axios;
    if (!client || typeof client.request !== "function") {
      throw new SocialGrowthConnectorError("Google OAuth HTTP client is unavailable", {
        code: "HTTP_CLIENT_UNAVAILABLE",
        connector,
      });
    }
    let response;
    try {
      response = await withDeadline(() => client.request({
        method: "POST",
        url: GOOGLE_OAUTH_TOKEN_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
        timeout: config.timeoutMs,
        maxRedirects: 0,
        maxContentLength: 512 * 1024,
        maxBodyLength: MAX_GOOGLE_CREDENTIAL_BYTES,
      }), config.timeoutMs, "Google OAuth token exchange");
      const status = Number(response?.status || 0);
      if (status < 200 || status >= 300) throw new Error(`Google OAuth returned HTTP ${status || "unknown"}`);
    } catch (error) {
      throw toConnectorError(error, {
        code: "GOOGLE_AUTH_REQUEST_FAILED",
        connector,
        secrets: [assertion, credentials.privateKey],
      });
    }
    const token = trimValue(response?.data?.access_token);
    const tokenType = trimValue(response?.data?.token_type || "Bearer");
    const expiresIn = Number(response?.data?.expires_in);
    if (!token
      || token.length > 16384
      || /\s|[\u0000-\u001F\u007F]/.test(token)
      || tokenType.toLowerCase() !== "bearer"
      || !Number.isFinite(expiresIn)
      || expiresIn < 60
      || expiresIn > 7200) {
      throw new SocialGrowthConnectorError("Google OAuth returned an invalid access token response", {
        code: "GOOGLE_AUTH_RESPONSE_INVALID",
        connector,
      });
    }
    return { token, expiresAt: nowMs + Math.min(expiresIn, 3600) * 1000 };
  })();

  cache.set(cacheKey, { promise: exchange });
  try {
    const result = await exchange;
    cache.set(cacheKey, result);
    if (cache.size > 32) {
      for (const [key, value] of cache) {
        if (key !== cacheKey && (!value?.expiresAt || value.expiresAt <= nowMs + 60000)) cache.delete(key);
      }
      while (cache.size > 32) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === cacheKey && cache.size > 1) {
          cache.delete([...cache.keys()][1]);
        } else {
          cache.delete(oldestKey);
        }
      }
    }
    return result.token;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

async function resolveGoogleToken(config, dependencies, connector) {
  const direct = connector === "ga4" ? config.ga4.accessToken : config.searchConsole.accessToken;
  if (direct) return direct;
  if (typeof dependencies.getGoogleAccessToken === "function") {
    const tokenResult = await withDeadline(
      () => dependencies.getGoogleAccessToken({ connector, scope: GOOGLE_SCOPES[connector] }),
      config.timeoutMs,
      `${connector} credential resolution`
    );
    const token = trimValue(tokenResult?.accessToken || tokenResult?.access_token || tokenResult);
    if (!token) throw new SocialGrowthConnectorError(`${connector} credential provider returned no token`, {
      code: CONNECTOR_STATES.NOT_CONFIGURED,
      connector,
    });
    return token;
  }
  if (hasGoogleServiceAccountInput(config)) {
    return mintGoogleServiceAccountToken(config, dependencies, connector);
  }
  throw new SocialGrowthConnectorError(`${connector} connector is not configured`, {
    code: CONNECTOR_STATES.NOT_CONFIGURED,
    connector,
  });
}

async function performRequest(dependencies, request, timeoutMs, label) {
  const client = dependencies.httpClient || axios;
  if (!client || typeof client.request !== "function") {
    throw new SocialGrowthConnectorError("HTTP client is unavailable", { code: "HTTP_CLIENT_UNAVAILABLE" });
  }
  return withDeadline(() => client.request({ ...request, timeout: timeoutMs }), timeoutMs, label);
}

function parseNumeric(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGa4Report(data = {}) {
  const dimensions = (data.dimensionHeaders || []).map((header) => trimValue(header.name));
  const metrics = (data.metricHeaders || []).map((header) => trimValue(header.name));
  const parseRow = (row = {}) => ({
    dimensions: Object.fromEntries(dimensions.map((name, index) => [name, trimValue(row.dimensionValues?.[index]?.value)])),
    metrics: Object.fromEntries(metrics.map((name, index) => [name, parseNumeric(row.metricValues?.[index]?.value)])),
  });
  return {
    source: "ga4_data_api",
    aggregate: true,
    rowCount: Number(data.rowCount || 0),
    rows: (data.rows || []).map(parseRow),
    totals: (data.totals || []).map(parseRow),
    metadata: {
      currencyCode: trimValue(data.metadata?.currencyCode) || null,
      timeZone: trimValue(data.metadata?.timeZone) || null,
      dataLossFromOtherRow: data.metadata?.dataLossFromOtherRow === true,
      subjectToThresholding: data.metadata?.subjectToThresholding === true,
    },
    propertyQuota: data.propertyQuota ? redactObject(data.propertyQuota) : null,
  };
}

async function collectGa4Aggregate({
  settings = {},
  dependencies = {},
  startDate = "28daysAgo",
  endDate = "yesterday",
  dimensions = ["date", "sessionSource"],
  metrics = ["sessions", "activeUsers"],
  limit = 100,
  dimensionFilter = null,
  metricFilter = null,
} = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = buildConnectionOverview(settings, dependencies);
  assertConfigured(overview, "ga4");
  assertOfficialGoogleBase(config.ga4.baseUrl, {
    host: "analyticsdata.googleapis.com",
    path: "/v1beta",
    connector: "ga4",
  });
  if (!/^\d{1,30}$/.test(config.ga4.propertyId)) {
    throw new SocialGrowthConnectorError("GA4 propertyId is invalid", { code: "INVALID_CONFIGURATION", connector: "ga4" });
  }
  const dimensionNames = validateNames(dimensions, config.ga4.allowedDimensions, "GA4 dimensions", 6);
  const metricNames = validateNames(metrics, config.ga4.allowedMetrics, "GA4 metrics", 10);
  const token = await resolveGoogleToken(config, dependencies, "ga4");
  const body = {
    dateRanges: [{ startDate: validateDate(startDate, "GA4 startDate"), endDate: validateDate(endDate, "GA4 endDate") }],
    dimensions: dimensionNames.map((name) => ({ name })),
    metrics: metricNames.map((name) => ({ name })),
    limit: String(Math.floor(clampNumber(limit, 1, 5000, 100))),
    returnPropertyQuota: true,
  };
  if (dimensionFilter) body.dimensionFilter = normalizeGa4FilterExpression(dimensionFilter, config.ga4.allowedDimensions, "GA4 dimensionFilter");
  if (metricFilter) body.metricFilter = normalizeGa4FilterExpression(metricFilter, config.ga4.allowedMetrics, "GA4 metricFilter");
  try {
    const response = await performRequest(dependencies, {
      method: "POST",
      url: `${config.ga4.baseUrl}/properties/${encodeURIComponent(config.ga4.propertyId)}:runReport`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: body,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 512 * 1024,
      maxRedirects: 0,
    }, config.timeoutMs, "GA4 aggregate report");
    const status = Number(response?.status || 0);
    if (status < 200 || status >= 300) {
      throw new SocialGrowthConnectorError(`GA4 returned HTTP ${status || "unknown"}`, {
        code: "GA4_REQUEST_FAILED",
        connector: "ga4",
        status: status || null,
      });
    }
    return parseGa4Report(response?.data || {});
  } catch (error) {
    throw toConnectorError(error, { code: "GA4_REQUEST_FAILED", connector: "ga4", secrets: [token] });
  }
}

function parseSearchConsoleReport(data = {}, dimensions = []) {
  const rows = (data.rows || []).map((row) => ({
    dimensions: Object.fromEntries(dimensions.map((name, index) => [name, trimValue(row.keys?.[index])])),
    clicks: parseNumeric(row.clicks) || 0,
    impressions: parseNumeric(row.impressions) || 0,
    ctr: parseNumeric(row.ctr) || 0,
    position: parseNumeric(row.position),
  }));
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const rowsWithPosition = rows.filter((row) => row.position !== null);
  const positionImpressions = rowsWithPosition.reduce((sum, row) => sum + row.impressions, 0);
  const positionWeight = rowsWithPosition.reduce((sum, row) => sum + (row.position * row.impressions), 0);
  return {
    source: "search_console_api",
    aggregate: true,
    rows,
    totals: {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      weightedPosition: positionImpressions > 0 ? positionWeight / positionImpressions : null,
    },
    responseAggregationType: trimValue(data.responseAggregationType) || null,
    isTopRowsOnly: true,
  };
}

async function collectSearchConsoleAggregate({
  settings = {},
  dependencies = {},
  startDate,
  endDate,
  dimensions = ["date", "page"],
  type = "web",
  rowLimit = 1000,
  startRow = 0,
  dimensionFilterGroups = [],
  aggregationType = "auto",
} = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = buildConnectionOverview(settings, dependencies);
  assertConfigured(overview, "search_console");
  assertOfficialGoogleBase(config.searchConsole.baseUrl, {
    host: "www.googleapis.com",
    path: "/webmasters/v3",
    connector: "search_console",
  });
  const siteUrl = validateSearchConsoleSiteUrl(config.searchConsole.siteUrl);
  const dimensionNames = validateNames(dimensions, config.searchConsole.allowedDimensions, "Search Console dimensions", 7);
  const searchType = trimValue(type || "web");
  if (!new Set(["web", "image", "video", "news", "discover", "googleNews"]).has(searchType)) {
    throw new SocialGrowthConnectorError("Search Console type is invalid", { code: "INVALID_REQUEST", connector: "search_console" });
  }
  if (!new Set(["auto", "byPage", "byProperty"]).has(aggregationType)) {
    throw new SocialGrowthConnectorError("Search Console aggregationType is invalid", { code: "INVALID_REQUEST", connector: "search_console" });
  }
  const token = await resolveGoogleToken(config, dependencies, "search_console");
  const body = {
    startDate: validateDate(startDate, "Search Console startDate"),
    endDate: validateDate(endDate, "Search Console endDate"),
    dimensions: dimensionNames,
    type: searchType,
    rowLimit: Math.floor(clampNumber(rowLimit, 1, 25000, 1000)),
    startRow: Math.floor(clampNumber(startRow, 0, 1000000, 0)),
    aggregationType,
  };
  if (Array.isArray(dimensionFilterGroups) && dimensionFilterGroups.length) {
    body.dimensionFilterGroups = normalizeSearchConsoleFilterGroups(dimensionFilterGroups, config.searchConsole.allowedDimensions);
  }
  try {
    const response = await performRequest(dependencies, {
      method: "POST",
      url: `${config.searchConsole.baseUrl}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: body,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 512 * 1024,
      maxRedirects: 0,
    }, config.timeoutMs, "Search Console aggregate query");
    const status = Number(response?.status || 0);
    if (status < 200 || status >= 300) {
      throw new SocialGrowthConnectorError(`Search Console returned HTTP ${status || "unknown"}`, {
        code: "SEARCH_CONSOLE_REQUEST_FAILED",
        connector: "search_console",
        status: status || null,
      });
    }
    return parseSearchConsoleReport(response?.data || {}, dimensionNames);
  } catch (error) {
    throw toConnectorError(error, { code: "SEARCH_CONSOLE_REQUEST_FAILED", connector: "search_console", secrets: [token] });
  }
}

function isPrivateHostname(hostname) {
  const host = trimValue(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host.endsWith(".local")
    || host === "0.0.0.0"
    || host === "::"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^169\.254\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    || /^(?:fc|fd|fe80):/i.test(host);
}

function isUnsafeNetworkAddress(address) {
  const value = trimValue(address).toLowerCase().replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:")) return isUnsafeNetworkAddress(value.slice(7));
  if (net.isIPv4(value)) {
    const octets = value.split(".").map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] >= 224;
  }
  return value === "::"
    || value === "::1"
    || value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("ff");
}

function assertN8nWebhookUrl(value, options = {}) {
  let parsed;
  try { parsed = new URL(value); } catch (_error) {
    throw new SocialGrowthConnectorError("n8n webhook URL is invalid", { code: "N8N_URL_INVALID", connector: "n8n" });
  }
  if (parsed.protocol !== "https:" && !(options.allowPrivateNetwork && parsed.protocol === "http:")) {
    throw new SocialGrowthConnectorError("n8n webhook URL must use HTTPS", { code: "N8N_URL_INVALID", connector: "n8n" });
  }
  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new SocialGrowthConnectorError("n8n webhook URL must not contain credentials, query parameters, or a fragment", { code: "N8N_URL_INVALID", connector: "n8n" });
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateHostname(host) && !options.allowPrivateNetwork) {
    throw new SocialGrowthConnectorError("n8n private-network targets require an explicit opt-in", { code: "N8N_URL_INVALID", connector: "n8n" });
  }
  const allowedHosts = new Set(parseList(options.allowedHosts).map((entry) => entry.toLowerCase()));
  if (allowedHosts.size && !allowedHosts.has(host)) {
    throw new SocialGrowthConnectorError("n8n webhook host is not allowlisted", { code: "N8N_URL_INVALID", connector: "n8n" });
  }
  return parsed.toString();
}

async function assertN8nWebhookTarget(value, options = {}, dependencies = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const safeUrl = assertN8nWebhookUrl(value, options);
  if (options.allowPrivateNetwork) return safeUrl;
  const hostname = new URL(safeUrl).hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname }]
      : await withDeadline(
        () => (dependencies.lookup || dns.lookup)(hostname, { all: true, verbatim: true }),
        timeoutMs,
        "n8n DNS validation"
      );
  } catch (error) {
    if (error instanceof SocialGrowthConnectorError) throw error;
    throw new SocialGrowthConnectorError("n8n webhook host could not be safely resolved", {
      code: "N8N_URL_INVALID",
      connector: "n8n",
    });
  }
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (!resolved.length || resolved.some((entry) => isUnsafeNetworkAddress(entry?.address))) {
    throw new SocialGrowthConnectorError("n8n webhook host resolved to a private or unsafe address", {
      code: "N8N_URL_INVALID",
      connector: "n8n",
    });
  }
  return safeUrl;
}

function createN8nSignature(rawBody, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

async function triggerN8nSocialWorkflow({
  settings = {},
  dependencies = {},
  event,
  payload = {},
  idempotencyKey = null,
} = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = buildConnectionOverview(settings, dependencies);
  assertConfigured(overview, "n8n");
  const webhookUrl = await assertN8nWebhookTarget(
    config.n8n.webhookUrl,
    config.n8n,
    dependencies,
    config.timeoutMs
  );
  const eventName = trimValue(event);
  if (!/^[a-z][a-z0-9_.:-]{0,99}$/i.test(eventName)) {
    throw new SocialGrowthConnectorError("n8n event name is invalid", { code: "INVALID_REQUEST", connector: "n8n" });
  }
  const timestamp = new Date((dependencies.now || (() => new Date()))()).toISOString();
  const eventId = trimValue(idempotencyKey) || (dependencies.randomUUID || crypto.randomUUID)();
  const envelope = { event: eventName, event_id: eventId, occurred_at: timestamp, payload };
  const rawBody = JSON.stringify(envelope);
  if (Buffer.byteLength(rawBody) > MAX_N8N_PAYLOAD_BYTES) {
    throw new SocialGrowthConnectorError("n8n webhook payload is too large", { code: "PAYLOAD_TOO_LARGE", connector: "n8n" });
  }
  const signature = createN8nSignature(rawBody, config.n8n.signingSecret);
  try {
    const response = await performRequest(dependencies, {
      method: "POST",
      url: webhookUrl,
      headers: {
        "Content-Type": "application/json",
        [config.n8n.signatureHeader]: signature,
        "X-Pink-Paisa-Timestamp": timestamp,
        "X-Pink-Paisa-Event-Id": eventId,
      },
      data: rawBody,
      maxContentLength: 512 * 1024,
      maxBodyLength: MAX_N8N_PAYLOAD_BYTES,
      maxRedirects: 0,
    }, config.timeoutMs, "n8n social webhook");
    const status = Number(response?.status || 200);
    if (status < 200 || status >= 300) {
      throw new SocialGrowthConnectorError(`n8n webhook returned HTTP ${status}`, {
        code: "N8N_WEBHOOK_REJECTED",
        connector: "n8n",
        status,
      });
    }
    return {
      accepted: true,
      event: eventName,
      eventId,
      status,
      response: redactObject(response?.data || null, [config.n8n.signingSecret]),
    };
  } catch (error) {
    throw toConnectorError(error, { code: "N8N_WEBHOOK_FAILED", connector: "n8n", secrets: [config.n8n.signingSecret] });
  }
}

function createSocialGrowthConnectors({ settings = {}, dependencies = {} } = {}) {
  return {
    getConnectionOverview: () => getConnectionOverview({ settings, dependencies }),
    checkAllConnections: () => checkAllConnections({ settings, dependencies }),
    collectGa4Aggregate: (options = {}) => collectGa4Aggregate({ ...options, settings, dependencies }),
    collectSearchConsoleAggregate: (options = {}) => collectSearchConsoleAggregate({ ...options, settings, dependencies }),
    triggerN8nSocialWorkflow: (options = {}) => triggerN8nSocialWorkflow({ ...options, settings, dependencies }),
  };
}

module.exports = {
  CONNECTOR_STATES,
  INSTAGRAM_LOGIN_PROFILES,
  SocialGrowthConnectorError,
  checkAllConnections,
  collectGa4Aggregate,
  collectSearchConsoleAggregate,
  createN8nSignature,
  createSocialGrowthConnectors,
  getConnectionOverview,
  getInstagramCapabilityMatrix,
  triggerN8nSocialWorkflow,
  _private: {
    assertN8nWebhookUrl,
    assertN8nWebhookTarget,
    assertOfficialGoogleBase,
    buildConnectionOverview,
    normalizeSettings,
    normalizeGa4FilterExpression,
    normalizeSearchConsoleFilterGroups,
    parseGa4Report,
    parseSearchConsoleReport,
    redactObject,
    redactText,
    validateDate,
    validateNames,
    validateSearchConsoleSiteUrl,
    withDeadline,
  },
};
