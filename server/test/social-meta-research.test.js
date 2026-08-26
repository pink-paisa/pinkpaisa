const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const SocialResearchObservation = require("../models/SocialResearchObservation");
const {
  createInstagramGrowthService,
} = require("../services/social/instagramGrowthService");
const {
  ROLLING_UNIQUE_HASHTAG_LIMIT,
  getMetaResearchDesk,
  refreshMetaResearchWatchlists,
} = require("../services/social/socialMetaResearchService");
const {
  getConnections,
  _private: growthPrivate,
} = require("../services/social/socialGrowthTeamService");
const { seedConnectionHealth } = require("../scripts/migrate/social-growth-team");

function facebookSettings(overrides = {}) {
  return {
    provider: "facebook_login",
    apiVersion: "v24.0",
    accessToken: "facebook-research-secret",
    accountId: "17841400000000001",
    accountType: "BUSINESS",
    pageId: "1122334455",
    scopes: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"],
    ...overrides,
  };
}

function instagramSettings() {
  return {
    provider: "instagram_login",
    apiVersion: "v24.0",
    accessToken: "instagram-secret",
    accountId: "17841400000000001",
    accountType: "BUSINESS",
    scopes: ["instagram_business_basic"],
  };
}

function facebookSummary(overrides = {}) {
  return {
    id: "connection-facebook-1",
    provider: "facebook_login",
    is_connected: true,
    instagram_user_id: "17841400000000001",
    account_type: "BUSINESS",
    facebook_page_id: "1122334455",
    granted_scopes: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"],
    ...overrides,
  };
}

function memoryObservationModel() {
  const rows = [];
  return {
    rows,
    Model: {
      async findOne(query) {
        return rows.find((row) => row.idempotency_key === query.idempotency_key) || null;
      },
      async findOneAndUpdate(query, update) {
        const existing = rows.find((row) => row.idempotency_key === query.idempotency_key);
        if (existing) return existing;
        const inserted = {
          _id: `observation-${rows.length + 1}`,
          created_at: new Date(update.$setOnInsert.provenance.retrieved_at),
          ...update.$setOnInsert,
        };
        rows.push(inserted);
        return inserted;
      },
    },
  };
}

test("official Meta client exposes bounded hashtag and Business Discovery requests", async () => {
  const connectedService = require("../services/instagramGrowthService");
  assert.equal(typeof connectedService.searchHashtag, "function");
  assert.equal(typeof connectedService.getHashtag, "function");
  assert.equal(typeof connectedService.getHashtagMedia, "function");
  assert.equal(typeof connectedService.getRecentlySearchedHashtags, "function");
  assert.equal(typeof connectedService.getBusinessDiscovery, "function");
  const calls = [];
  const service = createInstagramGrowthService({
    settings: facebookSettings(),
    dependencies: {
      env: {},
      httpClient: {
        async request(options) {
          calls.push(options);
          if (options.url.endsWith("/recently_searched_hashtags")) {
            return { status: 200, data: { data: [{ id: "1784388001", name: "moneymindset" }] } };
          }
          if (options.url.endsWith("/ig_hashtag_search")) {
            return { status: 200, data: { data: [{ id: "1784388002", name: "wealthforwomen" }] } };
          }
          if (options.url.endsWith("/recent_media")) {
            return { status: 200, data: { data: [{ id: "media_recent_1", caption: "Question? #one #two", media_type: "IMAGE", timestamp: "2026-08-23T09:00:00Z" }] } };
          }
          return {
            status: 200,
            data: {
              business_discovery: {
                id: "business_1",
                username: "approved.reference",
                account_type: "BUSINESS",
                followers_count: 1200,
                follows_count: 100,
                media_count: 40,
                media: { data: [{ id: "business_media_1", caption: "Save this", media_type: "CAROUSEL_ALBUM", timestamp: "2026-08-22T09:00:00Z" }] },
              },
            },
          };
        },
      },
    },
  });

  const recent = await service.getRecentlySearchedHashtags();
  const searched = await service.searchHashtag({ hashtag: "#WealthForWomen" });
  const media = await service.getHashtagMedia({ hashtagId: searched.hashtagId, edge: "recent_media", limit: 999 });
  const business = await service.getBusinessDiscovery({ username: "@Approved.Reference", mediaLimit: 999 });

  assert.equal(recent.hashtags[0].name, "moneymindset");
  assert.equal(searched.hashtag, "wealthforwomen");
  assert.equal(media.media[0].id, "media_recent_1");
  assert.equal(business.account.username, "approved.reference");
  assert.equal(calls[0].params.limit, 30);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].params, "fields"), false);
  assert.deepEqual(calls[1].params, { user_id: "17841400000000001", q: "wealthforwomen" });
  assert.equal(calls[2].params.limit, 50);
  assert.match(calls[3].params.fields, /^business_discovery\.username\(approved\.reference\)\{/);
  assert.match(calls[3].params.fields, /media\.limit\(50\)\{/);
  assert.doesNotMatch(calls[3].params.fields, /account_type/);
  assert.ok(calls.every((call) => call.headers.Authorization === "Bearer facebook-research-secret"));
});

