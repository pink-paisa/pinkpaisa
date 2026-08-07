const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const { XMLParser } = require("fast-xml-parser");
const { getRedisClient, hasRedisUrl } = require("../utils/redisClient");
const { getJwtSecret } = require("../utils/authConfig");
const logger = require("../utils/logger");
const { normalizePredictionVoteAttribution } = require("../utils/predictionVoteAttribution");
const {
  getPredictionSettings,
  MAX_DAILY_QUESTIONS,
  MIN_DAILY_QUESTIONS,
} = require("../utils/predictionSettings");

const IST_OFFSET_MS = 330 * 60 * 1000;
const MAX_FEED_BYTES = 1024 * 1024;
const FEED_TIMEOUT_MS = 12000;
const GENERATION_TIMEOUT_MS = 90000;
const DAILY_VOTE_IP_LIMIT = 30;
const REDIS_EXPIRY_GRACE_SECONDS = 30 * 60;
const ALLOWED_CATEGORIES = new Set([
  "politics",
  "finance",
  "business",
  "workplace",
  "sports",
  "policy",
  "tech",
  "economy",
  "education",
  "lifestyle",
  "environment",
]);
const DEFAULT_FEEDS = [
  {
    name: "Reserve Bank of India - Press Releases",
    url: "https://rbi.org.in/pressreleases_rss.xml",
    category: "finance",
    primary_source: true,
  },
  {
    name: "Reserve Bank of India - Notifications",
    url: "https://rbi.org.in/notifications_rss.xml",
    category: "policy",
    primary_source: true,
  },
];
const INDIA_RELEVANCE_TERMS = [
  "india", "indian", "rbi", "reserve bank", "sebi", "government", "parliament",
  "rupee", "crore", "lakh", "delhi", "mumbai", "bengaluru", "women", "woman",
  "startup", "upi", "gst", "budget", "ministry", "supreme court",
];
const AUDIENCE_RELEVANCE_TERMS = [
  "women", "woman", "money", "finance", "saving", "investment", "workplace",
  "career", "health", "wellness", "education", "technology", "business", "policy",
  "environment", "sport", "entrepreneur", "employment", "inflation",
];
const QUESTION_PROHIBITED_PATTERNS = [
  /\b(?:stock|share|crypto|bitcoin|ethereum)\b.{0,30}\b(?:rise|fall|price|target|buy|sell)\b/i,
  /\b(?:cure|treat|diagnose|medicine|dosage)\b/i,
  /\b(?:guilty|murderer|criminal|fraudster|terrorist)\b/i,
  /\b(?:death toll|will die|casualties|victims?)\b/i,
  /\b(?:bet|wager|odds|guaranteed|sure shot)\b/i,
  /\b(?:hate|inferior|superior)\b.{0,30}\b(?:religion|caste|race|gender)\b/i,
];
const QUESTION_START_PATTERN = /^(?:do|does|did|will|would|should|can|could|is|are|has|have)\b/i;
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were",
  "will", "with", "after", "over", "new", "says", "said",
]);

function trimText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stripHtml(value) {
  return trimText(String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " "), 600);
}

function clampCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 15;
  return Math.min(Math.max(parsed, MIN_DAILY_QUESTIONS), MAX_DAILY_QUESTIONS);
}

function getIstDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return [shifted.getUTCFullYear(), String(shifted.getUTCMonth() + 1).padStart(2, "0"), String(shifted.getUTCDate()).padStart(2, "0")].join("-");
}

function getIstParts(date = new Date()) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function getNextGenerationDate(date, hour, minute) {
  const parts = getIstParts(date);
  let localTarget = Date.UTC(parts.year, parts.month, parts.day, hour, minute, 0, 0);
  const localNow = date.getTime() + IST_OFFSET_MS;
  if (localTarget <= localNow) localTarget += 24 * 60 * 60 * 1000;
  return new Date(localTarget - IST_OFFSET_MS);
}

function secondsUntilExpiry(expiresAt, now = new Date()) {
  return Math.max(Math.ceil((expiresAt.getTime() - now.getTime()) / 1000) + REDIS_EXPIRY_GRACE_SECONDS, 60);
}

function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] === 0;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:");
}

async function assertSafeFeedUrl(value, allowedHosts, lookup = dns.lookup) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("RSS feed URL is invalid");
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") throw new Error("RSS feed URL must use HTTPS");
  if (!allowedHosts.has(host)) throw new Error(`RSS feed host is not approved: ${host}`);
  if (["localhost", "localhost.localdomain"].includes(host)) throw new Error("Local RSS hosts are not allowed");

  const literalIp = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!literalIp.length || literalIp.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`RSS feed host resolved to a private address: ${host}`);
  }
  return parsed;
}

