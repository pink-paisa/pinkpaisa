const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-with-enough-length";

const dailyPredictions = require("../services/dailyPredictionService");
const redisClient = require("../utils/redisClient");
const PollVote = require("../models/PollVote");
const pollController = require("../controllers/pollController");
const {
  normalizePredictionVoteAttribution,
} = require("../utils/predictionVoteAttribution");
const {
  combinePredictionVoteAnalytics,
} = require("../services/predictionVoteAnalyticsService");
const {
  assertSafeFeedUrl,
  clusterFeedItems,
  getNextGenerationDate,
  parseFeedItems,
  shouldAttemptScheduledGeneration,
  validatePredictionCandidates,
} = dailyPredictions._private;

test("Redis client connection retries are bounded", () => {
  const strategy = redisClient._private.createRedisSocketOptions().reconnectStrategy;
  assert.equal(strategy(0), 250);
  assert.equal(strategy(1), 500);
  assert.match(strategy(2).message, /retry limit reached/i);
});

class FakeRedis {
  constructor() {
    this.values = new Map();
    this.hashes = new Map();
    this.sets = new Map();
    this.expiries = new Map();
  }

  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, String(value));
    if (options.EX) this.expiries.set(key, Number(options.EX));
    return "OK";
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async del(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    let deleted = 0;
    list.forEach((key) => {
      if (this.values.delete(key)) deleted += 1;
      if (this.hashes.delete(key)) deleted += 1;
      if (this.sets.delete(key)) deleted += 1;
      this.expiries.delete(key);
    });
    return deleted;
  }

  async ttl(key) {
    return this.expiries.get(key) || -1;
  }

  async hSet(key, values) {
    this.hashes.set(key, { ...(this.hashes.get(key) || {}), ...values });
    return Object.keys(values).length;
  }

  async hGetAll(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async hIncrBy(key, field, amount) {
    const values = this.hashes.get(key) || {};
    values[field] = String(Number(values[field] || 0) + Number(amount));
    this.hashes.set(key, values);
    return Number(values[field]);
  }

  async sAdd(key, value) {
    const values = this.sets.get(key) || new Set();
    const previousSize = values.size;
    values.add(String(value));
    this.sets.set(key, values);
    return values.size > previousSize ? 1 : 0;
  }

  async sCard(key) {
    return this.sets.get(key)?.size || 0;
  }

  async expire(key, seconds) {
    this.expiries.set(key, Number(seconds));
    return 1;
  }

  multi() {
    const operations = [];
    const chain = {
      set: (...args) => { operations.push(() => this.set(...args)); return chain; },
      hSet: (...args) => { operations.push(() => this.hSet(...args)); return chain; },
      expire: (...args) => { operations.push(() => this.expire(...args)); return chain; },
      exec: async () => Promise.all(operations.map((operation) => operation())),
    };
    return chain;
  }

  async eval(_script, { keys, arguments: args }) {
    const [voteKey, pollKey, ipKey, statsKey, votersKey] = keys;
    const [vote, ttl, ipLimit, voteSource, voterHash] = args;
    if (this.values.has(voteKey)) {
      await this.hIncrBy(statsKey, "duplicate_attempts", 1);
      return [0];
    }
    const currentIpCount = Number(this.values.get(ipKey) || 0);
    if (currentIpCount >= Number(ipLimit)) {
      await this.hIncrBy(statsKey, "rate_limited_attempts", 1);
      return [-1];
    }
    if (!this.hashes.has(pollKey)) return [-2];
    await this.set(voteKey, vote, { EX: Number(ttl) });
    await this.set(ipKey, String(currentIpCount + 1), { EX: Number(ttl) });
    const counts = this.hashes.get(pollKey);
    const field = vote === "yes" ? "yes_count" : "no_count";
    counts[field] = String(Number(counts[field] || 0) + 1);
    const sourceField = voteSource === "beta_launch" ? "beta_launch_votes" : "organic_votes";
    counts[sourceField] = String(Number(counts[sourceField] || 0) + 1);
    await this.hIncrBy(statsKey, "accepted_votes", 1);
    await this.hIncrBy(statsKey, sourceField, 1);
    await this.sAdd(votersKey, voterHash);
    return [1, Number(counts.yes_count || 0), Number(counts.no_count || 0)];
  }
}