test("Instagram Login truthfully rejects official discovery operations before HTTP", async () => {
  let calls = 0;
  const service = createInstagramGrowthService({
    settings: instagramSettings(),
    dependencies: { env: {}, httpClient: { request: async () => { calls += 1; } } },
  });
  await assert.rejects(
    () => service.searchHashtag({ hashtag: "pinkpaisa" }),
    (error) => error.code === "PROVIDER_CAPABILITY_UNAVAILABLE" && /unavailable through Instagram Login/i.test(error.message),
  );
  await assert.rejects(
    () => service.getBusinessDiscovery({ username: "approved.reference" }),
    (error) => error.code === "PROVIDER_CAPABILITY_UNAVAILABLE" && /unavailable through Instagram Login/i.test(error.message),
  );
  assert.equal(calls, 0);
});

test("Meta research permissions and app-secret proof are operation-specific", async () => {
  const calls = [];
  const service = createInstagramGrowthService({
    settings: facebookSettings({
      scopes: ["instagram_basic"],
      appSecret: "meta-app-secret",
    }),
    dependencies: {
      env: {},
      httpClient: {
        async request(options) {
          calls.push(options);
          return { data: { data: [{ id: "1784388002" }] } };
        },
      },
    },
  });
  await service.searchHashtag({ hashtag: "pinkpaisa" });
  await assert.rejects(
    () => service.getBusinessDiscovery({ username: "approved.reference" }),
    (error) => error.code === "MISSING_PERMISSION",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.appsecret_proof, crypto.createHmac("sha256", "meta-app-secret").update("facebook-research-secret").digest("hex"));
  assert.notEqual(calls[0].params.appsecret_proof, "facebook-research-secret");
});

test("provider 429 status remains a Meta provider failure and is not replaced by a local throttle", async () => {
  const service = createInstagramGrowthService({
    settings: facebookSettings(),
    dependencies: {
      env: {},
      httpClient: {
        async request() {
          const error = new Error("Meta application request limit reached");
          error.response = { status: 429, data: { error: { code: 4, message: "Application request limit reached" } } };
          throw error;
        },
      },
    },
  });
  await assert.rejects(
    () => service.searchHashtag({ hashtag: "pinkpaisa" }),
    (error) => error.status === 429 && error.code === "META_4" && error.operation === "hashtag_search",
  );
});

