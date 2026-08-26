const dns = require("node:dns").promises;
const net = require("node:net");
const axios = require("axios");
const dailyPredictionService = require("../dailyPredictionService");
const {
  assertSafeExternalSourceUrl,
  detectPromptInjection,
  sanitizeUntrustedResearchText,
} = require("./socialCompliance");
const { _private: { withDeadline, redactText } } = require("./socialGrowthConnectors");

const ADAPTER_STATES = Object.freeze({
  DISABLED: "DISABLED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  CONFIGURED: "CONFIGURED",
  OK: "OK",
  ERROR: "ERROR",
});

const GDELT_HOST = "api.gdeltproject.org";
const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

class SocialGrowthResearchAdapterError extends Error {
  constructor(message, { code = "RESEARCH_ADAPTER_ERROR", adapter = null, status = null } = {}) {
    super(message);
    this.name = "SocialGrowthResearchAdapterError";
    this.code = code;
    this.adapter = adapter;
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

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, minimum), maximum);
}

function normalizeSettings(settings = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  const source = settings.socialGrowthResearchAdapters || settings.researchAdapters || settings;
  const gdelt = source.gdelt || {};
  const rss = source.rss || source.officialRss || {};
  const manual = source.manual || {};
  return {
    timeoutMs: Math.floor(clamp(firstValue(source.timeoutMs, env.SOCIAL_RESEARCH_ADAPTER_TIMEOUT_MS), 250, 30000, DEFAULT_TIMEOUT_MS)),
    blockedDomains: parseList(firstValue(source.blockedDomains, [])),
    gdelt: {
      enabled: parseBoolean(firstValue(gdelt.enabled, env.SOCIAL_GDELT_ENABLED), false),
      endpoint: trimValue(firstValue(gdelt.endpoint, env.SOCIAL_GDELT_ENDPOINT, GDELT_ENDPOINT)),
      query: trimValue(firstValue(gdelt.query, env.SOCIAL_GDELT_QUERY)),
      maxRecords: Math.floor(clamp(firstValue(gdelt.maxRecords, env.SOCIAL_GDELT_MAX_RECORDS), 1, 50, 20)),
      timespan: trimValue(firstValue(gdelt.timespan, env.SOCIAL_GDELT_TIMESPAN, "24h")),
      articleDomains: parseList(firstValue(gdelt.articleDomains, source.allowedDomains, [])),
    },
    rss: {
      enabled: parseBoolean(firstValue(rss.enabled, Array.isArray(rss.feeds) && rss.feeds.length > 0), false),
      feeds: Array.isArray(rss.feeds) ? rss.feeds : [],
      articleDomains: parseList(firstValue(rss.articleDomains, source.allowedDomains, [])),
    },
    manual: {
      enabled: parseBoolean(firstValue(manual.enabled, false), false),
      sourceDomains: parseList(firstValue(manual.sourceDomains, source.allowedDomains, [])),
    },
  };
}

function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    return octets[0] === 0
      || octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] >= 224;
  }
  const normalized = String(address).toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

async function lookupAll(hostname, lookup = dns.lookup) {
  const result = await lookup(hostname, { all: true, verbatim: true });
  return Array.isArray(result) ? result : [result];
}

async function assertAllowedPublicUrl(value, {
  allowedDomains,
  blockedDomains = [],
  lookup = dns.lookup,
  exactHosts = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeUrl = assertSafeExternalSourceUrl(value, { allowedDomains, blockedDomains });
  const parsed = new URL(safeUrl);
  const normalizedAllowed = new Set(parseList(allowedDomains).map((domain) => domain.toLowerCase().replace(/^www\./, "")));
  if (exactHosts && !normalizedAllowed.has(parsed.hostname.toLowerCase().replace(/^www\./, ""))) {
    throw new SocialGrowthResearchAdapterError("Research URL host is not explicitly allowlisted", { code: "RESEARCH_URL_BLOCKED" });
  }
  const addresses = net.isIP(parsed.hostname)
    ? [{ address: parsed.hostname }]
    : await withDeadline(
      () => lookupAll(parsed.hostname, lookup),
      Math.floor(clamp(timeoutMs, 1, 30000, DEFAULT_TIMEOUT_MS)),
      "Research DNS lookup"
    );
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry?.address))) {
    throw new SocialGrowthResearchAdapterError("Research URL resolved to a private or unsafe address", { code: "RESEARCH_URL_BLOCKED" });
  }
  return safeUrl;
}