test("prediction vote attribution accepts only the allowlisted beta campaign", () => {
  assert.deepEqual(normalizePredictionVoteAttribution({
    voteSource: "beta_launch",
    campaign: "predictions_beta_launch",
  }), {
    vote_source: "beta_launch",
    campaign: "predictions_beta_launch",
  });
  assert.deepEqual(normalizePredictionVoteAttribution({
    voteSource: "beta_launch",
    campaign: "another_campaign",
  }), {
    vote_source: "organic",
    campaign: null,
  });
});

test("poll vote schema stores beta attribution without changing vote values", () => {
  assert.deepEqual(PollVote.schema.path("vote_source").enumValues, ["organic", "beta_launch"]);
  assert.equal(PollVote.schema.path("vote_source").defaultValue, "organic");
  assert.deepEqual(PollVote.schema.path("vote").enumValues, ["yes", "no"]);
});

test("public poll vote serialization excludes fingerprint and IP hash", () => {
  assert.deepEqual(pollController._private.serializePublicVote({
    _id: { toString: () => "vote-1" },
    poll_id: "poll-1",
    vote: "yes",
    voter_fingerprint: "private-fingerprint",
    ip_address_hash: "private-ip-hash",
    vote_source: "beta_launch",
  }), {
    id: "vote-1",
    poll_id: "poll-1",
    vote: "yes",
  });
});

test("admin prediction analytics separate genuine beta and organic votes", () => {
  const combined = combinePredictionVoteAnalytics({
    total_genuine_votes: 3,
    beta_launch_votes: 2,
    organic_votes: 1,
    unique_voting_fingerprints: 2,
    duplicate_attempts: 0,
    rate_limited_attempts: 0,
    by_prediction: [{ id: "editorial-1" }],
  }, {
    total_genuine_votes: 4,
    beta_launch_votes: 1,
    organic_votes: 3,
    unique_voting_fingerprints: 3,
    duplicate_attempts: 2,
    rate_limited_attempts: 1,
    by_prediction: [{ id: "daily-1" }],
  });
  assert.equal(combined.total_genuine_votes, 7);
  assert.equal(combined.beta_launch_votes, 3);
  assert.equal(combined.organic_votes, 4);
  assert.equal(combined.duplicate_attempts, 2);
  assert.equal(combined.rate_limited_attempts, 1);
  assert.deepEqual(combined.by_prediction.map((row) => row.id), ["daily-1", "editorial-1"]);
});

function buildClusters(count = 10) {
  const categories = ["finance", "policy", "tech", "lifestyle"];
  return Array.from({ length: count }, (_, index) => ({
    id: `topic-${index + 1}`,
    category: categories[index % categories.length],
    source_count: 1,
    primary_source: true,
    india_relevant: true,
    score: 100 - index,
    items: [{
      title: `India policy update number ${index + 1}`,
      summary: `Official India update for topic ${index + 1}`,
      url: `https://example.com/news/${index + 1}`,
      source: "Official Source",
      source_host: "example.com",
      category: categories[index % categories.length],
      primary_source: true,
      published_at: "2026-08-06T00:30:00.000Z",
    }],
  }));
}

function buildCandidates(count = 10) {
  const categories = ["finance", "policy", "tech", "lifestyle"];
  const subjects = [
    "new savings guidance|household budgets",
    "updated workplace policy|career flexibility",
    "digital payment changes|small businesses",
    "consumer privacy rules|online shopping",
    "education funding plans|student opportunities",
    "public transport policy|daily commuting",
    "clean energy measures|urban households",
    "women entrepreneurship support|new businesses",
    "bank lending guidance|first-time borrowers",
    "online safety standards|social media habits",
    "sports funding changes|women athletes",
  ];
  return Array.from({ length: count }, (_, index) => ({
    topic_id: `topic-${index + 1}`,
    question: `Do you think ${subjects[index].split("|")[0]} will affect ${subjects[index].split("|")[1]}?`,
    category: categories[index % categories.length],
    image_emoji: "📊",
    question_type: "opinion",
  }));
}