test("watchlist refresh respects Meta's rolling unique-hashtag limit and stores only abstract patterns", async () => {
  const store = memoryObservationModel();
  const calls = { recent: 0, search: [], media: [], business: [] };
  const providerHistory = ["existing", ...Array.from({ length: 28 }, (_, index) => `used_${index + 2}`)];
  const instagramGrowthService = {
    async getRecentlySearchedHashtags() {
      calls.recent += 1;
      return { hashtags: providerHistory.map((name, index) => ({ id: `history_${index}`, name })) };
    },
    async searchHashtag({ hashtag }) {
      calls.search.push(hashtag);
      return { hashtag, hashtagId: `hashtag_${hashtag}` };
    },
    async getHashtagMedia({ hashtagId, edge }) {
      calls.media.push({ hashtagId, edge });
      return {
        media: [{
          id: `${hashtagId}_${edge}`,
          caption: "SECRETCAPTION Question?\n1. Save this #one #two #three #four #five",
          mediaType: edge === "top_media" ? "CAROUSEL_ALBUM" : "IMAGE",
          mediaProductType: "FEED",
          permalink: `https://www.instagram.com/p/${hashtagId}_${edge}/`,
          timestamp: "2026-08-23T09:00:00.000Z",
          likeCount: 12,
          commentsCount: 3,
        }],
      };
    },
    async getBusinessDiscovery({ username }) {
      calls.business.push(username);
      return {
        account: {
          username,
          accountType: "BUSINESS",
          followersCount: 999999,
          followsCount: 50,
          mediaCount: 100,
          media: [
            {
              id: "competitor_media_1",
              caption: "SECRETCAPTION Build money confidence and save this",
              mediaType: "IMAGE",
              permalink: "https://www.instagram.com/p/competitor_media_1/",
              timestamp: "2026-08-16T09:00:00.000Z",
              likeCount: 20,
              commentsCount: 2,
            },
            {
              id: "competitor_media_2",
              caption: "SECRETCAPTION SIP education for your career income",
              mediaType: "CAROUSEL_ALBUM",
              permalink: "https://www.instagram.com/p/competitor_media_2/",
              timestamp: "2026-08-23T09:00:00.000Z",
              likeCount: 30,
              commentsCount: 4,
            },
          ],
        },
      };
    },
  };
  const dependencies = {
    SocialResearchObservation: store.Model,
    instagramGrowthService,
    listRollingHashtagQueries: async () => [],
  };
  const settings = {
    watchlists: {
      hashtags: ["#Existing", "#New_Tag", "#Skip_Tag"],
      competitor_accounts: ["@Approved.Reference"],
    },
  };
  const now = new Date("2026-08-23T10:00:00.000Z");

  const result = await refreshMetaResearchWatchlists({ settings, instagramSummary: facebookSummary(), now, dependencies });
  assert.equal(result.state, "PARTIAL");
  assert.equal(result.hashtags.rolling_limit, ROLLING_UNIQUE_HASHTAG_LIMIT);
  assert.equal(result.hashtags.completed, 2);
  assert.equal(result.hashtags.skipped, 1);
  assert.equal(result.businesses.completed, 1);
  assert.deepEqual(calls.search, ["existing", "new_tag"]);
  assert.equal(calls.media.length, 4);
  assert.deepEqual(calls.business, ["approved.reference"]);
  assert.equal(store.rows.length, 4);
  assert.equal(store.rows.find((row) => row.query_key === "skip_tag").aggregate_summary.provider_request_made, false);
  assert.equal(store.rows.find((row) => row.query_key === "approved.reference").aggregate_summary.follower_count_ranking_prohibited, true);
  assert.ok(store.rows.find((row) => row.query_key === "approved.reference").topic_clusters.length >= 1);
  assert.doesNotMatch(JSON.stringify(store.rows), /SECRETCAPTION/);
  assert.match(JSON.stringify(store.rows), /QUESTION_STRUCTURE/);
  for (const row of store.rows) {
    const { _id, created_at, ...validationRecord } = row;
    const validation = new SocialResearchObservation(validationRecord).validateSync();
    assert.equal(validation, undefined, validation?.message);
  }

  await refreshMetaResearchWatchlists({ settings, instagramSummary: facebookSummary(), now, dependencies });
  assert.equal(calls.recent, 2);
  assert.deepEqual(calls.search, ["existing", "new_tag"]);
  assert.deepEqual(calls.business, ["approved.reference"]);

  const desk = await getMetaResearchDesk({
    now,
    dependencies: { listMetaResearchObservations: async () => [...store.rows].reverse() },
  });
  assert.equal(desk.status, "PARTIAL");
  assert.equal(desk.hashtag_observations.length, 3);
  assert.equal(desk.competitor_observations.length, 1);
  assert.ok(desk.sources.length >= 1);
  assert.doesNotMatch(JSON.stringify(desk), /SECRETCAPTION/);
});