function parseFeedConfiguration(rawValue = process.env.PREDICTIONS_RSS_FEEDS_JSON) {
  let values = [];
  const raw = String(rawValue || "").trim();
  if (raw) {
    try {
      values = JSON.parse(raw);
    } catch {
      throw new Error("PREDICTIONS_RSS_FEEDS_JSON must be valid JSON");
    }
    if (!Array.isArray(values)) throw new Error("PREDICTIONS_RSS_FEEDS_JSON must be an array");
  }
  const configured = values.length ? values : DEFAULT_FEEDS;
  const seen = new Set();
  return configured.map((entry, index) => {
    const name = trimText(entry?.name, 120);
    const url = trimText(entry?.url, 500);
    const category = ALLOWED_CATEGORIES.has(String(entry?.category || "").toLowerCase())
      ? String(entry.category).toLowerCase()
      : "policy";
    if (!name || !url) throw new Error(`RSS feed ${index + 1} requires name and URL`);
    const normalizedUrl = new URL(url).toString();
    if (seen.has(normalizedUrl)) throw new Error(`Duplicate RSS feed URL: ${normalizedUrl}`);
    seen.add(normalizedUrl);
    return {
      name,
      url: normalizedUrl,
      category,
      primary_source: entry?.primary_source === true,
    };
  });
}

async function readLimitedBody(response, maxBytes = MAX_FEED_BYTES) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("RSS feed response exceeded the size limit");
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("RSS feed response exceeded the size limit");
    return buffer.toString("utf8");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("RSS feed response exceeded the size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchFeedXml(feed, allFeeds, { fetchImpl = fetch, lookup = dns.lookup } = {}) {
  const allowedHosts = new Set(allFeeds.map(({ url }) => new URL(url).hostname.toLowerCase()));
  let currentUrl = feed.url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);

  try {
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      await assertSafeFeedUrl(currentUrl, allowedHosts, lookup);
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "PinkPaisaPredictions/1.0 (+https://pinkpaisa.in/predictions)" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("RSS feed redirect did not include a location");
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!response.ok) throw new Error(`RSS feed returned HTTP ${response.status}`);
      return await readLimitedBody(response);
    }
    throw new Error("RSS feed exceeded the redirect limit");
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("RSS feed request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function extractLink(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const alternate = value.find((entry) => !entry?.rel || entry.rel === "alternate");
    return extractLink(alternate || value[0]);
  }
  return value?.href || value?.url || value?.["#text"] || "";
}

function isSafeSourceLink(articleUrl, feedUrl) {
  try {
    const article = new URL(articleUrl);
    const feed = new URL(feedUrl);
    if (article.protocol !== "https:") return false;
    const normalizeHost = (host) => host.toLowerCase().replace(/^www\./, "");
    const articleHost = normalizeHost(article.hostname);
    const feedHost = normalizeHost(feed.hostname);
    return articleHost === feedHost
      || articleHost.endsWith(`.${feedHost}`)
      || feedHost.endsWith(`.${articleHost}`);
  } catch {
    return false;
  }
}

function parseFeedItems(xml, feed, now = new Date()) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text" });
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    throw new Error(`RSS feed XML could not be parsed: ${error.message}`);
  }
  const rssItems = asArray(parsed?.rss?.channel?.item);
  const atomItems = asArray(parsed?.feed?.entry);
  const items = rssItems.length ? rssItems : atomItems;
  if (!items.length) throw new Error("RSS feed did not contain any items");
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;

  return items.slice(0, 80).map((item) => {
    const publishedValue = item.pubDate || item.published || item.updated || item["dc:date"];
    const publishedAt = new Date(publishedValue);
    let url = extractLink(item.link);
    try {
      url = new URL(url).toString();
    } catch {
      url = "";
    }
    return {
      title: trimText(item.title?.["#text"] || item.title, 240),
      summary: stripHtml(item.description || item.summary || item.content?.["#text"] || item.content),
      url,
      source: feed.name,
      source_host: new URL(feed.url).hostname.toLowerCase(),
      category: feed.category,
      primary_source: feed.primary_source,
      published_at: Number.isNaN(publishedAt.getTime()) ? null : publishedAt.toISOString(),
    };
  }).filter((item) => item.title
    && item.url
    && isSafeSourceLink(item.url, feed.url)
    && item.published_at
    && new Date(item.published_at).getTime() >= cutoff);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function collectFeedItems(feeds, options = {}) {
  const feedHealth = [];
  const batches = await mapWithConcurrency(feeds, 3, async (feed) => {
    try {
      const xml = await fetchFeedXml(feed, feeds, options);
      const items = parseFeedItems(xml, feed, options.now || new Date());
      feedHealth.push({ name: feed.name, url: feed.url, ok: true, item_count: items.length, error: null });
      logger.info({ source: feed.name, itemCount: items.length }, "prediction RSS feed fetched");
      return items;
    } catch (error) {
      feedHealth.push({ name: feed.name, url: feed.url, ok: false, item_count: 0, error: trimText(error.message, 240) });
      logger.warn({ source: feed.name, err: error }, "prediction RSS feed failed");
      return [];
    }
  });
  return { items: batches.flat(), feed_health: feedHealth };
}