test("RSS parser keeps only fresh valid feed items", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Fresh India update</title><link>https://example.com/fresh</link><description>Current policy summary</description><pubDate>Thu, 06 Aug 2026 00:00:00 GMT</pubDate></item>
    <item><title>Old India update</title><link>https://example.com/old</link><description>Old summary</description><pubDate>Tue, 04 Aug 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const result = parseFeedItems(xml, {
    name: "Example",
    url: "https://example.com/feed.xml",
    category: "policy",
    primary_source: false,
  }, new Date("2026-08-06T06:00:00.000Z"));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Fresh India update");
});

test("RSS parser rejects item links outside the approved feed host", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>Trusted headline with unsafe destination</title><link>https://unapproved.example/story</link><description>Current policy summary</description><pubDate>Thu, 06 Aug 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const result = parseFeedItems(xml, {
    name: "Example",
    url: "https://approved.example/feed.xml",
    category: "policy",
    primary_source: false,
  }, new Date("2026-08-06T06:00:00.000Z"));
  assert.deepEqual(result, []);
});

test("RSS URL validation rejects private network resolution", async () => {
  await assert.rejects(
    () => assertSafeFeedUrl(
      "https://approved.example/feed.xml",
      new Set(["approved.example"]),
      async () => [{ address: "127.0.0.1" }]
    ),
    /private address/
  );
});

test("topic clustering accepts primary sources and cross-source coverage", () => {
  const now = new Date("2026-08-06T06:00:00.000Z");
  const common = {
    summary: "India women business policy announcement",
    category: "business",
    published_at: "2026-08-06T05:00:00.000Z",
  };
  const result = clusterFeedItems([
    { ...common, title: "India launches women business policy", url: "https://one.example/a", source: "One", source_host: "one.example", primary_source: false },
    { ...common, title: "New India women business policy launches", url: "https://two.example/b", source: "Two", source_host: "two.example", primary_source: false },
    { ...common, title: "RBI updates lending regulation", summary: "Reserve bank notification on lending rules", url: "https://rbi.org.in/c", source: "RBI", source_host: "rbi.org.in", primary_source: true, category: "finance" },
  ], now);
  assert.equal(result.length, 2);
  assert.ok(result.some((cluster) => cluster.source_count === 2));
  assert.ok(result.some((cluster) => cluster.primary_source));
});

test("question validation keeps safe questions and rejects unsafe price predictions", () => {
  const clusters = buildClusters(11);
  const candidates = [
    ...buildCandidates(10),
    {
      topic_id: "topic-11",
      question: "Will this stock price rise tomorrow?",
      category: "finance",
      image_emoji: "📈",
      question_type: "short_term_forecast",
    },
  ];
  const result = validatePredictionCandidates(candidates, clusters, {
    count: 15,
    dateKey: "2026-08-06",
    generatedAt: new Date("2026-08-06T00:30:00.000Z"),
    expiresAt: new Date("2026-08-07T00:30:00.000Z"),
  });
  assert.equal(result.accepted.length, 10);
  assert.ok(result.rejected.some((entry) => entry.code === "unsafe_topic"));
});

test("daily scheduler recognizes the initial and two retry windows", () => {
  const settings = { predictions_generation_hour_ist: 6, predictions_generation_minute_ist: 0 };
  assert.equal(shouldAttemptScheduledGeneration(settings, new Date("2026-08-06T00:30:00.000Z")), true);
  assert.equal(shouldAttemptScheduledGeneration(settings, new Date("2026-08-06T00:40:00.000Z")), true);
  assert.equal(shouldAttemptScheduledGeneration(settings, new Date("2026-08-06T00:50:00.000Z")), true);
  assert.equal(shouldAttemptScheduledGeneration(settings, new Date("2026-08-06T00:51:00.000Z")), false);
  assert.equal(getNextGenerationDate(new Date("2026-08-06T00:40:00.000Z"), 6, 0).toISOString(), "2026-08-07T00:30:00.000Z");
});