function sourceDomain(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch (_error) { return ""; }
}

function normalizePublishedAt(value) {
  if (value === undefined || value === null || trimValue(value) === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function buildSource({ key, title, url, publisher, publishedAt, excerpt, claimSupported, sourceType, now, validationStatus }) {
  return {
    source_key: key,
    title: sanitizeUntrustedResearchText(title, 300),
    url,
    publisher: sanitizeUntrustedResearchText(publisher, 180),
    domain: sourceDomain(url),
    published_at: normalizePublishedAt(publishedAt),
    accessed_at: now.toISOString(),
    excerpt: sanitizeUntrustedResearchText(excerpt, 900),
    claim_supported: sanitizeUntrustedResearchText(claimSupported, 600),
    source_type: trimValue(sourceType || "news").toLowerCase(),
    prompt_injection_flags: [],
    validation_status: validationStatus,
    influenced_decision: false,
  };
}

function buildSignal(source, { id, category = "external", confidence = 0.5, requiresHumanReview = true } = {}) {
  return {
    id: id || source.source_key,
    headline: source.title,
    summary: source.excerpt,
    claim_supported: source.claim_supported,
    source_key: source.source_key,
    confidence: Math.min(Math.max(Number(confidence || 0), 0), 1),
    category: sanitizeUntrustedResearchText(category, 80),
    requires_human_review: requiresHumanReview,
    eligible_for_automated_decision: false,
  };
}

function adapterError(error, adapter) {
  if (error instanceof SocialGrowthResearchAdapterError) return error;
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const message = error?.response?.data?.message || error?.message || `${adapter} research failed`;
  return new SocialGrowthResearchAdapterError(redactText(message).slice(0, 400), {
    code: `${adapter.toUpperCase()}_REQUEST_FAILED`,
    adapter,
    status,
  });
}

function getResearchAdapterOverview({ settings = {}, dependencies = {} } = {}) {
  const config = normalizeSettings(settings, dependencies);
  const gdeltConfigured = config.gdelt.enabled && Boolean(config.gdelt.query && config.gdelt.articleDomains.length);
  const rssConfigured = config.rss.enabled && config.rss.feeds.length > 0;
  const manualConfigured = config.manual.enabled && config.manual.sourceDomains.length > 0;
  const state = (enabled, configured) => !enabled
    ? ADAPTER_STATES.DISABLED
    : (configured ? ADAPTER_STATES.CONFIGURED : ADAPTER_STATES.NOT_CONFIGURED);
  return {
    adapters: {
      gdelt: {
        state: state(config.gdelt.enabled, gdeltConfigured),
        configured: gdeltConfigured,
        sourceHost: GDELT_HOST,
        articleAllowlistCount: config.gdelt.articleDomains.length,
      },
      official_rss: {
        state: state(config.rss.enabled, rssConfigured),
        configured: rssConfigured,
        feedCount: config.rss.feeds.length,
      },
      manual: {
        state: state(config.manual.enabled, manualConfigured),
        configured: manualConfigured,
        sourceAllowlistCount: config.manual.sourceDomains.length,
      },
    },
  };
}

function assertAdapterConfigured(overview, adapter) {
  const status = overview.adapters[adapter];
  if (status?.state !== ADAPTER_STATES.CONFIGURED) {
    throw new SocialGrowthResearchAdapterError(`${adapter} research adapter is not configured`, {
      code: status?.state || ADAPTER_STATES.NOT_CONFIGURED,
      adapter,
    });
  }
}

async function collectGdeltSignals({ settings = {}, dependencies = {}, query = null, now = new Date() } = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = getResearchAdapterOverview({ settings, dependencies });
  assertAdapterConfigured(overview, "gdelt");
  const searchQuery = sanitizeUntrustedResearchText(query || config.gdelt.query, 300);
  if (!searchQuery || detectPromptInjection(searchQuery).length) {
    throw new SocialGrowthResearchAdapterError("GDELT query is invalid or contains instruction-like input", {
      code: "INVALID_RESEARCH_QUERY",
      adapter: "gdelt",
    });
  }
  if (!/^\d{1,3}(?:min|h|d|w)$/i.test(config.gdelt.timespan)) {
    throw new SocialGrowthResearchAdapterError("GDELT timespan is invalid", { code: "INVALID_CONFIGURATION", adapter: "gdelt" });
  }
  const endpoint = await assertAllowedPublicUrl(config.gdelt.endpoint, {
    allowedDomains: [GDELT_HOST],
    blockedDomains: config.blockedDomains,
    lookup: dependencies.lookup || dns.lookup,
    exactHosts: true,
    timeoutMs: config.timeoutMs,
  });
  const client = dependencies.httpClient || axios;
  if (!client || typeof client.request !== "function") {
    throw new SocialGrowthResearchAdapterError("HTTP client is unavailable", { code: "HTTP_CLIENT_UNAVAILABLE", adapter: "gdelt" });
  }
  let response;
  try {
    response = await withDeadline(() => client.request({
      method: "GET",
      url: endpoint,
      params: {
        query: searchQuery,
        mode: "ArtList",
        format: "json",
        maxrecords: config.gdelt.maxRecords,
        timespan: config.gdelt.timespan,
        sort: "HybridRel",
      },
      timeout: config.timeoutMs,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      headers: { "User-Agent": "PinkPaisaSocialResearch/1.0 (+https://pinkpaisa.in)" },
    }), config.timeoutMs, "GDELT research request");
  } catch (error) {
    throw adapterError(error, "gdelt");
  }

  const sources = [];
  const signals = [];
  const rejected = [];
  const validationDeadline = Date.now() + config.timeoutMs;
  for (const [index, article] of (Array.isArray(response?.data?.articles) ? response.data.articles : []).slice(0, config.gdelt.maxRecords).entries()) {
    const unsafeText = [article?.title, article?.domain, article?.sourcecountry, article?.seendate]
      .map((value) => value || "")
      .join("\n");
    const flags = detectPromptInjection(unsafeText);
    if (flags.length) {
      rejected.push({ index, reason: "GDELT article contained instruction-like text", flags });
      continue;
    }
    const remainingMs = validationDeadline - Date.now();
    if (remainingMs <= 0) {
      rejected.push({ index, reason: "GDELT article validation timed out", flags: ["source_validation_timeout"] });
      continue;
    }
    let safeUrl;
    try {
      safeUrl = await assertAllowedPublicUrl(article?.url, {
        allowedDomains: config.gdelt.articleDomains,
        blockedDomains: config.blockedDomains,
        lookup: dependencies.lookup || dns.lookup,
        timeoutMs: remainingMs,
      });
    } catch (error) {
      rejected.push({ index, reason: error.message, flags: ["source_url_rejected"] });
      continue;
    }
    const source = buildSource({
      key: `gdelt-${index + 1}`,
      title: article.title,
      url: safeUrl,
      publisher: article.domain || article.sourcecountry,
      publishedAt: article.seendate,
      excerpt: article.title,
      claimSupported: article.title,
      sourceType: "news_index",
      now,
      validationStatus: "gdelt_index_unverified",
    });
    sources.push(source);
    signals.push(buildSignal(source, {
      id: source.source_key,
      category: "external_gdelt",
      confidence: 0.35,
      requiresHumanReview: true,
    }));
  }
  return {
    adapter: "gdelt",
    state: ADAPTER_STATES.OK,
    signals,
    sources,
    rejected,
    query: searchQuery,
    evidence_notice: "GDELT is a discovery index. Every returned article remains untrusted and requires direct-source verification.",
  };
}

function normalizeFeed(feed, index, config) {
  const name = sanitizeUntrustedResearchText(feed?.name, 120);
  const url = trimValue(feed?.url);
  if (!name || !url || feed?.official !== true) {
    throw new SocialGrowthResearchAdapterError(`Official RSS feed ${index + 1} requires name, URL, and official=true`, {
      code: "INVALID_RSS_CONFIGURATION",
      adapter: "official_rss",
    });
  }
  const domain = sourceDomain(url);
  const allowlist = config.rss.articleDomains.length ? config.rss.articleDomains : [domain];
  assertSafeExternalSourceUrl(url, { allowedDomains: allowlist, blockedDomains: config.blockedDomains });
  return {
    name,
    url,
    category: sanitizeUntrustedResearchText(feed.category || "official", 80).toLowerCase(),
    primary_source: true,
  };
}

async function collectOfficialRssSignals({ settings = {}, dependencies = {}, now = new Date() } = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = getResearchAdapterOverview({ settings, dependencies });
  assertAdapterConfigured(overview, "official_rss");
  const feeds = config.rss.feeds.slice(0, 20).map((feed, index) => normalizeFeed(feed, index, config));
  const rssLookup = dependencies.rssLookup || dns.lookup;
  let collection;
  try {
    collection = await withDeadline(
      () => dailyPredictionService.collectTrustedFeedItems(feeds, {
        now,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
        lookup: (hostname, options) => withDeadline(
          () => rssLookup(hostname, options),
          config.timeoutMs,
          "Official RSS DNS lookup"
        ),
      }),
      config.timeoutMs,
      "Official RSS research"
    );
  } catch (error) {
    throw adapterError(error, "official_rss");
  }
  const sources = [];
  const signals = [];
  const rejected = (collection.feed_health || [])
    .filter((feed) => !feed.ok)
    .map((feed) => ({ source: sanitizeUntrustedResearchText(feed.name, 120), reason: sanitizeUntrustedResearchText(feed.error, 300), flags: ["rss_feed_failed"] }));
  const validationDeadline = Date.now() + config.timeoutMs;
  for (const [index, item] of (collection.items || []).slice(0, 100).entries()) {
    const flags = detectPromptInjection(`${item.title}\n${item.summary}`);
    if (flags.length) {
      rejected.push({ source: item.source, reason: "RSS item contained instruction-like text", flags });
      continue;
    }
    const remainingMs = validationDeadline - Date.now();
    if (remainingMs <= 0) {
      rejected.push({ source: item.source, reason: "RSS article validation timed out", flags: ["source_validation_timeout"] });
      continue;
    }
    let safeUrl;
    try {
      safeUrl = await assertAllowedPublicUrl(item.url, {
        allowedDomains: config.rss.articleDomains.length ? config.rss.articleDomains : [item.source_host],
        blockedDomains: config.blockedDomains,
        lookup: rssLookup,
        timeoutMs: remainingMs,
      });
    } catch (error) {
      rejected.push({ source: item.source, reason: error.message, flags: ["source_url_rejected"] });
      continue;
    }
    const source = buildSource({
      key: `official-rss-${index + 1}`,
      title: item.title,
      url: safeUrl,
      publisher: item.source,
      publishedAt: item.published_at,
      excerpt: item.summary,
      claimSupported: item.title,
      sourceType: "official_rss",
      now,
      validationStatus: "official_rss_unverified_claim",
    });
    sources.push(source);
    signals.push(buildSignal(source, {
      category: item.category || "official",
      confidence: 0.65,
      requiresHumanReview: true,
    }));
  }
  return {
    adapter: "official_rss",
    state: ADAPTER_STATES.OK,
    signals,
    sources,
    rejected,
    feed_health: collection.feed_health || [],
    evidence_notice: "Feed ownership is configured as official, but each claim still requires direct-source review before publication.",
  };
}

async function normalizeManualSignal(signal, { settings = {}, dependencies = {}, now = new Date() } = {}) {
  const config = normalizeSettings(settings, dependencies);
  const overview = getResearchAdapterOverview({ settings, dependencies });
  assertAdapterConfigured(overview, "manual");
  const flags = detectPromptInjection([
    signal?.sourceTitle,
    signal?.headline,
    signal?.title,
    signal?.summary,
    signal?.claimSupported,
    signal?.publisher,
    signal?.category,
  ].map((value) => value || "").join("\n"));
  if (flags.length) {
    throw new SocialGrowthResearchAdapterError("Manual signal contains instruction-like untrusted text", {
      code: "PROMPT_INJECTION_REJECTED",
      adapter: "manual",
    });
  }
  const safeUrl = await assertAllowedPublicUrl(signal?.sourceUrl || signal?.url, {
    allowedDomains: config.manual.sourceDomains,
    blockedDomains: config.blockedDomains,
    lookup: dependencies.lookup || dns.lookup,
    timeoutMs: config.timeoutMs,
  });
  const source = buildSource({
    key: `manual-${sanitizeUntrustedResearchText(signal?.id || "signal", 80).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`,
    title: signal?.sourceTitle || signal?.headline || signal?.title,
    url: safeUrl,
    publisher: signal?.publisher || sourceDomain(safeUrl),
    publishedAt: signal?.publishedAt,
    excerpt: signal?.summary,
    claimSupported: signal?.claimSupported,
    sourceType: "manual",
    now,
    validationStatus: "manual_unverified",
  });
  return {
    adapter: "manual",
    state: ADAPTER_STATES.OK,
    source,
    signal: buildSignal(source, {
      category: signal?.category || "manual",
      confidence: Math.min(Number(signal?.confidence || 0.25), 0.5),
      requiresHumanReview: true,
    }),
    evidence_notice: "Manual signals are untrusted suggestions and cannot become publishable evidence without separate verification.",
  };
}

async function collectSocialGrowthResearchSignals({
  settings = {},
  dependencies = {},
  gdeltQuery = null,
  manualSignals = [],
  now = new Date(),
} = {}) {
  const overview = getResearchAdapterOverview({ settings, dependencies });
  const tasks = [];
  if (overview.adapters.gdelt.state === ADAPTER_STATES.CONFIGURED) {
    tasks.push(collectGdeltSignals({ settings, dependencies, query: gdeltQuery, now }).catch((error) => ({
      adapter: "gdelt", state: ADAPTER_STATES.ERROR, signals: [], sources: [], rejected: [{ reason: adapterError(error, "gdelt").message, flags: [error.code || "gdelt_failed"] }],
    })));
  }
  if (overview.adapters.official_rss.state === ADAPTER_STATES.CONFIGURED) {
    tasks.push(collectOfficialRssSignals({ settings, dependencies, now }).catch((error) => ({
      adapter: "official_rss", state: ADAPTER_STATES.ERROR, signals: [], sources: [], rejected: [{ reason: adapterError(error, "official_rss").message, flags: [error.code || "rss_failed"] }],
    })));
  }
  if (overview.adapters.manual.state === ADAPTER_STATES.CONFIGURED) {
    for (const manualSignal of (Array.isArray(manualSignals) ? manualSignals : []).slice(0, 20)) {
      tasks.push(normalizeManualSignal(manualSignal, { settings, dependencies, now })
        .then((result) => ({ adapter: "manual", state: result.state, signals: [result.signal], sources: [result.source], rejected: [] }))
        .catch((error) => ({ adapter: "manual", state: ADAPTER_STATES.ERROR, signals: [], sources: [], rejected: [{ reason: adapterError(error, "manual").message, flags: [error.code || "manual_failed"] }] })));
    }
  }
  const results = await Promise.all(tasks);
  return {
    overview,
    adapters: results.map((result) => ({ adapter: result.adapter, state: result.state })),
    signals: results.flatMap((result) => result.signals || []),
    sources: results.flatMap((result) => result.sources || []),
    rejected: results.flatMap((result) => (result.rejected || []).map((entry) => ({ adapter: result.adapter, ...entry }))),
    allSignalsRequireHumanReview: true,
  };
}

function createSocialGrowthResearchAdapters({ settings = {}, dependencies = {} } = {}) {
  return {
    getOverview: () => getResearchAdapterOverview({ settings, dependencies }),
    collectGdeltSignals: (options = {}) => collectGdeltSignals({ ...options, settings, dependencies }),
    collectOfficialRssSignals: (options = {}) => collectOfficialRssSignals({ ...options, settings, dependencies }),
    normalizeManualSignal: (signal, options = {}) => normalizeManualSignal(signal, { ...options, settings, dependencies }),
    collectSignals: (options = {}) => collectSocialGrowthResearchSignals({ ...options, settings, dependencies }),
  };
}

module.exports = {
  ADAPTER_STATES,
  SocialGrowthResearchAdapterError,
  collectGdeltSignals,
  collectOfficialRssSignals,
  collectSocialGrowthResearchSignals,
  createSocialGrowthResearchAdapters,
  getResearchAdapterOverview,
  normalizeManualSignal,
  _private: {
    assertAllowedPublicUrl,
    buildSignal,
    buildSource,
    isPrivateIp,
    normalizeFeed,
    normalizeSettings,
  },
};