test("ID-only Meta hashtag history is resolved without consuming a new quota slot", async () => {
  const store = memoryObservationModel();
  const history = Array.from({ length: 30 }, (_, index) => ({ id: `history_${index + 1}` }));
  const searched = [];
  const result = await refreshMetaResearchWatchlists({
    settings: { watchlists: { hashtags: ["existing", "new_tag"], competitor_accounts: [] } },
    instagramSummary: facebookSummary(),
    now: new Date("2026-08-23T10:00:00.000Z"),
    dependencies: {
      SocialResearchObservation: store.Model,
      listRollingHashtagQueries: async () => [],
      instagramGrowthService: {
        async getRecentlySearchedHashtags() { return { hashtags: history }; },
        async getHashtag({ hashtagId }) { return { hashtag: { id: hashtagId, name: hashtagId === "history_1" ? "existing" : `used_${hashtagId}` } }; },
        async searchHashtag({ hashtag }) { searched.push(hashtag); return { hashtag, hashtagId: "history_1" }; },
        async getHashtagMedia() { return { media: [] }; },
      },
    },
  });
  assert.deepEqual(searched, ["existing"]);
  assert.equal(result.hashtags.completed, 1);
  assert.equal(result.hashtags.skipped, 1);
  assert.equal(result.errors.some((error) => error.code === "META_HASHTAG_ROLLING_LIMIT"), true);
});

test("partial hashtag failures remain visible and can retry later the same day", async () => {
  const store = memoryObservationModel();
  let failRecent = true;
  let searches = 0;
  const dependencies = {
    SocialResearchObservation: store.Model,
    listRollingHashtagQueries: async () => [],
    instagramGrowthService: {
      async getRecentlySearchedHashtags() { return { hashtags: [] }; },
      async searchHashtag({ hashtag }) { searches += 1; return { hashtag, hashtagId: "hashtag_retry" }; },
      async getHashtagMedia({ edge }) {
        if (edge === "recent_media" && failRecent) throw Object.assign(new Error("Meta temporarily unavailable"), { status: 503, code: "META_2" });
        return { media: [] };
      },
    },
  };
  const settings = { watchlists: { hashtags: ["retry_tag"], competitor_accounts: [] } };
  const first = await refreshMetaResearchWatchlists({ settings, instagramSummary: facebookSummary(), now: new Date("2026-08-23T10:00:00.000Z"), dependencies });
  assert.equal(first.state, "PARTIAL");
  assert.equal(first.errors[0].status, 503);
  assert.equal(first.errors[0].retryable, true);
  failRecent = false;
  const second = await refreshMetaResearchWatchlists({ settings, instagramSummary: facebookSummary(), now: new Date("2026-08-23T10:01:00.000Z"), dependencies });
  assert.equal(second.state, "OK");
  assert.equal(searches, 2);
});

test("connection refresh reports discovery as unavailable for the current Instagram Login family without provider calls", async () => {
  const store = memoryObservationModel();
  let providerCalls = 0;
  const result = await refreshMetaResearchWatchlists({
    settings: { watchlists: { hashtags: ["#pinkpaisa"], competitor_accounts: ["approved.reference"] } },
    instagramSummary: {
      id: "connection-instagram-1",
      provider: "instagram_login",
      is_connected: true,
      instagram_user_id: "17841400000000001",
      account_type: "BUSINESS",
      granted_scopes: ["instagram_business_basic"],
    },
    now: new Date("2026-08-23T10:00:00.000Z"),
    dependencies: {
      SocialResearchObservation: store.Model,
      instagramGrowthService: {
        getRecentlySearchedHashtags: async () => { providerCalls += 1; },
        searchHashtag: async () => { providerCalls += 1; },
        getHashtagMedia: async () => { providerCalls += 1; },
        getBusinessDiscovery: async () => { providerCalls += 1; },
      },
    },
  });
  assert.equal(result.state, "UNAVAILABLE");
  assert.equal(result.observations.length, 2);
  assert.ok(result.errors.every((error) => error.code === "PROVIDER_CAPABILITY_UNAVAILABLE"));
  assert.equal(providerCalls, 0);
  assert.ok(result.observations.every((row) => row.aggregate_summary.provider_request_made === false));
});