function tokenize(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

function jaccardSimilarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left);
  const b = right instanceof Set ? right : tokenize(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => { if (b.has(token)) intersection += 1; });
  return intersection / (a.size + b.size - intersection);
}

function includesAny(value, terms) {
  const normalized = String(value || "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function clusterFeedItems(items, now = new Date()) {
  const exactSeen = new Set();
  const clusters = [];
  for (const item of items) {
    const exactKey = trimText(item.title, 240).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!exactKey || exactSeen.has(exactKey)) continue;
    exactSeen.add(exactKey);
    const tokens = tokenize(`${item.title} ${item.summary}`);
    let cluster = clusters.find((candidate) => jaccardSimilarity(tokens, candidate.tokens) >= 0.42);
    if (!cluster) {
      cluster = { id: `topic-${clusters.length + 1}`, items: [], tokens: new Set(tokens), category: item.category };
      clusters.push(cluster);
    }
    cluster.items.push(item);
    tokens.forEach((token) => cluster.tokens.add(token));
  }

  return clusters.map((cluster) => {
    const sourceCount = new Set(cluster.items.map((item) => item.source_host)).size;
    const primary = cluster.items.some((item) => item.primary_source);
    const newestTime = Math.max(...cluster.items.map((item) => new Date(item.published_at).getTime()));
    const ageHours = Math.max((now.getTime() - newestTime) / (60 * 60 * 1000), 0);
    const combined = cluster.items.map((item) => `${item.title} ${item.summary}`).join(" ");
    const indiaRelevant = primary || includesAny(combined, INDIA_RELEVANCE_TERMS);
    const audienceRelevant = includesAny(combined, AUDIENCE_RELEVANCE_TERMS);
    const score = Math.max(24 - ageHours, 0) + sourceCount * 12 + (primary ? 16 : 0) + (indiaRelevant ? 18 : 0) + (audienceRelevant ? 8 : 0);
    return {
      id: cluster.id,
      category: cluster.category,
      source_count: sourceCount,
      primary_source: primary,
      india_relevant: indiaRelevant,
      score: Math.round(score * 100) / 100,
      items: cluster.items.sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 4),
    };
  }).filter((cluster) => cluster.india_relevant && (cluster.primary_source || cluster.source_count >= 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
}

function buildPredictionRequest(clusters, desiredCount, model) {
  const candidateCount = Math.min(MAX_DAILY_QUESTIONS, Math.max(desiredCount + 5, MIN_DAILY_QUESTIONS));
  const topics = clusters.map((cluster) => ({
    topic_id: cluster.id,
    suggested_category: cluster.category,
    sources: cluster.items.map((item) => ({
      source: item.source,
      title: item.title,
      summary: item.summary,
      published_at: item.published_at,
    })),
  }));
  return {
    model,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: [
            "Create safe, current yes/no community questions for Pink Paisa, an India-focused women-first platform.",
            "Use only the supplied RSS facts. Never add names, claims, numbers, outcomes, or context not present in the sources.",
            "Questions may be opinions or short-term forecasts, but must be neutral, concise, and understandable without sensational wording.",
            "Do not create stock or crypto price predictions, medical advice, allegations of guilt, tragedy outcomes, betting language, hate content, or claims that the poll represents all Indian women.",
            `Return ${candidateCount} candidates across multiple categories, with no more than three candidates per category.`,
          ].join("\n"),
        }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify({ desired_count: desiredCount, topics }) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pinkpaisa_daily_predictions",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["questions"],
          properties: {
            questions: {
              type: "array",
              minItems: MIN_DAILY_QUESTIONS,
              maxItems: MAX_DAILY_QUESTIONS,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["topic_id", "question", "category", "image_emoji", "question_type"],
                properties: {
                  topic_id: { type: "string" },
                  question: { type: "string", minLength: 15, maxLength: 180 },
                  category: { type: "string", enum: Array.from(ALLOWED_CATEGORIES) },
                  image_emoji: { type: "string", minLength: 1, maxLength: 12 },
                  question_type: { type: "string", enum: ["opinion", "short_term_forecast"] },
                },
              },
            },
          },
        },
      },
    },
  };
}

function extractResponseText(payload = {}) {
  if (trimText(payload.output_text, 20000)) return trimText(payload.output_text, 20000);
  for (const item of asArray(payload.output)) {
    for (const part of asArray(item?.content)) {
      if (trimText(part?.text, 20000)) return trimText(part.text, 20000);
    }
  }
  return "";
}

