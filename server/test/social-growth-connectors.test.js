const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  CONNECTOR_STATES,
  checkAllConnections,
  collectGa4Aggregate,
  collectSearchConsoleAggregate,
  getConnectionOverview,
  getInstagramCapabilityMatrix,
  triggerN8nSocialWorkflow,
} = require("../services/social/socialGrowthConnectors");

function configuredSettings() {
  return {
    openAi: {
      apiKey: "sk-super-secret-openai-value",
      model: "gpt-test",
    },
    instagram: {
      provider: "instagram_login",
      accessToken: "IGQVJ-secret-instagram-token",
      accountId: "17841400000000001",
      accountType: "BUSINESS",
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments",
        "instagram_business_manage_messages",
      ],
    },
    ga4: {
      propertyId: "123456789",
      accessToken: "ya29.secret-google-token",
    },
    searchConsole: {
      siteUrl: "sc-domain:pinkpaisa.in",
      accessToken: "ya29.secret-search-token",
    },
    n8n: {
      webhookUrl: "https://automation.pinkpaisa.in/webhook/social-growth",
      signingSecret: "n8n-signing-secret-value",
      allowedHosts: ["automation.pinkpaisa.in"],
    },
  };
}

let googleKeyPair;
function googleServiceAccountFixture() {
  if (!googleKeyPair) {
    googleKeyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }
  return {
    credentials: {
      type: "service_account",
      client_email: "pink-paisa-analytics@pink-paisa-test.iam.gserviceaccount.com",
      private_key_id: "test-key-id",
      private_key: googleKeyPair.privateKey,
      token_uri: "https://oauth2.googleapis.com/token",
    },
    publicKey: googleKeyPair.publicKey,
  };
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

test("connection overview is truthful and never exposes connector credentials", () => {
  const settings = configuredSettings();
  const overview = getConnectionOverview({ settings, dependencies: { env: {} } });

  assert.equal(overview.connectors.openai.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(overview.connectors.instagram.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(overview.connectors.ga4.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(overview.connectors.search_console.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(overview.connectors.n8n.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(overview.connectors.openai.checked, false);
  assert.equal(overview.connectors.n8n.details.targetOrigin, "https://automation.pinkpaisa.in");

  const serialized = JSON.stringify(overview);
  assert.doesNotMatch(serialized, /super-secret-openai/);
  assert.doesNotMatch(serialized, /secret-instagram-token/);
  assert.doesNotMatch(serialized, /secret-google-token/);
  assert.doesNotMatch(serialized, /secret-search-token/);
  assert.doesNotMatch(serialized, /n8n-signing-secret/);

  const empty = getConnectionOverview({ settings: {}, dependencies: { env: {} } });
  assert.equal(empty.connectors.openai.state, CONNECTOR_STATES.NOT_CONFIGURED);
  assert.equal(empty.connectors.ga4.state, CONNECTOR_STATES.NOT_CONFIGURED);
  assert.equal(empty.connectors.search_console.state, CONNECTOR_STATES.NOT_CONFIGURED);
  assert.equal(empty.connectors.n8n.state, CONNECTOR_STATES.NOT_CONFIGURED);
});

test("Instagram capability matrix keeps Instagram Login and Facebook Login limitations distinct", () => {
  const instagramLogin = getInstagramCapabilityMatrix({
    provider: "instagram_login",
    accountType: "BUSINESS",
    scopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
      "instagram_business_manage_messages",
    ],
  });
  assert.equal(instagramLogin.requiresLinkedFacebookPage, false);
  assert.equal(instagramLogin.capabilities.publish_story.available, true);
  assert.equal(instagramLogin.capabilities.comments.available, true);
  assert.equal(instagramLogin.capabilities.tagged_media.supported, false);
  assert.equal(instagramLogin.capabilities.hashtag_search.supported, false);
  assert.equal(instagramLogin.capabilities.product_tagging.available, false);

  const instagramCreator = getInstagramCapabilityMatrix({
    provider: "instagram_login",
    accountType: "CREATOR",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
  });
  assert.equal(instagramCreator.capabilities.publish_image.available, true);
  assert.equal(instagramCreator.capabilities.publish_story.available, false);

  const facebookLogin = getInstagramCapabilityMatrix({
    provider: "facebook_login",
    accountType: "BUSINESS",
    pageId: "112233",
    scopes: [
      "instagram_basic",
      "pages_read_engagement",
      "pages_show_list",
      "instagram_content_publish",
      "instagram_manage_insights",
      "instagram_manage_comments",
      "instagram_manage_messages",
    ],
  });
  assert.equal(facebookLogin.requiresLinkedFacebookPage, true);
  assert.equal(facebookLogin.accountRequirementsMet, true);
  assert.equal(facebookLogin.capabilities.mentions.available, true);
  assert.equal(facebookLogin.capabilities.tagged_media.available, true);
  assert.equal(facebookLogin.capabilities.business_discovery.available, true);
  assert.equal(facebookLogin.capabilities.product_tagging.available, false);
});

test("GA4 aggregate connector sends a bounded runReport and parses numeric aggregates", async () => {
  const calls = [];
  const result = await collectGa4Aggregate({
    settings: configuredSettings(),
    dependencies: {
      env: {},
      httpClient: {
        async request(options) {
          calls.push(options);
          return {
            status: 200,
            data: {
              dimensionHeaders: [{ name: "date" }, { name: "sessionSource" }],
              metricHeaders: [{ name: "sessions" }, { name: "activeUsers" }],
              rows: [{
                dimensionValues: [{ value: "20260822" }, { value: "instagram" }],
                metricValues: [{ value: "42" }, { value: "31" }],
              }],
              totals: [{ metricValues: [{ value: "42" }, { value: "31" }] }],
              rowCount: 1,
              metadata: { currencyCode: "INR", timeZone: "Asia/Calcutta" },
              propertyQuota: { tokensPerDay: { consumed: 10, remaining: 199990 } },
            },
          };
        },
      },
    },
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    dimensions: ["date", "sessionSource"],
    metrics: ["sessions", "activeUsers"],
    limit: 9000,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /properties\/123456789:runReport$/);
  assert.equal(calls[0].headers.Authorization, "Bearer ya29.secret-google-token");
  assert.equal(calls[0].data.limit, "5000");
  assert.equal(calls[0].data.returnPropertyQuota, true);
  assert.deepEqual(result.rows[0], {
    dimensions: { date: "20260822", sessionSource: "instagram" },
    metrics: { sessions: 42, activeUsers: 31 },
  });
  assert.equal(result.rowCount, 1);
  assert.equal(result.metadata.currencyCode, "INR");
  assert.doesNotMatch(JSON.stringify(result), /secret-google-token/);
});

test("GA4 mints and caches an official scoped service-account access token", async () => {
  const { credentials, publicKey } = googleServiceAccountFixture();
  const tokenCache = new Map();
  let oauthCalls = 0;
  let reportCalls = 0;
  const settings = { ga4: { propertyId: "123456789" } };
  const dependencies = {
    env: { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) },
    now: () => new Date("2026-08-23T10:00:00.000Z"),
    googleAccessTokenCache: tokenCache,
    httpClient: {
      async request(options) {
        if (options.url === "https://oauth2.googleapis.com/token") {
          oauthCalls += 1;
          assert.equal(options.maxRedirects, 0);
          const form = new URLSearchParams(options.data);
          assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
          const assertion = form.get("assertion");
          const [encodedHeader, encodedClaim, encodedSignature] = assertion.split(".");
          assert.deepEqual(decodeJwtPart(encodedHeader), { alg: "RS256", typ: "JWT", kid: "test-key-id" });
          const claim = decodeJwtPart(encodedClaim);
          assert.equal(claim.iss, credentials.client_email);
          assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
          assert.equal(claim.scope, "https://www.googleapis.com/auth/analytics.readonly");
          assert.equal(claim.exp - claim.iat, 3600);
          assert.equal(crypto.verify(
            "RSA-SHA256",
            Buffer.from(`${encodedHeader}.${encodedClaim}`),
            publicKey,
            Buffer.from(encodedSignature, "base64url")
          ), true);
          return { status: 200, data: { access_token: "service-account-access-token", token_type: "Bearer", expires_in: 3600 } };
        }
        reportCalls += 1;
        assert.equal(options.headers.Authorization, "Bearer service-account-access-token");
        return { status: 200, data: { rows: [], totals: [], rowCount: 0 } };
      },
    },
  };

  const overview = getConnectionOverview({ settings, dependencies });
  assert.equal(overview.connectors.ga4.state, CONNECTOR_STATES.CONFIGURED);
  assert.doesNotMatch(JSON.stringify(overview), /PRIVATE KEY|test-key-id/);
  await collectGa4Aggregate({ settings, dependencies });
  await collectGa4Aggregate({ settings, dependencies });
  assert.equal(oauthCalls, 1);
  assert.equal(reportCalls, 2);
});

test("service-account OAuth failures redact the signed assertion", async () => {
  const { credentials } = googleServiceAccountFixture();
  let capturedAssertion = null;
  await assert.rejects(
    () => collectGa4Aggregate({
      settings: { ga4: { propertyId: "123456789" } },
      dependencies: {
        env: { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(credentials) },
        now: () => new Date("2026-08-23T10:00:00.000Z"),
        googleAccessTokenCache: new Map(),
        httpClient: {
          async request(options) {
            capturedAssertion = new URLSearchParams(options.data).get("assertion");
            throw new Error(`Google rejected assertion ${capturedAssertion}`);
          },
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "GOOGLE_AUTH_REQUEST_FAILED");
      assert.doesNotMatch(error.message, /eyJ/);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
  assert.ok(capturedAssertion);
});

test("Search Console loads GOOGLE_APPLICATION_CREDENTIALS with bounded file I/O", async () => {
  const { credentials } = googleServiceAccountFixture();
  const rawCredentials = JSON.stringify(credentials);
  const calls = [];
  let statCalls = 0;
  let readCalls = 0;
  const result = await collectSearchConsoleAggregate({
    settings: {},
    dependencies: {
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: "C:\\secrets\\pink-paisa-google.json",
        GOOGLE_SEARCH_CONSOLE_SITE: "sc-domain:pinkpaisa.in",
      },
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      googleAccessTokenCache: new Map(),
      fileSystem: {
        async stat(filePath) {
          statCalls += 1;
          assert.equal(filePath, "C:\\secrets\\pink-paisa-google.json");
          return { size: Buffer.byteLength(rawCredentials), isFile: () => true };
        },
        async readFile(filePath, encoding) {
          readCalls += 1;
          assert.equal(filePath, "C:\\secrets\\pink-paisa-google.json");
          assert.equal(encoding, "utf8");
          return rawCredentials;
        },
      },
      httpClient: {
        async request(options) {
          calls.push(options);
          if (options.url === "https://oauth2.googleapis.com/token") {
            const claim = decodeJwtPart(new URLSearchParams(options.data).get("assertion").split(".")[1]);
            assert.equal(claim.scope, "https://www.googleapis.com/auth/webmasters.readonly");
            return { status: 200, data: { access_token: "search-service-token", token_type: "Bearer", expires_in: 3600 } };
          }
          return { status: 200, data: { rows: [] } };
        },
      },
    },
    startDate: "2026-08-01",
    endDate: "2026-08-22",
  });

  assert.equal(statCalls, 1);
  assert.equal(readCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(result.source, "search_console_api");
});

test("Google aggregate connectors reject endpoint overrides and disallowed filters before HTTP", async () => {
  const unsafeSettings = configuredSettings();
  unsafeSettings.ga4.baseUrl = "https://127.0.0.1/v1beta";
  let called = false;
  const dependencies = {
    env: {},
    httpClient: { request: async () => { called = true; return { status: 200, data: {} }; } },
  };

  const overview = getConnectionOverview({ settings: unsafeSettings, dependencies });
  assert.equal(overview.connectors.ga4.state, CONNECTOR_STATES.MISCONFIGURED);
  await assert.rejects(
    () => collectGa4Aggregate({ settings: unsafeSettings, dependencies }),
    (error) => error.code === CONNECTOR_STATES.MISCONFIGURED
  );

  await assert.rejects(
    () => collectGa4Aggregate({
      settings: configuredSettings(),
      dependencies,
      dimensionFilter: {
        filter: { fieldName: "accessToken", stringFilter: { matchType: "EXACT", value: "leak" } },
      },
    }),
    (error) => error.code === "INVALID_REQUEST"
  );

  await assert.rejects(
    () => collectSearchConsoleAggregate({
      settings: configuredSettings(),
      dependencies,
      startDate: "2026-08-01",
      endDate: "2026-08-22",
      dimensionFilterGroups: [{
        groupType: "and",
        filters: [{ dimension: "token", operator: "equals", expression: "secret" }],
      }],
    }),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.equal(called, false);
});

test("Search Console connector computes aggregate totals from top-row results", async () => {
  const calls = [];
  const result = await collectSearchConsoleAggregate({
    settings: configuredSettings(),
    dependencies: {
      env: {},
      httpClient: {
        async request(options) {
          calls.push(options);
          return {
            status: 200,
            data: {
              rows: [
                { keys: ["2026-08-21", "https://pinkpaisa.in/quiz"], clicks: 5, impressions: 100, ctr: 0.05, position: 2 },
                { keys: ["2026-08-22", "https://pinkpaisa.in/blog"], clicks: 10, impressions: 50, ctr: 0.2, position: 4 },
                { keys: ["2026-08-23", "https://pinkpaisa.in/unknown"], clicks: 0, impressions: 25, ctr: 0 },
              ],
              responseAggregationType: "byPage",
            },
          };
        },
      },
    },
    startDate: "2026-08-01",
    endDate: "2026-08-22",
    dimensions: ["date", "page"],
    rowLimit: 99999,
  });

  assert.equal(calls[0].data.rowLimit, 25000);
  assert.match(calls[0].url, /sites\/sc-domain%3Apinkpaisa\.in\/searchAnalytics\/query$/);
  assert.equal(result.totals.clicks, 15);
  assert.equal(result.totals.impressions, 175);
  assert.equal(result.totals.ctr, 15 / 175);
  assert.equal(result.totals.weightedPosition, 8 / 3);
  assert.equal(result.isTopRowsOnly, true);
});

test("n8n social workflow signs the exact body and redacts response credentials", async () => {
  const calls = [];
  const settings = configuredSettings();
  const result = await triggerN8nSocialWorkflow({
    settings,
    dependencies: {
      env: {},
      now: () => new Date("2026-08-23T10:00:00.000Z"),
      randomUUID: () => "event-fixed-id",
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      httpClient: {
        async request(options) {
          calls.push(options);
          return { status: 202, data: { executionId: "exec-1", access_token: "must-not-escape" } };
        },
      },
    },
    event: "social.insights.refresh",
    payload: { draftId: "draft-1" },
  });

  assert.equal(calls.length, 1);
  const expected = `sha256=${crypto.createHmac("sha256", settings.n8n.signingSecret).update(calls[0].data).digest("hex")}`;
  assert.equal(calls[0].headers["X-Pink-Paisa-Signature"], expected);
  assert.equal(calls[0].headers["X-Pink-Paisa-Event-Id"], "event-fixed-id");
  assert.deepEqual(JSON.parse(calls[0].data), {
    event: "social.insights.refresh",
    event_id: "event-fixed-id",
    occurred_at: "2026-08-23T10:00:00.000Z",
    payload: { draftId: "draft-1" },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.status, 202);
  assert.equal(result.response.access_token, "[REDACTED]");
});

test("n8n webhook rejects a host resolving to a private address before HTTP", async () => {
  let called = false;
  await assert.rejects(
    () => triggerN8nSocialWorkflow({
      settings: configuredSettings(),
      dependencies: {
        env: {},
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
        httpClient: { request: async () => { called = true; } },
      },
      event: "social.test",
    }),
    (error) => error.code === "N8N_URL_INVALID"
  );
  assert.equal(called, false);
});

test("connection checks never claim CONNECTED without a successful injected probe", async () => {
  const settings = configuredSettings();
  const unchecked = await checkAllConnections({ settings, dependencies: { env: {} } });
  assert.equal(unchecked.connectors.openai.state, CONNECTOR_STATES.CONFIGURED);
  assert.equal(unchecked.connectors.openai.checked, false);

  const checked = await checkAllConnections({
    settings,
    dependencies: {
      env: {},
      connectionChecks: {
        openai: async () => ({ ok: true }),
        ga4: async () => false,
      },
    },
  });
  assert.equal(checked.connectors.openai.state, CONNECTOR_STATES.CONNECTED);
  assert.equal(checked.connectors.openai.connected, true);
  assert.equal(checked.connectors.ga4.state, CONNECTOR_STATES.ERROR);
  assert.equal(checked.connectors.ga4.connected, false);

  const redacted = await checkAllConnections({
    settings,
    dependencies: {
      env: {},
      connectionChecks: {
        openai: async () => { throw new Error(`Credential ${settings.openAi.apiKey} was rejected`); },
      },
    },
  });
  assert.equal(redacted.connectors.openai.state, CONNECTOR_STATES.ERROR);
  assert.doesNotMatch(redacted.connectors.openai.error.message, /super-secret-openai/);
  assert.match(redacted.connectors.openai.error.message, /\[REDACTED\]/);
});
