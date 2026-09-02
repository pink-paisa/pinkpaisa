const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SOCIAL_PROMPTS,
  callStructuredResponse,
  _private: { buildPromptCacheKey, sha256, strictOpenAiResponseSchema },
} = require("../services/social/openAiSocialProvider");
const {
  AUDIENCE_INTELLIGENCE_SCHEMA,
  WEEKLY_CANDIDATES_SCHEMA,
  WEEKLY_PLAN_SCHEMA,
  WEEKLY_RESEARCH_DIGEST_SCHEMA,
} = require("../services/social/socialGrowthSchemas");
const { validateWithSchema } = require("../services/social/socialSchemas");

function uniqueItemSchemas() {
  return [
    {
      name: "weekly research topic source indexes",
      schema: WEEKLY_RESEARCH_DIGEST_SCHEMA.properties.currentTopics.items.properties.sourceIndexes,
      values: [0, 1],
    },
    {
      name: "audience theme aggregate sources",
      schema: AUDIENCE_INTELLIGENCE_SCHEMA.properties.questions.items.properties.aggregateSources,
      values: ["GA4", "Search Console"],
    },
    {
      name: "audience language patterns",
      schema: AUDIENCE_INTELLIGENCE_SCHEMA.properties.languagePatterns,
      values: ["simple money habits", "pause before paying"],
    },
    {
      name: "audience potential post ideas",
      schema: AUDIENCE_INTELLIGENCE_SCHEMA.properties.potentialPostIdeas,
      values: ["Idea one", "Idea two", "Idea three"],
    },
    {
      name: "weekly candidate evidence source indexes",
      schema: WEEKLY_CANDIDATES_SCHEMA.properties.candidates.items.properties.evidenceSourceIndexes,
      values: [0, 2],
    },
    {
      name: "weekly plan rejected candidate IDs",
      schema: WEEKLY_PLAN_SCHEMA.properties.rejectedCandidateIds,
      values: ["candidate_alpha", "candidate_beta"],
    },
  ];
}

function hasSchemaKeyword(value, keyword) {
  if (Array.isArray(value)) return value.some((item) => hasSchemaKeyword(item, keyword));
  if (!value || typeof value !== "object") return false;
  return Object.hasOwn(value, keyword)
    || Object.values(value).some((item) => hasSchemaKeyword(item, keyword));
}

function validWeeklyResearchDigest() {
  const topic = (index) => ({
    topicId: `topic_${index}`,
    topic: `Verified topic ${index}`,
    summary: `Evidence-backed summary ${index}`,
    relevanceToIndianWomen: `Practical relevance ${index}`,
    riskLevel: "LOW",
    confidence: 0.9,
    signalStrength: "VERIFIED",
    sourceIndexes: [0],
  });
  return {
    weekStart: "2026-09-07",
    weekEnd: "2026-09-13",
    timezone: "Asia/Kolkata",
    executiveSummary: "Three verified topics are suitable for responsible educational planning.",
    currentTopics: [topic(1), topic(2), topic(3)],
    topicsToAvoid: [],
    sources: [{
      sourceId: "source_1",
      title: "Primary source",
      location: "https://example.com/primary",
      publisher: "Example Authority",
      publicationDate: "2026-09-01",
      accessDate: "2026-09-01T10:00:00.000Z",
      claimSupported: "The supplied source supports the three educational topics.",
      confidence: 0.95,
      freshness: "CURRENT",
      evidenceLevel: "VERIFIED",
    }],
    evidenceGaps: [],
    conciseRationale: "The topics are current, supported, useful, and low risk.",
  };
}

test("all six application schema definitions retain and locally enforce uniqueItems", () => {
  for (const entry of uniqueItemSchemas()) {
    assert.equal(entry.schema.uniqueItems, true, `${entry.name} must retain the application constraint`);
    assert.equal(validateWithSchema(entry.schema, entry.values, entry.name), entry.values);
    assert.throws(
      () => validateWithSchema(entry.schema, [...entry.values, entry.values[0]], entry.name),
      (error) => error.code === "structured_output_invalid"
        && error.validation_errors.some((message) => /must contain unique items/.test(message)),
      `${entry.name} must reject a duplicate locally`,
    );
  }
});