test("generation publishes a complete temporary Redis batch atomically", async () => {
  const previousEnabled = process.env.PREDICTIONS_AI_ENABLED;
  process.env.PREDICTIONS_AI_ENABLED = "true";
  const redis = new FakeRedis();
  const now = new Date("2026-08-06T00:30:00.000Z");
  try {
    const result = await dailyPredictions.generateDailyPredictions({
      force: true,
      now,
      dependencies: {
        redis,
        getSettings: async () => ({
          predictions_ai_enabled: true,
          predictions_daily_count: 10,
          predictions_generation_hour_ist: 6,
          predictions_generation_minute_ist: 0,
        }),
        collectFeeds: async () => ({ items: [{ title: "stub" }], feed_health: [{ name: "Stub", ok: true, item_count: 1 }] }),
        clusterItems: () => buildClusters(10),
        generateCandidates: async () => ({ questions: buildCandidates(10), model: "test-model" }),
      },
    });
    assert.equal(result.skipped, false);
    assert.equal(result.batch.questions.length, 10);
    const currentKey = await redis.get("predictions:daily:current");
    assert.equal(currentKey, "predictions:daily:2026-08-06:batch");
    assert.ok(await redis.get(currentKey));
    assert.ok(redis.expiries.get(currentKey) > 0);
  } finally {
    if (previousEnabled == null) delete process.env.PREDICTIONS_AI_ENABLED;
    else process.env.PREDICTIONS_AI_ENABLED = previousEnabled;
  }
});

test("failed generation never publishes a partial current batch", async () => {
  const previousEnabled = process.env.PREDICTIONS_AI_ENABLED;
  process.env.PREDICTIONS_AI_ENABLED = "true";
  const redis = new FakeRedis();
  try {
    await assert.rejects(() => dailyPredictions.generateDailyPredictions({
      force: true,
      now: new Date("2026-08-06T00:30:00.000Z"),
      dependencies: {
        redis,
        getSettings: async () => ({
          predictions_ai_enabled: true,
          predictions_daily_count: 10,
          predictions_generation_hour_ist: 6,
          predictions_generation_minute_ist: 0,
        }),
        collectFeeds: async () => ({ items: [{ title: "stub" }], feed_health: [] }),
        clusterItems: () => buildClusters(10),
        generateCandidates: async () => { throw new Error("AI unavailable"); },
      },
    }), /AI unavailable/);
    assert.equal(await redis.get("predictions:daily:current"), null);
    const status = JSON.parse(await redis.get("predictions:daily:2026-08-06:status"));
    assert.equal(status.status, "failed");
  } finally {
    if (previousEnabled == null) delete process.env.PREDICTIONS_AI_ENABLED;
    else process.env.PREDICTIONS_AI_ENABLED = previousEnabled;
  }
});