test("connection refresh API surface includes Meta research health without changing overall Instagram connectivity", async () => {
  const settings = { watchlists: { hashtags: ["#pinkpaisa"], competitor_accounts: [] }, research: { enabled: false } };
  const refreshed = await getConnections({
    refresh: true,
    dependencies: {
      getSocialManagerSettings: async () => settings,
      getInstagramConnectionSummary: async () => ({
        id: "instagram-connection-1",
        provider: "instagram_login",
        is_connected: true,
        instagram_user_id: "17841400000000001",
        account_type: "BUSINESS",
        granted_scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
      }),
      checkAllConnections: async () => ({
        checkedAt: "2026-08-23T10:00:00.000Z",
        connectors: {
          instagram: {
            state: "CONNECTED",
            configured: true,
            checked: true,
            connected: true,
            capabilityMatrix: { capabilities: { hashtag_search: { supported: false, available: false } } },
          },
        },
      }),
      refreshMetaResearchWatchlists: async () => ({
        state: "UNAVAILABLE",
        checked_at: "2026-08-23T10:00:00.000Z",
        message: "Hashtag Search is unavailable through Instagram Login.",
        observations: [],
        errors: [{ code: "PROVIDER_CAPABILITY_UNAVAILABLE", message: "Hashtag Search is unavailable through Instagram Login." }],
      }),
      SocialConnectionHealth: {
        findOneAndUpdate: async (query, update) => {
          assert.deepEqual(query, { provider: "INSTAGRAM" });
          assert.equal(update.$setOnInsert.connection_key, "social-growth:instagram");
          return update.$set;
        },
      },
    },
  });
  assert.equal(refreshed.connections.instagram.status, "CONNECTED");
  assert.equal(refreshed.connections.instagram.research.state, "UNAVAILABLE");
  assert.match(refreshed.connections.instagram.warnings[0], /unavailable through Instagram Login/i);
});