async function requestPredictionCandidates(clusters, count, { fetchImpl = fetch } = {}) {
  const apiKey = trimText(process.env.OPENAI_API_KEY, 500);
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for daily prediction generation");
  const model = trimText(process.env.OPENAI_PREDICTIONS_MODEL || process.env.OPENAI_CAPTION_MODEL, 120);
  if (!model) throw new Error("OPENAI_PREDICTIONS_MODEL or OPENAI_CAPTION_MODEL is required");
  const baseUrl = trimText(process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1", 500).replace(/\/+$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildPredictionRequest(clusters, count, model)),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message || "OpenAI prediction generation failed");
    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI prediction generation returned no structured output");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.questions)) throw new Error("OpenAI prediction output is missing questions");
    return { questions: parsed.questions, model };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OpenAI prediction generation timed out");
    if (error instanceof SyntaxError) throw new Error("OpenAI prediction output was not valid JSON");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validatePredictionCandidates(candidates, clusters, { count, dateKey, generatedAt, expiresAt }) {
  const clusterMap = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const accepted = [];
  const rejected = [];
  const categoryCounts = new Map();
  for (const candidate of candidates) {
    const question = trimText(candidate?.question, 180);
    const category = String(candidate?.category || "").trim().toLowerCase();
    const cluster = clusterMap.get(String(candidate?.topic_id || ""));
    let code = null;
    if (!cluster) code = "unknown_topic";
    else if (!ALLOWED_CATEGORIES.has(category)) code = "invalid_category";
    else if (!question.endsWith("?") || !QUESTION_START_PATTERN.test(question)) code = "not_clear_yes_no";
    else if (question.length < 15) code = "question_too_short";
    else if (QUESTION_PROHIBITED_PATTERNS.some((pattern) => pattern.test(question))) code = "unsafe_topic";
    else if ((categoryCounts.get(category) || 0) >= 3) code = "category_limit";
    else if (accepted.some((item) => jaccardSimilarity(item.question, question) >= 0.72)) code = "duplicate_question";

    if (code) {
      rejected.push({ code, question: question || null, topic_id: candidate?.topic_id || null });
      continue;
    }

    const sourceRefs = cluster.items.slice(0, 2).map((item) => ({
      source: item.source,
      title: item.title,
      url: item.url,
      published_at: item.published_at,
    }));
    if (!sourceRefs.length || sourceRefs.some((source) => !source.url.startsWith("https://"))) {
      rejected.push({ code: "missing_safe_source", question, topic_id: candidate.topic_id });
      continue;
    }
    categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    accepted.push({
      id: crypto.createHash("sha256").update(`${dateKey}:${question}`).digest("hex").slice(0, 24),
      question,
      category,
      image_emoji: trimText(candidate.image_emoji, 12) || "📊",
      question_type: ["opinion", "short_term_forecast"].includes(candidate.question_type)
        ? candidate.question_type
        : "opinion",
      source_refs: sourceRefs,
      generated_at: generatedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    if (accepted.length >= count) break;
  }
  if (accepted.length < MIN_DAILY_QUESTIONS) {
    const error = new Error(`Only ${accepted.length} safe prediction questions passed validation; at least ${MIN_DAILY_QUESTIONS} are required`);
    error.code = "insufficient_safe_questions";
    error.rejected = rejected;
    throw error;
  }
  return { accepted, rejected };
}

function getRedisKeys(dateKey) {
  return {
    current: "predictions:daily:current",
    batch: `predictions:daily:${dateKey}:batch`,
    status: `predictions:daily:${dateKey}:status`,
    lock: `predictions:daily:${dateKey}:generation-lock`,
    attempt: (attemptKey) => `predictions:daily:${dateKey}:attempt:${attemptKey}`,
    poll: (pollId) => `predictions:daily:${dateKey}:poll:${pollId}`,
    vote: (pollId, voterHash) => `predictions:daily:${dateKey}:vote:${pollId}:${voterHash}`,
    ipLimit: (ipHash) => `predictions:daily:${dateKey}:ip-limit:${ipHash}`,
    voteStats: `predictions:daily:${dateKey}:vote-stats`,
    voters: `predictions:daily:${dateKey}:voters`,
  };
}

async function setGenerationStatus(redis, dateKey, status, ttlSeconds) {
  await redis.set(getRedisKeys(dateKey).status, JSON.stringify(status), { EX: ttlSeconds });
}

async function publishBatch(redis, batch, ttlSeconds) {
  const keys = getRedisKeys(batch.date_key);
  const multi = redis.multi();
  multi.set(keys.batch, JSON.stringify(batch), { EX: ttlSeconds });
  batch.questions.forEach((question) => {
    multi.hSet(keys.poll(question.id), {
      yes_count: "0",
      no_count: "0",
      beta_launch_votes: "0",
      organic_votes: "0",
    });
    multi.expire(keys.poll(question.id), ttlSeconds);
  });
  multi.hSet(keys.voteStats, {
    accepted_votes: "0",
    beta_launch_votes: "0",
    organic_votes: "0",
    duplicate_attempts: "0",
    rate_limited_attempts: "0",
  });
  multi.expire(keys.voteStats, ttlSeconds);
  multi.set(keys.current, keys.batch, { EX: ttlSeconds });
  await multi.exec();
}

async function getCurrentBatch(redis) {
  const batchKey = await redis.get("predictions:daily:current");
  if (!batchKey) return null;
  const raw = await redis.get(batchKey);
  if (!raw) return null;
  const batch = JSON.parse(raw);
  if (!batch?.expires_at || new Date(batch.expires_at).getTime() <= Date.now()) return null;
  return batch;
}

async function serializePublicBatch(redis, batch) {
  const keys = getRedisKeys(batch.date_key);
  const questions = await Promise.all(batch.questions.map(async (question) => {
    const counts = await redis.hGetAll(keys.poll(question.id));
    return {
      id: question.id,
      question: question.question,
      category: question.category,
      image_emoji: question.image_emoji,
      question_type: question.question_type,
      source_refs: question.source_refs,
      generated_at: question.generated_at,
      expires_at: question.expires_at,
      yes_count: Number(counts.yes_count || 0),
      no_count: Number(counts.no_count || 0),
      comments_enabled: false,
      source_type: "ai_daily",
    };
  }));
  return {
    enabled: true,
    status: "live",
    batch_id: batch.batch_id,
    date_key: batch.date_key,
    generated_at: batch.generated_at,
    expires_at: batch.expires_at,
    questions,
  };
}

async function getDailyVoteAnalytics(redis, batch) {
  const keys = getRedisKeys(batch.date_key);
  const rows = await Promise.all(batch.questions.map(async (question) => {
    const counts = await redis.hGetAll(keys.poll(question.id));
    const yesCount = Number(counts.yes_count || 0);
    const noCount = Number(counts.no_count || 0);
    const totalVotes = yesCount + noCount;
    const betaVotes = Math.min(Number(counts.beta_launch_votes || 0), totalVotes);
    return {
      id: question.id,
      question: question.question,
      source_type: "ai_daily",
      total_votes: totalVotes,
      beta_launch_votes: betaVotes,
      organic_votes: Math.max(totalVotes - betaVotes, 0),
    };
  }));
  const stats = await redis.hGetAll(keys.voteStats);
  const uniqueVoters = typeof redis.sCard === "function" ? await redis.sCard(keys.voters) : 0;
  return {
    total_genuine_votes: rows.reduce((sum, row) => sum + row.total_votes, 0),
    beta_launch_votes: rows.reduce((sum, row) => sum + row.beta_launch_votes, 0),
    organic_votes: rows.reduce((sum, row) => sum + row.organic_votes, 0),
    unique_voting_fingerprints: Number(uniqueVoters || 0),
    duplicate_attempts: Number(stats.duplicate_attempts || 0),
    rate_limited_attempts: Number(stats.rate_limited_attempts || 0),
    by_prediction: rows,
  };
}

async function serializeAdminBatch(redis, batch) {
  const publicBatch = await serializePublicBatch(redis, batch);
  const voteAnalytics = await getDailyVoteAnalytics(redis, batch);
  const analyticsById = new Map(voteAnalytics.by_prediction.map((row) => [row.id, row]));
  return {
    ...publicBatch,
    questions: publicBatch.questions.map((question) => ({
      ...question,
      beta_launch_votes: analyticsById.get(question.id)?.beta_launch_votes || 0,
      organic_votes: analyticsById.get(question.id)?.organic_votes || 0,
    })),
    vote_analytics: voteAnalytics,
  };
}

async function getPublicDailyPredictions() {
  const settings = await getPredictionSettings();
  const envEnabled = String(process.env.PREDICTIONS_AI_ENABLED || "false").toLowerCase() === "true";
  if (!settings.predictions_ai_enabled || !envEnabled) {
    return { enabled: false, status: "disabled", questions: [] };
  }
  if (!hasRedisUrl()) {
    const error = new Error("Daily predictions are temporarily unavailable because Redis is not configured");
    error.status = 503;
    throw error;
  }
  let redis;
  try {
    redis = await getRedisClient();
  } catch {
    const error = new Error("Daily predictions are temporarily unavailable because Redis could not be reached");
    error.status = 503;
    throw error;
  }
  if (!redis) {
    const error = new Error("Daily predictions are temporarily unavailable");
    error.status = 503;
    throw error;
  }
  const batch = await getCurrentBatch(redis);
  if (!batch) return { enabled: true, status: "empty", questions: [] };
  return serializePublicBatch(redis, batch);
}

function hashVoter(value) {
  return crypto.createHmac("sha256", getJwtSecret()).update(String(value || "unknown")).digest("hex");
}

async function castDailyPredictionVote({
  pollId,
  vote,
  fingerprint,
  ipAddress,
  voteSource,
  campaign,
  redis: providedRedis = null,
}) {
  if (!providedRedis && !hasRedisUrl()) {
    const error = new Error("Daily prediction voting is temporarily unavailable");
    error.status = 503;
    throw error;
  }
  if (!pollId || !["yes", "no"].includes(vote)) {
    const error = new Error("A valid prediction and vote are required");
    error.status = 400;
    throw error;
  }
  if (!trimText(fingerprint, 200)) {
    const error = new Error("Voter fingerprint is required");
    error.status = 400;
    throw error;
  }

  let redis = providedRedis;
  if (!redis) {
    try {
      redis = await getRedisClient();
    } catch {
      const error = new Error("Daily prediction voting is temporarily unavailable");
      error.status = 503;
      throw error;
    }
  }
  const batch = await getCurrentBatch(redis);
  if (!batch || !batch.questions.some((question) => question.id === pollId)) {
    const error = new Error("Prediction is unavailable or expired");
    error.status = 404;
    throw error;
  }
  const ttlSeconds = Math.max(Math.ceil((new Date(batch.expires_at).getTime() - Date.now()) / 1000), 60);
  const keys = getRedisKeys(batch.date_key);
  const voterHash = hashVoter(fingerprint);
  const ipHash = hashVoter(ipAddress);
  const attribution = normalizePredictionVoteAttribution({ voteSource, campaign });
  const script = `
    if redis.call('EXISTS', KEYS[1]) == 1 then
      redis.call('HINCRBY', KEYS[4], 'duplicate_attempts', 1)
      redis.call('EXPIRE', KEYS[4], ARGV[2])
      return {0}
    end
    local ipCount = tonumber(redis.call('GET', KEYS[3]) or '0')
    if ipCount >= tonumber(ARGV[3]) then
      redis.call('HINCRBY', KEYS[4], 'rate_limited_attempts', 1)
      redis.call('EXPIRE', KEYS[4], ARGV[2])
      return {-1}
    end
    if redis.call('EXISTS', KEYS[2]) == 0 then return {-2} end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
    local nextIpCount = redis.call('INCR', KEYS[3])
    if nextIpCount == 1 then redis.call('EXPIRE', KEYS[3], ARGV[2]) end
    local field = ARGV[1] == 'yes' and 'yes_count' or 'no_count'
    redis.call('HINCRBY', KEYS[2], field, 1)
    local sourceField = ARGV[4] == 'beta_launch' and 'beta_launch_votes' or 'organic_votes'
    redis.call('HINCRBY', KEYS[2], sourceField, 1)
    redis.call('HINCRBY', KEYS[4], 'accepted_votes', 1)
    redis.call('HINCRBY', KEYS[4], sourceField, 1)
    redis.call('EXPIRE', KEYS[4], ARGV[2])
    redis.call('SADD', KEYS[5], ARGV[5])
    redis.call('EXPIRE', KEYS[5], ARGV[2])
    local yesCount = tonumber(redis.call('HGET', KEYS[2], 'yes_count') or '0')
    local noCount = tonumber(redis.call('HGET', KEYS[2], 'no_count') or '0')
    return {1, yesCount, noCount}
  `;
  const result = await redis.eval(script, {
    keys: [
      keys.vote(pollId, voterHash),
      keys.poll(pollId),
      keys.ipLimit(ipHash),
      keys.voteStats,
      keys.voters,
    ],
    arguments: [vote, String(ttlSeconds), String(DAILY_VOTE_IP_LIMIT), attribution.vote_source, voterHash],
  });
  const code = Number(result?.[0]);
  if (code === 0) {
    const error = new Error("You have already voted on this prediction");
    error.status = 409;
    throw error;
  }
  if (code === -1) {
    const error = new Error("Daily prediction vote limit reached");
    error.status = 429;
    throw error;
  }
  if (code === -2) {
    const error = new Error("Prediction is unavailable or expired");
    error.status = 404;
    throw error;
  }
  logger.info({ pollId, dateKey: batch.date_key }, "daily prediction vote accepted");
  return { yes_count: Number(result[1]), no_count: Number(result[2]) };
}

async function recordDailyVoteRateLimit() {
  if (!hasRedisUrl()) return;
  try {
    const redis = await getRedisClient();
    const batch = redis ? await getCurrentBatch(redis) : null;
    if (!redis || !batch) return;
    const ttlSeconds = Math.max(Math.ceil((new Date(batch.expires_at).getTime() - Date.now()) / 1000), 60);
    const statsKey = getRedisKeys(batch.date_key).voteStats;
    await redis.hIncrBy(statsKey, "rate_limited_attempts", 1);
    await redis.expire(statsKey, ttlSeconds);
  } catch (error) {
    logger.warn({ err: error }, "daily prediction rate-limit metric could not be recorded");
  }
}

async function generateDailyPredictions({ force = false, now = new Date(), dependencies = {} } = {}) {
  const settings = await (dependencies.getSettings || getPredictionSettings)();
  const envEnabled = String(process.env.PREDICTIONS_AI_ENABLED || "false").toLowerCase() === "true";
  if (!envEnabled) throw new Error("PREDICTIONS_AI_ENABLED must be true before generating daily predictions");
  if (!settings.predictions_ai_enabled && !force) return { skipped: true, reason: "disabled" };
  if (!dependencies.redis && !hasRedisUrl()) throw new Error("REDIS_URL is required for temporary daily predictions");
  const redis = dependencies.redis || await getRedisClient();
  if (!redis) throw new Error("Redis is unavailable for temporary daily predictions");

  const dateKey = getIstDateKey(now);
  const keys = getRedisKeys(dateKey);
  const lockToken = crypto.randomUUID();
  const acquired = await redis.set(keys.lock, lockToken, { NX: true, EX: 9 * 60 });
  if (!acquired) return { skipped: true, reason: "generation_in_progress" };
  const expiresAt = getNextGenerationDate(now, settings.predictions_generation_hour_ist, settings.predictions_generation_minute_ist);
  const ttlSeconds = secondsUntilExpiry(expiresAt, now);
  let feedHealth = [];

  try {
    await setGenerationStatus(redis, dateKey, {
      status: "running",
      started_at: now.toISOString(),
      error: null,
    }, ttlSeconds);
    const feeds = parseFeedConfiguration();
    const collection = await (dependencies.collectFeeds || collectFeedItems)(feeds, { now });
    feedHealth = collection.feed_health;
    const clusters = (dependencies.clusterItems || clusterFeedItems)(collection.items, now);
    if (!clusters.length) throw new Error("No current India-relevant topics passed source validation");
    const count = clampCount(settings.predictions_daily_count);
    const generated = await (dependencies.generateCandidates || requestPredictionCandidates)(clusters, count);
    const validated = validatePredictionCandidates(generated.questions, clusters, {
      count,
      dateKey,
      generatedAt: now,
      expiresAt,
    });
    const batch = {
      batch_id: crypto.randomUUID(),
      date_key: dateKey,
      generated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      model: generated.model || "unknown",
      article_count: collection.items.length,
      topic_count: clusters.length,
      rejected_count: validated.rejected.length,
      questions: validated.accepted,
    };
    await publishBatch(redis, batch, ttlSeconds);
    const status = {
      status: "completed",
      generated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      article_count: collection.items.length,
      topic_count: clusters.length,
      accepted_count: validated.accepted.length,
      rejected_count: validated.rejected.length,
      rejection_codes: validated.rejected.reduce((acc, item) => {
        acc[item.code] = (acc[item.code] || 0) + 1;
        return acc;
      }, {}),
      feed_health: feedHealth,
      error: null,
    };
    await setGenerationStatus(redis, dateKey, status, ttlSeconds);
    logger.info({ dateKey, accepted: validated.accepted.length, rejected: validated.rejected.length }, "daily AI predictions published");
    return { skipped: false, batch: await serializePublicBatch(redis, batch), status };
  } catch (error) {
    await setGenerationStatus(redis, dateKey, {
      status: "failed",
      failed_at: new Date().toISOString(),
      feed_health: feedHealth,
      error: trimText(error.message, 300),
    }, ttlSeconds).catch(() => {});
    logger.error({ err: error, dateKey }, "daily AI prediction generation failed");
    throw error;
  } finally {
    const currentToken = await redis.get(keys.lock).catch(() => null);
    if (currentToken === lockToken) await redis.del(keys.lock).catch(() => {});
  }
}

function shouldAttemptScheduledGeneration(settings, now = new Date()) {
  const parts = getIstParts(now);
  const currentMinute = parts.hour * 60 + parts.minute;
  const scheduledMinute = settings.predictions_generation_hour_ist * 60 + settings.predictions_generation_minute_ist;
  return [0, 10, 20].some((offset) => currentMinute === (scheduledMinute + offset) % (24 * 60));
}

async function runDueDailyPredictions({ now = new Date() } = {}) {
  const settings = await getPredictionSettings();
  const envEnabled = String(process.env.PREDICTIONS_AI_ENABLED || "false").toLowerCase() === "true";
  if (!settings.predictions_ai_enabled || !envEnabled || !shouldAttemptScheduledGeneration(settings, now)) {
    return { skipped: true, reason: "not_due" };
  }
  if (!hasRedisUrl()) {
    logger.error("daily predictions skipped because REDIS_URL is missing");
    return { skipped: true, reason: "redis_missing" };
  }
  const redis = await getRedisClient();
  const existing = await getCurrentBatch(redis);
  if (existing?.date_key === getIstDateKey(now)) return { skipped: true, reason: "already_generated" };
  const parts = getIstParts(now);
  const attemptKey = `${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}`;
  const keys = getRedisKeys(getIstDateKey(now));
  const attemptClaimed = await redis.set(keys.attempt(attemptKey), "1", { NX: true, EX: 26 * 60 * 60 });
  if (!attemptClaimed) return { skipped: true, reason: "attempt_already_run" };
  return generateDailyPredictions({ now });
}

async function getAdminPredictionStatus() {
  const settings = await getPredictionSettings();
  const envEnabled = String(process.env.PREDICTIONS_AI_ENABLED || "false").toLowerCase() === "true";
  const openAiReady = Boolean(trimText(process.env.OPENAI_API_KEY, 500)
    && trimText(process.env.OPENAI_PREDICTIONS_MODEL || process.env.OPENAI_CAPTION_MODEL, 120));
  let feeds = [];
  let feedConfigurationError = null;
  try {
    feeds = parseFeedConfiguration().map(({ name, url, category, primary_source }) => ({ name, url, category, primary_source }));
  } catch (error) {
    feedConfigurationError = error.message;
  }
  if (!hasRedisUrl()) {
    return {
      ...settings,
      env_enabled: envEnabled,
      openai_ready: openAiReady,
      redis_ready: false,
      can_generate: false,
      disabled_reason: "REDIS_URL is required",
      feeds,
      feed_configuration_error: feedConfigurationError,
      current_batch: null,
      last_status: null,
    };
  }
  let redis;
  try {
    redis = await getRedisClient();
  } catch {
    return {
      ...settings,
      env_enabled: envEnabled,
      openai_ready: openAiReady,
      redis_ready: false,
      can_generate: false,
      disabled_reason: "Redis could not be reached",
      feeds,
      feed_configuration_error: feedConfigurationError,
      current_batch: null,
      last_status: null,
    };
  }
  const batch = await getCurrentBatch(redis);
  const statusRaw = await redis.get(getRedisKeys(getIstDateKey()).status);
  const currentBatch = batch ? await serializeAdminBatch(redis, batch) : null;
  return {
    ...settings,
    env_enabled: envEnabled,
    openai_ready: openAiReady,
    redis_ready: Boolean(redis),
    can_generate: Boolean(redis && envEnabled && openAiReady && !feedConfigurationError && feeds.length),
    disabled_reason: !envEnabled
      ? "PREDICTIONS_AI_ENABLED is false"
      : !openAiReady
        ? "OpenAI prediction credentials or model are missing"
        : feedConfigurationError || (!feeds.length ? "No approved RSS feeds are configured" : null),
    feeds,
    feed_configuration_error: feedConfigurationError,
    current_batch: currentBatch,
    daily_vote_analytics: currentBatch?.vote_analytics || null,
    last_status: statusRaw ? JSON.parse(statusRaw) : null,
  };
}

async function removeCurrentQuestion(pollId) {
  if (!hasRedisUrl()) throw new Error("REDIS_URL is required");
  const redis = await getRedisClient();
  const batchKey = await redis.get("predictions:daily:current");
  const batch = await getCurrentBatch(redis);
  if (!batchKey || !batch) return false;
  const nextQuestions = batch.questions.filter((question) => question.id !== pollId);
  if (nextQuestions.length === batch.questions.length) return false;
  const ttl = Math.max(await redis.ttl(batchKey), 60);
  batch.questions = nextQuestions;
  await redis.set(batchKey, JSON.stringify(batch), { EX: ttl });
  await redis.del(getRedisKeys(batch.date_key).poll(pollId));
  return true;
}

async function clearCurrentPredictions() {
  if (!hasRedisUrl()) throw new Error("REDIS_URL is required");
  const redis = await getRedisClient();
  const batchKey = await redis.get("predictions:daily:current");
  const batch = await getCurrentBatch(redis);
  const keys = ["predictions:daily:current"];
  if (batchKey) keys.push(batchKey);
  if (batch) {
    const redisKeys = getRedisKeys(batch.date_key);
    batch.questions.forEach((question) => keys.push(redisKeys.poll(question.id)));
    keys.push(redisKeys.voteStats, redisKeys.voters);
  }
  await redis.del(keys);
  return { cleared: Boolean(batch) };
}

module.exports = {
  castDailyPredictionVote,
  clearCurrentPredictions,
  generateDailyPredictions,
  getAdminPredictionStatus,
  getPublicDailyPredictions,
  recordDailyVoteRateLimit,
  removeCurrentQuestion,
  runDueDailyPredictions,
  _private: {
    ALLOWED_CATEGORIES,
    DEFAULT_FEEDS,
    assertSafeFeedUrl,
    buildPredictionRequest,
    clampCount,
    clusterFeedItems,
    extractResponseText,
    fetchFeedXml,
    getIstDateKey,
    getNextGenerationDate,
    isPrivateIp,
    isSafeSourceLink,
    jaccardSimilarity,
    parseFeedConfiguration,
    parseFeedItems,
    getDailyVoteAnalytics,
    serializeAdminBatch,
    serializePublicBatch,
    shouldAttemptScheduledGeneration,
    validatePredictionCandidates,
  },
};