test("OpenAI strict schema conversion strips uniqueItems recursively without mutating application schemas", () => {
  const applicationSchemas = [
    WEEKLY_RESEARCH_DIGEST_SCHEMA,
    AUDIENCE_INTELLIGENCE_SCHEMA,
    WEEKLY_CANDIDATES_SCHEMA,
    WEEKLY_PLAN_SCHEMA,
  ];
  const transportSchemas = applicationSchemas.map(strictOpenAiResponseSchema);

  assert.ok(applicationSchemas.some((schema) => hasSchemaKeyword(schema, "uniqueItems")));
  assert.ok(transportSchemas.every((schema) => !hasSchemaKeyword(schema, "uniqueItems")));
  for (const entry of uniqueItemSchemas()) assert.equal(entry.schema.uniqueItems, true);

  assert.notStrictEqual(transportSchemas[0], WEEKLY_RESEARCH_DIGEST_SCHEMA);
  assert.deepEqual(
    transportSchemas[0].required,
    Object.keys(transportSchemas[0].properties),
  );
});

test("all OpenAI prompt cache keys remain deterministic, unique, and within the 64-character API limit", () => {
  const keys = Object.entries(SOCIAL_PROMPTS).map(([stage, prompt]) => ({
    stage,
    key: buildPromptCacheKey(stage, prompt.version),
  }));

  for (const { stage, key } of keys) {
    assert.ok(key.length <= 64, `${stage} cache key must fit the OpenAI limit`);
    assert.equal(key, buildPromptCacheKey(stage, SOCIAL_PROMPTS[stage].version));
  }
  assert.equal(new Set(keys.map(({ key }) => key)).size, keys.length);

  const shortRawKey = `pinkpaisa-social-research-${SOCIAL_PROMPTS.research.version}`;
  assert.equal(buildPromptCacheKey("research", SOCIAL_PROMPTS.research.version), shortRawKey);

  for (const stage of ["weekly_research", "imagePromptRevision", "audience_intelligence"]) {
    const rawKey = `pinkpaisa-social-${stage}-${SOCIAL_PROMPTS[stage].version}`;
    const expectedSuffix = sha256(rawKey).slice(0, 12);
    const key = buildPromptCacheKey(stage, SOCIAL_PROMPTS[stage].version);
    assert.ok(rawKey.length > 64);
    assert.equal(key.length, 64);
    assert.ok(key.endsWith(`-${expectedSuffix}`));
  }
});

test("weekly research sends an OpenAI-compatible transport schema and validates the response locally", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-openai-key";
  let requestBody = null;
  try {
    const output = validWeeklyResearchDigest();
    const result = await callStructuredResponse({
      stage: "weekly_research",
      input: { week_start: output.weekStart, validated_sources: output.sources },
      schema: WEEKLY_RESEARCH_DIGEST_SCHEMA,
      maxAttempts: 1,
      timeoutMs: 2000,
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "resp-weekly-research",
            status: "completed",
            output_text: JSON.stringify(output),
            usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
          }),
        };
      },
    });

    assert.deepEqual(result.output, output);
    assert.equal(requestBody.text.format.type, "json_schema");
    assert.equal(requestBody.text.format.strict, true);
    assert.equal(requestBody.prompt_cache_key.length, 64);
    assert.equal(
      requestBody.prompt_cache_key,
      buildPromptCacheKey("weekly_research", SOCIAL_PROMPTS.weekly_research.version),
    );
    assert.equal(hasSchemaKeyword(requestBody.text.format.schema, "uniqueItems"), false);
    assert.equal(
      WEEKLY_RESEARCH_DIGEST_SCHEMA.properties.currentTopics.items.properties.sourceIndexes.uniqueItems,
      true,
    );
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