test("connection refresh uses a live Insights probe when Instagram scope introspection is unavailable", async () => {
  const persisted = [];
  const summary = {
    id: "instagram-connection-1",
    provider: "instagram_login",
    is_connected: true,
    instagram_user_id: "17841400000000001",
    account_type: "BUSINESS",
    granted_scopes: [],
    requested_scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    scope_verification_status: "UNAVAILABLE",
  };
  let probeCalls = 0;
  let legacyCalls = 0;

  const refreshed = await getConnections({
    refresh: true,
    dependencies: {
      env: {},
      getSocialManagerSettings: async () => ({
        research: { enabled: false },
        watchlists: { hashtags: [], competitor_accounts: [] },
      }),
      getInstagramConnectionSummary: async () => summary,
      getInstagramAccessToken: async () => "provider-token",
      instagramGrowthService: {
        async getInsights() {
          legacyCalls += 1;
          throw new Error("legacy scope preflight must not run");
        },
        async probeInsightsAccess() {
          probeCalls += 1;
          return { source: "instagram_graph_api", data: [{ name: "reach" }] };
        },
      },
      refreshMetaResearchWatchlists: async () => ({
        state: "NOT_CONFIGURED",
        checked_at: "2026-08-26T10:00:00.000Z",
        message: "No Meta research watchlist is configured.",
        observations: [],
        errors: [],
      }),
      SocialConnectionHealth: {
        findOneAndUpdate: async (_query, update) => {
          persisted.push(update.$set);
          return update.$set;
        },
      },
    },
  });

  const instagram = refreshed.connections.instagram;
  assert.equal(probeCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(instagram.status, "CONNECTED");
  assert.equal(instagram.connected, true);
  assert.equal(instagram.capabilities.insights.available, true);
  assert.equal(instagram.capabilities.insights.verification, "LIVE_PROVIDER_PROBE");
  assert.deepEqual(instagram.capabilityMatrix.scopes, []);
  assert.deepEqual(summary.granted_scopes, []);
  const storedInstagram = persisted.find((row) => row.provider === "INSTAGRAM");
  assert.equal(storedInstagram.status, "CONNECTED");
  assert.equal(storedInstagram.latest_check.status, "CONNECTED");
});

test("connection refresh keeps a rejected live Insights probe visibly failed", async () => {
  const persisted = [];
  const providerError = Object.assign(new Error("Meta denied the Insights request"), {
    code: "META_200",
    status: 403,
  });
  const refreshed = await getConnections({
    refresh: true,
    dependencies: {
      env: {},
      getSocialManagerSettings: async () => ({
        research: { enabled: false },
        watchlists: { hashtags: [], competitor_accounts: [] },
      }),
      getInstagramConnectionSummary: async () => ({
        id: "instagram-connection-1",
        provider: "instagram_login",
        is_connected: true,
        instagram_user_id: "17841400000000001",
        account_type: "BUSINESS",
        granted_scopes: [],
      }),
      getInstagramAccessToken: async () => "provider-token",
      instagramGrowthService: {
        async probeInsightsAccess() { throw providerError; },
      },
      refreshMetaResearchWatchlists: async () => ({
        state: "NOT_CONFIGURED",
        checked_at: "2026-08-26T10:00:00.000Z",
        message: "No Meta research watchlist is configured.",
        observations: [],
        errors: [],
      }),
      SocialConnectionHealth: {
        findOneAndUpdate: async (_query, update) => {
          persisted.push(update.$set);
          return update.$set;
        },
      },
    },
  });

  const instagram = refreshed.connections.instagram;
  assert.equal(instagram.status, "ERROR");
  assert.equal(instagram.connected, false);
  assert.equal(instagram.error_code, "META_200");
  assert.match(instagram.error, /denied the Insights request/i);
  assert.equal(instagram.capabilities.insights.available, false);
  const storedInstagram = persisted.find((row) => row.provider === "INSTAGRAM");
  assert.equal(storedInstagram.status, "ERROR");
  assert.equal(storedInstagram.latest_check.status, "ERROR");
  assert.equal(storedInstagram.latest_check.error_code, "META_200");
});

test("connection refresh exposes an Instagram summary-store failure as ERROR instead of NOT_CONFIGURED", async () => {
  const persisted = [];
  const settings = { watchlists: { hashtags: [], competitor_accounts: [] }, research: { enabled: false } };
  const refreshed = await getConnections({
    refresh: true,
    dependencies: {
      getSocialManagerSettings: async () => settings,
      getInstagramConnectionSummary: async () => {
        const error = new Error("database failed with access_token=do-not-expose");
        error.code = "MONGO_TIMEOUT";
        throw error;
      },
      checkAllConnections: async () => ({
        checkedAt: "2026-08-23T10:00:00.000Z",
        connectors: {
          instagram: {
            state: "NOT_CONFIGURED",
            configured: false,
            checked: true,
            connected: false,
            capabilityMatrix: { capabilities: {} },
          },
        },
      }),
      refreshMetaResearchWatchlists: async () => ({
        state: "NOT_CONFIGURED",
        checked_at: "2026-08-23T10:00:00.000Z",
        message: "No research watchlist is configured.",
        observations: [],
        errors: [],
      }),
      SocialConnectionHealth: {
        findOneAndUpdate: async (_query, update) => {
          persisted.push(update.$set);
          return update.$set;
        },
      },
    },
  });

  const instagram = refreshed.connections.instagram;
  assert.equal(instagram.status, "ERROR");
  assert.equal(instagram.connected, false);
  assert.equal(instagram.error_code, "MONGO_TIMEOUT");
  assert.match(instagram.error, /could not be loaded/i);
  assert.doesNotMatch(JSON.stringify(instagram), /do-not-expose|access_token/i);
  const storedInstagram = persisted.find((row) => row.provider === "INSTAGRAM");
  assert.equal(storedInstagram.status, "ERROR");
  assert.equal(storedInstagram.latest_check.status, "ERROR");
  assert.equal(storedInstagram.latest_check.error_code, "MONGO_TIMEOUT");
  assert.match(storedInstagram.latest_check.error_summary, /could not be loaded/i);
  assert.doesNotMatch(JSON.stringify(storedInstagram), /do-not-expose|access_token/i);
});

test("connection migration preserves a runtime-created provider row instead of inserting a duplicate provider", async () => {
  const rows = [{ provider: "GA4", connection_key: "social-growth:ga4" }];
  const ConnectionModel = {
    async updateOne(query, update) {
      assert.deepEqual(Object.keys(query), ["provider"]);
      const existing = rows.find((row) => row.provider === query.provider);
      if (existing) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      const candidate = update.$setOnInsert;
      if (rows.some((row) => row.provider === candidate.provider)) {
        const error = new Error(`duplicate provider ${candidate.provider}`);
        error.code = 11000;
        throw error;
      }
      rows.push({ ...candidate });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    },
  };

  const results = await seedConnectionHealth({ ConnectionModel });
  assert.equal(rows.filter((row) => row.provider === "GA4").length, 1);
  assert.equal(rows.find((row) => row.provider === "GA4").connection_key, "social-growth:ga4");
  assert.equal(results.find((row) => row.connection_key === "ga4:primary").action, "preserved");
});

test("eligible Business Discovery accounts with no returned media remain valid observations", async () => {
  const store = memoryObservationModel();
  const result = await refreshMetaResearchWatchlists({
    settings: { watchlists: { hashtags: [], competitor_accounts: ["quiet.reference"] } },
    instagramSummary: facebookSummary(),
    now: new Date("2026-08-23T10:00:00.000Z"),
    dependencies: {
      SocialResearchObservation: store.Model,
      instagramGrowthService: {
        async getBusinessDiscovery({ username }) {
          return { account: { username, accountType: "BUSINESS", followersCount: 10, mediaCount: 0, media: [] } };
        },
      },
    },
  });
  assert.equal(result.state, "OK");
  assert.equal(result.businesses.completed, 1);
  assert.equal(store.rows[0].topic_clusters[0].label, "NO_RECENT_PUBLIC_MEDIA");
  const { _id, created_at, ...validationRecord } = store.rows[0];
  assert.equal(new SocialResearchObservation(validationRecord).validateSync(), undefined);
});

test("weekly-planning adapter receives only persisted Meta patterns and bounded public sources", () => {
  const converted = growthPrivate.metaDeskAsExternalResearch({
    status: "READY",
    hashtag_observations: ["#pinkpaisa: 4 public posts observed; format sample IMAGE 3, REELS 1."],
    competitor_observations: ["@approved.reference: 6 recent public posts observed."],
    sources: [{
      title: "#pinkpaisa public-media pattern",
      url: "https://www.instagram.com/p/example/",
      publisher: "Instagram",
      published_at: "2026-08-22T09:00:00.000Z",
      accessed_at: "2026-08-23T10:00:00.000Z",
      claim_supported: "IMAGE observed through the official Meta API.",
      confidence: 0.7,
      freshness: "CURRENT",
    }],
  });
  assert.equal(converted.sources[0].source_type, "social_trend");
  assert.equal(converted.sources[0].validation_status, "unconfirmed");
  assert.equal(converted.signals.length, 2);
  assert.ok(converted.signals.every((signal) => signal.eligible_for_automated_decision === false));
  assert.doesNotMatch(JSON.stringify(converted), /caption|creative_copy|raw_payload/i);
});