test("temporary Redis voting is atomic and rejects duplicate fingerprints", async () => {
  const redis = new FakeRedis();
  const batch = {
    batch_id: "batch-1",
    date_key: "2026-08-06",
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    questions: [{ id: "poll-1", question: "Do you agree?" }],
  };
  await redis.set("predictions:daily:current", "predictions:daily:2026-08-06:batch");
  await redis.set("predictions:daily:2026-08-06:batch", JSON.stringify(batch));
  await redis.hSet("predictions:daily:2026-08-06:poll:poll-1", { yes_count: "0", no_count: "0" });

  const first = await dailyPredictions.castDailyPredictionVote({
    pollId: "poll-1",
    vote: "yes",
    fingerprint: "browser-one",
    ipAddress: "203.0.113.10",
    voteSource: "beta_launch",
    campaign: "predictions_beta_launch",
    redis,
  });
  assert.deepEqual(first, { yes_count: 1, no_count: 0 });
  await assert.rejects(() => dailyPredictions.castDailyPredictionVote({
    pollId: "poll-1",
    vote: "no",
    fingerprint: "browser-one",
    ipAddress: "203.0.113.10",
    redis,
  }), /already voted/);

  const adminBatch = await dailyPredictions._private.serializeAdminBatch(redis, batch);
  assert.equal(adminBatch.vote_analytics.total_genuine_votes, 1);
  assert.equal(adminBatch.vote_analytics.beta_launch_votes, 1);
  assert.equal(adminBatch.vote_analytics.organic_votes, 0);
  assert.equal(adminBatch.vote_analytics.unique_voting_fingerprints, 1);
  assert.equal(adminBatch.vote_analytics.duplicate_attempts, 1);
  assert.equal(adminBatch.questions[0].beta_launch_votes, 1);

  const publicBatch = await dailyPredictions._private.serializePublicBatch(redis, batch);
  assert.equal(publicBatch.questions[0].yes_count, 1);
  assert.equal(publicBatch.questions[0].no_count, 0);
  assert.equal("beta_launch_votes" in publicBatch.questions[0], false);
  assert.equal("organic_votes" in publicBatch.questions[0], false);
});

test("unknown daily vote attribution is counted as organic", async () => {
  const redis = new FakeRedis();
  const batch = {
    batch_id: "batch-organic",
    date_key: "2026-08-06",
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    questions: [{ id: "poll-organic", question: "Do you agree?" }],
  };
  await redis.set("predictions:daily:current", "predictions:daily:2026-08-06:batch");
  await redis.set("predictions:daily:2026-08-06:batch", JSON.stringify(batch));
  await redis.hSet("predictions:daily:2026-08-06:poll:poll-organic", { yes_count: "0", no_count: "0" });

  await dailyPredictions.castDailyPredictionVote({
    pollId: "poll-organic",
    vote: "no",
    fingerprint: "browser-organic",
    ipAddress: "203.0.113.11",
    voteSource: "beta_launch",
    campaign: "unapproved",
    redis,
  });
  const analytics = await dailyPredictions._private.getDailyVoteAnalytics(redis, batch);
  assert.equal(analytics.beta_launch_votes, 0);
  assert.equal(analytics.organic_votes, 1);
});

test("daily vote IP limits reject excess traffic and update admin safeguards", async () => {
  const redis = new FakeRedis();
  const batch = {
    batch_id: "batch-limit",
    date_key: "2026-08-06",
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    questions: [{ id: "poll-limit", question: "Do you agree?" }],
  };
  await redis.set("predictions:daily:current", "predictions:daily:2026-08-06:batch");
  await redis.set("predictions:daily:2026-08-06:batch", JSON.stringify(batch));
  await redis.hSet("predictions:daily:2026-08-06:poll:poll-limit", { yes_count: "0", no_count: "0" });

  await dailyPredictions.castDailyPredictionVote({
    pollId: "poll-limit",
    vote: "yes",
    fingerprint: "browser-first",
    ipAddress: "203.0.113.12",
    redis,
  });
  const ipLimitKey = [...redis.values.keys()].find((key) => key.startsWith("predictions:daily:2026-08-06:ip-limit:"));
  assert.ok(ipLimitKey);
  await redis.set(ipLimitKey, "30");

  await assert.rejects(() => dailyPredictions.castDailyPredictionVote({
    pollId: "poll-limit",
    vote: "no",
    fingerprint: "browser-second",
    ipAddress: "203.0.113.12",
    redis,
  }), /vote limit reached/);
  const analytics = await dailyPredictions._private.getDailyVoteAnalytics(redis, batch);
  assert.equal(analytics.rate_limited_attempts, 1);
  assert.equal(analytics.total_genuine_votes, 1);
});
