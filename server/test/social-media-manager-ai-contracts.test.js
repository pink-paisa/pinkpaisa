const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FORMAT_CONTENT_SCHEMAS,
  FORMAT_CONTENT_OUTPUT_SCHEMA,
  FORMATS,
  IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA,
  validateFormatContent,
  validateWithSchema,
} = require("../services/social/socialSchemas");
const {
  SOCIAL_PROMPTS,
  buildFormatVisualBrief,
  reviseFormatContent,
  writeFormatContent,
} = require("../services/social/openAiSocialProvider");

test("FULL_AI_GRAPHIC prompts preserve the complete native text contract", () => {
  assert.equal(SOCIAL_PROMPTS.visual_brief.version, "social-visual-brief-v7");
  assert.match(SOCIAL_PROMPTS.visual_brief.instructions, /complete server-approved ordered visible-text contract/i);
  assert.match(SOCIAL_PROMPTS.visual_brief.instructions, /supporting or interaction copy/i);
  assert.match(SOCIAL_PROMPTS.visual_brief.instructions, /no branded finish or post-generation text\/logo overlay/i);
  assert.doesNotMatch(SOCIAL_PROMPTS.visual_brief.instructions, /permit exactly the approved short headline/i);

  assert.equal(SOCIAL_PROMPTS.imagePromptRevision.version, "social-image-prompt-revision-v5");
  assert.match(SOCIAL_PROMPTS.imagePromptRevision.instructions, /preserve the complete server-approved ordered visible-text manifest exactly/i);
  assert.match(SOCIAL_PROMPTS.imagePromptRevision.instructions, /never narrow the manifest to headline-only/i);
  assert.match(SOCIAL_PROMPTS.imagePromptRevision.instructions, /preserve the no-overlay contract/i);
});

function validSingleImageContent() {
  return {
    id: "primary",
    format: "SINGLE_IMAGE",
    postType: "EDUCATIONAL",
    objective: "EDUCATION",
    contentPillar: "Money Education",
    targetAudience: "Indian women building an emergency fund",
    whyToday: "A salary-cycle check-in makes this immediately actionable.",
    formatReason: "One memorable action is clearest as a single portrait visual.",
    hookOptions: [
      "Your emergency fund can start smaller than you think",
      "One money buffer, a little more breathing room",
      "Start your safety net with one realistic number",
    ],
    caption: "Choose a starter amount that fits your month, then build it consistently.",
    cta: "Save this and choose your starter amount.",
    hashtags: ["#PinkPaisa", "#MoneyConfidence", "#EmergencyFund", "#WomenAndMoney", "#FinancialWellness"],
    altText: "A warm portrait composition with clear empty space for an emergency-fund headline.",
    recommendedLandingPage: null,
    sourceIndexes: [],
    financialDisclaimer: "Educational content only; not personalised financial advice.",
    affiliateDisclosure: null,
    selectedHeadline: "Build a buffer that fits your life",
    supportingText: "Start realistic. Grow consistently.",
    imagePrompt: "A premium warm editorial portrait visual for Pink Paisa with an Indian woman planning calmly at home and generous headline-safe space.",
    negativeVisualInstructions: ["No logos, watermarks, visible text, fake statements, or currency notes."],
    overlayInstructions: {
      logoPosition: "Top right safe area",
      headlinePosition: "Upper-left negative space",
      safeAreaNotes: "Keep the left third uncluttered and all subjects away from crop boundaries.",
    },
  };
}

function validCarouselContent() {
  const value = {
    ...validSingleImageContent(),
    id: "primary-carousel",
    format: "CAROUSEL",
    formatReason: "Three short steps need a swipeable sequence to remain clear and useful.",
    slideCount: 3,
    narrativeArc: "Name the problem, show a realistic action, and close with one save-worthy reminder.",
    cohesiveArtDirection: "Warm Pink Paisa editorial scenes with a consistent palette and a distinct composition on each slide.",
    slides: Array.from({ length: 3 }, (_, index) => ({
      slideNumber: index + 1,
      headline: `Step ${index + 1}`,
      body: "One concise, practical and useful idea for this slide.",
      imagePrompt: `Create original Pink Paisa carousel scene ${index + 1} with a distinct composition and exact-copy safe space.`,
      overlayInstructions: "Keep the upper-left quadrant clear for exact approved copy.",
    })),
  };
  delete value.selectedHeadline;
  delete value.supportingText;
  delete value.imagePrompt;
  delete value.negativeVisualInstructions;
  delete value.overlayInstructions;
  return value;
}

function validProductContent() {
  return {
    ...validSingleImageContent(),
    id: "product-primary",
    format: "PRODUCT_FEATURE",
    postType: "AFFILIATE",
    objective: "PRODUCT_PROMOTION",
    contentPillar: "Curated Wellness and Affiliate Products",
    targetAudience: "Indian women building a calmer reflection routine",
    whyToday: "A gentle weekend reset makes a guided reflection routine relevant today.",
    formatReason: "One authentic product in an original lifestyle setting is clearest as a focused product feature.",
    caption: "Explore a guided journal for a calm reflection routine.",
    cta: "See the verified product details on Pink Paisa.",
    altText: "The authentic Calm Wellness Journal in a warm Pink Paisa desk setting with clear headline space.",
    recommendedLandingPage: "/product/calm-wellness-journal",
    financialDisclaimer: null,
    affiliateDisclosure: "Affiliate link: Pink Paisa may earn a commission at no extra cost to you.",
    verifiedProductId: "product-1",
    verifiedProductTitle: "Calm Wellness Journal",
    verifiedProductImageUrl: "https://media.pinkpaisa.in/products/calm-wellness-journal.png",
    selectedHeadline: "A calmer reflection ritual",
    supportingText: "Meet the verified Calm Wellness Journal.",
    imagePrompt: "Create an original warm Pink Paisa desk environment around the supplied authentic Calm Wellness Journal.",
    productPreservationInstructions: ["Keep the supplied product packaging, label, brand, colour, proportions and variant exactly unchanged."],
    negativeVisualInstructions: ["No replacement packaging, altered labels, prices, ratings, watermarks or unrelated logos."],
  };
}

function validSingleImageVisualBrief() {
  return {
    id: "primary",
    format: "SINGLE_IMAGE",
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    formatReason: "One memorable action is clearest as a single portrait visual.",
    aspectRatio: "4:5",
    subject: "An Indian woman calmly planning a realistic emergency fund.",
    setting: "A warm, contemporary home workspace in India.",
    composition: "Editorial portrait composition with the subject on the right and generous negative space on the left.",
    cameraAngle: "Natural eye-level three-quarter view.",
    lighting: "Soft window light with warm, premium highlights.",
    palette: "Pink Paisa pink, warm cream, muted plum, and natural skin tones.",
    mood: "Calm, capable, optimistic, and trustworthy.",
    indianCulturalContext: "Contemporary, authentic urban Indian home details without stereotypes.",
    subjectRepresentationRequirements: ["Represent an Indian woman with dignity and natural proportions."],
    textSafeRegions: ["Keep the upper-left third uncluttered for the exact approved headline."],
    references: [],
    assets: [{
      sequence: 1,
      role: "FEED_VISUAL",
      imagePrompt: "Create original, text-free Pink Paisa editorial artwork with a calm Indian woman planning at home and clear upper-left negative space.",
      overlayInstructions: "Reserve the upper-left for exact approved copy and the top-right for the Pink Paisa logo.",
      requiredObjects: ["Notebook", "Pen", "Warm home workspace"],
      prohibitedObjects: ["Visible text", "Watermarks", "Unrelated logos", "Currency notes"],
    }],
  };
}

test("AI content contracts expose one strict schema per supported format", () => {
  assert.equal(FORMATS.length, 12);
  assert.deepEqual(Object.keys(FORMAT_CONTENT_SCHEMAS).sort(), [...FORMATS].sort());
  assert.equal(FORMAT_CONTENT_SCHEMAS.VIDEO_FEED.properties.format.const, "VIDEO_FEED");
  assert.equal(FORMAT_CONTENT_SCHEMAS.VIDEO_FEED.properties.scenes.minItems, 1);

  const valid = validSingleImageContent();
  assert.equal(validateFormatContent("single-image", valid), valid);
  assert.equal(validateWithSchema(FORMAT_CONTENT_OUTPUT_SCHEMA, valid), valid);
  assert.throws(
    () => validateFormatContent("SINGLE_IMAGE", { ...valid, slides: [] }),
    (error) => error.code === "structured_output_invalid" && /slides is not allowed/.test(error.message),
  );

  const carousel = { ...validCarouselContent(), slideCount: 4 };
  assert.throws(
    () => validateFormatContent("CAROUSEL", carousel),
    (error) => error.code === "structured_output_invalid" && /slideCount/.test(error.message),
  );

  const promptRevision = {
    prompt: "Keep the approved composition while increasing the empty headline-safe region.",
    changes: ["Expanded the upper-left negative space."],
    conciseRationale: "The first asset left insufficient room for exact approved copy.",
  };
  assert.equal(validateWithSchema(IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA, promptRevision), promptRevision);
  assert.throws(
    () => validateWithSchema(IMAGE_PROMPT_REVISION_OUTPUT_SCHEMA, { ...promptRevision, revisedCopy: "not allowed" }),
    (error) => error.code === "structured_output_invalid" && /revisedCopy is not allowed/.test(error.message),
  );
});

test("format writer retries invalid structured output with schema feedback and provenance", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const output = calls.length === 1
        ? { format: "SINGLE_IMAGE" }
        : {
          ...validSingleImageContent(),
          overlayInstructions: {
            ...validSingleImageContent().overlayInstructions,
            ctaPosition: "Legacy lower-left placement returned by the model",
            disclosurePosition: "Legacy bottom-edge placement returned by the model",
          },
        };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-contract-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify(output),
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      };
    };

    const result = await writeFormatContent({
      format: "SINGLE_IMAGE",
      context: { selectedCandidate: { id: "primary", format: "SINGLE_IMAGE" } },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.openai.test/v1/responses");
    assert.equal(calls[0].body.store, false);
    assert.equal(calls[0].body.text.format.strict, true);
    assert.equal(calls[0].body.text.format.schema.properties.id.const, "primary");
    assert.equal(calls[0].body.text.format.schema.properties.format.const, "SINGLE_IMAGE");
    assert.deepEqual(
      calls[0].body.text.format.schema.properties.overlayInstructions.required,
      Object.keys(calls[0].body.text.format.schema.properties.overlayInstructions.properties),
    );
    assert.match(calls[1].body.input[1].content[0].text, /failed strict structured-output validation/i);
    assert.match(calls[1].body.input[1].content[0].text, /\$\.id is required/);
    assert.equal(result.output.format, "SINGLE_IMAGE");
    assert.equal(Object.hasOwn(result.output.overlayInstructions, "ctaPosition"), false);
    assert.equal(Object.hasOwn(result.output.overlayInstructions, "disclosurePosition"), false);
    assert.equal(result.response_id, "resp-ai-contract-2");
    assert.equal(result.attempt_count, 2);
    assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["FAILED", "SUCCEEDED"]);
    assert.deepEqual(result.usage, { input_tokens: 20, output_tokens: 10, total_tokens: 30 });
    assert.match(result.input_fingerprint, /^[a-f0-9]{64}$/);
    assert.match(result.output_fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(result.started_at) <= Date.parse(result.completed_at));
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("format writer revises output when the complete assembled caption exceeds 2,200 characters", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const output = calls.length === 1
        ? { ...validSingleImageContent(), caption: "x".repeat(2100) }
        : validSingleImageContent();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-caption-contract-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify(output),
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      };
    };

    const result = await writeFormatContent({
      format: "SINGLE_IMAGE",
      context: { selectedCandidate: { id: "primary", format: "SINGLE_IMAGE" } },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].body.input[1].content[0].text, /CAPTION_EXCEEDS_2200_CHARACTERS/);
    assert.equal(result.attempt_count, 2);
    assert.equal(result.output.caption, validSingleImageContent().caption);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("format writer constrains landing pages to verified active paths plus null and retries destination drift", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const output = {
        ...validSingleImageContent(),
        recommendedLandingPage: calls.length === 1
          ? "/invented-ai-destination"
          : "/calculators/emergency-fund",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-destination-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify(output),
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      };
    };

    const result = await writeFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        selectedCandidate: { id: "primary", format: "SINGLE_IMAGE" },
        allowed_destinations: [
          { landingPage: "/", active: true },
          { url: "/calculators/emergency-fund", is_active: true },
          { url: "/inactive-resource", is_active: false },
          { landingPage: "/calculators/emergency-fund" },
        ],
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    const landingSchema = calls[0].body.text.format.schema.properties.recommendedLandingPage;
    assert.deepEqual(landingSchema.type, ["string", "null"]);
    assert.deepEqual(landingSchema.enum, ["/", "/calculators/emergency-fund", null]);
    assert.equal(landingSchema.enum.includes("/inactive-resource"), false);
    assert.match(calls[1].body.input[1].content[0].text, /\$\.recommendedLandingPage is not an allowed value/);
    assert.equal(result.output.recommendedLandingPage, "/calculators/emergency-fund");
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("visual brief schema locks approved id, format, and visual mode and retries identity drift", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const output = calls.length === 1
        ? { ...validSingleImageVisualBrief(), id: "alternate", visualMode: "FULL_AI_GRAPHIC" }
        : validSingleImageVisualBrief();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-visual-identity-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify(output),
          usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
        }),
      };
    };

    const result = await buildFormatVisualBrief({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        approved_format_content: validSingleImageContent(),
        visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    const schema = calls[0].body.text.format.schema;
    assert.equal(schema.properties.id.const, "primary");
    assert.equal(schema.properties.format.const, "SINGLE_IMAGE");
    assert.equal(schema.properties.visualMode.const, "AI_VISUAL_WITH_EXACT_OVERLAY");
    const requestInput = JSON.parse(calls[0].body.input[0].content[0].text);
    assert.equal(requestInput.approvedContentId, "primary");
    assert.equal(requestInput.selectedFormat, "SINGLE_IMAGE");
    assert.equal(requestInput.requestedVisualMode, "AI_VISUAL_WITH_EXACT_OVERLAY");
    assert.match(calls[1].body.input[1].content[0].text, /\$\.id must equal "primary"/);
    assert.match(calls[1].body.input[1].content[0].text, /\$\.visualMode must equal "AI_VISUAL_WITH_EXACT_OVERLAY"/);
    assert.equal(result.output.id, "primary");
    assert.equal(result.output.visualMode, "AI_VISUAL_WITH_EXACT_OVERLAY");
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("revision schema locks outer and revised-content identity", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  const calls = [];
  try {
    const revisedContent = {
      ...validSingleImageContent(),
      caption: "Choose one realistic starter amount, then build your buffer consistently.",
    };
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-ai-revision-identity",
          status: "completed",
          output_text: JSON.stringify({
            id: "primary",
            format: "SINGLE_IMAGE",
            changedFields: ["caption"],
            revisionSummary: "Removed ambiguity from the savings instruction.",
            revisedContent,
          }),
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      };
    };

    const result = await reviseFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        original_content: validSingleImageContent(),
        compliance_feedback: { decision: "REVISE", requiredChanges: ["Clarify the instruction."] },
      },
      settings: { cost_controls: { retry_limit: 0 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 1);
    const schema = calls[0].body.text.format.schema;
    assert.equal(schema.properties.id.const, "primary");
    assert.equal(schema.properties.format.const, "SINGLE_IMAGE");
    assert.equal(schema.properties.revisedContent.properties.id.const, "primary");
    assert.equal(schema.properties.revisedContent.properties.format.const, "SINGLE_IMAGE");
    assert.equal(result.output.revisedContent.id, "primary");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
  }
});

test("product revision schema requires the exact verified product landing path and retries nested drift", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const revisedContent = {
        ...validProductContent(),
        caption: "Explore the verified journal details for a calm reflection routine.",
        recommendedLandingPage: calls.length === 1
          ? "/product/invented-by-ai"
          : "/product/calm-wellness-journal",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-product-revision-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify({
            id: "product-primary",
            format: "PRODUCT_FEATURE",
            changedFields: ["caption"],
            revisionSummary: "Kept the verified product destination while clarifying the caption.",
            revisedContent,
          }),
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      };
    };

    const result = await reviseFormatContent({
      format: "PRODUCT_FEATURE",
      context: {
        candidate: { id: "product-primary", format: "PRODUCT_FEATURE" },
        original_content: validProductContent(),
        verified_product: {
          id: "product-1",
          landingPage: "https://pinkpaisa.in/product/calm-wellness-journal#details",
        },
        compliance_feedback: { decision: "REVISE", requiredChanges: ["Clarify the caption."] },
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    const landingSchema = calls[0].body.text.format.schema
      .properties.revisedContent.properties.recommendedLandingPage;
    assert.deepEqual(landingSchema, {
      type: "string",
      const: "/product/calm-wellness-journal",
    });
    assert.match(
      calls[1].body.input[1].content[0].text,
      /\$\.revisedContent\.recommendedLandingPage must equal "\/product\/calm-wellness-journal"/,
    );
    assert.equal(result.output.revisedContent.recommendedLandingPage, "/product/calm-wellness-journal");
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("financial-disclaimer revision retries unexpected overlay mutations and accepts only the scoped correction", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const originalContent = validSingleImageContent();
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const revisedContent = {
        ...validSingleImageContent(),
        financialDisclaimer: "For education only; this is not personalised financial advice.",
        ...(calls.length === 1 ? {
          overlayInstructions: {
            ...validSingleImageContent().overlayInstructions,
            logoPosition: "Move the logo into the lower-left CTA area",
          },
        } : {}),
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-scoped-revision-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify({
            id: "primary",
            format: "SINGLE_IMAGE",
            changedFields: calls.length === 1
              ? ["financialDisclaimer", "overlayInstructions.logoPosition"]
              : ["format_content.financialDisclaimer"],
            revisionSummary: "Clarified the educational disclaimer only.",
            revisedContent,
          }),
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      };
    };

    const result = await reviseFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        original_content: originalContent,
        compliance_feedback: {
          decision: "REVISE",
          issues: [{
            code: "financial_disclaimer_clarity",
            severity: "WARNING",
            fieldPath: "format_content.financialDisclaimer",
            message: "Clarify that this is educational, not personalised advice.",
          }],
          requiredChanges: ["Revise only `format_content.financialDisclaimer`."],
        },
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].body.input[1].content[0].text, /overlayInstructions\.logoPosition changed unexpectedly/);
    assert.deepEqual(result.output.revisedContent.overlayInstructions, originalContent.overlayInstructions);
    assert.equal(result.output.revisedContent.financialDisclaimer, "For education only; this is not personalised financial advice.");
    assert.deepEqual(result.output.changedFields, ["format_content.financialDisclaimer"]);
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("CTA revisions keep legacy on-image CTA placement unchanged", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const originalContent = {
      ...validSingleImageContent(),
      overlayInstructions: {
        ...validSingleImageContent().overlayInstructions,
        ctaPosition: "Legacy lower-left safe area",
        disclosurePosition: "Legacy bottom-edge safe area",
      },
    };
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const revisedContent = {
        ...originalContent,
        cta: "Choose your starter amount and save this for payday.",
        ...(calls.length === 1 ? {
          overlayInstructions: {
            ...originalContent.overlayInstructions,
            ctaPosition: "Lower-left safe area sized for the exact revised CTA",
          },
        } : {}),
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-ai-cta-placement-revision",
          status: "completed",
          output_text: JSON.stringify({
            id: "primary",
            format: "SINGLE_IMAGE",
            changedFields: calls.length === 1 ? ["cta", "overlayInstructions.ctaPosition"] : ["cta"],
            revisionSummary: "Clarified the caption-only CTA without changing legacy overlay placement.",
            revisedContent,
          }),
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      };
    };

    const result = await reviseFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        original_content: originalContent,
        compliance_feedback: {
          decision: "REVISE",
          issues: [
            { code: "caption_clarity", severity: "WARNING", fieldPath: "format_content.caption", message: "Keep the caption clear." },
            { code: "cta_clarity", severity: "WARNING", fieldPath: "format_content.cta", message: "Make the CTA specific." },
            { code: "visual_claim", severity: "WARNING", fieldPath: "format_content.imagePrompt", message: "Keep the image prompt factual." },
          ],
          requiredChanges: ["Revise the cited fields only."],
        },
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].body.input[1].content[0].text, /overlayInstructions\.ctaPosition changed unexpectedly/);
    assert.equal(result.output.revisedContent.cta, "Choose your starter amount and save this for payday.");
    assert.equal(result.output.revisedContent.overlayInstructions.ctaPosition, originalContent.overlayInstructions.ctaPosition);
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("revision transport strips null legacy overlay placements for current feed drafts", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  try {
    const originalContent = validSingleImageContent();
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "resp-ai-null-legacy-placement",
        status: "completed",
        output_text: JSON.stringify({
          id: "primary",
          format: "SINGLE_IMAGE",
          changedFields: ["caption"],
          revisionSummary: "Clarified the caption without creating feed overlay placements.",
          revisedContent: {
            ...originalContent,
            caption: `${originalContent.caption} Save this for later.`,
            overlayInstructions: {
              ...originalContent.overlayInstructions,
              ctaPosition: null,
              disclosurePosition: null,
            },
          },
        }),
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      }),
    });

    const result = await reviseFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        original_content: originalContent,
        compliance_feedback: {
          decision: "REVISE",
          issues: [{ code: "caption_clarity", severity: "WARNING", fieldPath: "format_content.caption", message: "Clarify the caption." }],
          requiredChanges: ["Clarify the caption only."],
        },
      },
      settings: { cost_controls: { retry_limit: 0 } },
      dependencies: { fetchImpl },
    });

    assert.equal(Object.hasOwn(result.output.revisedContent.overlayInstructions, "ctaPosition"), false);
    assert.equal(Object.hasOwn(result.output.revisedContent.overlayInstructions, "disclosurePosition"), false);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
  }
});

test("structured revision output retries control characters and malformed pipe markers", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      const revisedContent = {
        ...validSingleImageContent(),
        financialDisclaimer: calls.length === 1
          ? "For education only.\u0007 or||||>"
          : "For education only; not personalised financial advice.",
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp-ai-hygiene-revision-${calls.length}`,
          status: "completed",
          output_text: JSON.stringify({
            id: "primary",
            format: "SINGLE_IMAGE",
            changedFields: ["financialDisclaimer"],
            revisionSummary: "Clarified the disclaimer.",
            revisedContent,
          }),
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      };
    };

    const result = await reviseFormatContent({
      format: "SINGLE_IMAGE",
      context: {
        candidate: { id: "primary", format: "SINGLE_IMAGE" },
        original_content: validSingleImageContent(),
        compliance_feedback: { decision: "REVISE", issues: [], requiredChanges: [] },
      },
      settings: { cost_controls: { retry_limit: 1 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].body.input[1].content[0].text, /disallowed control character/);
    assert.match(calls[1].body.input[1].content[0].text, /malformed pipe-marker text/);
    assert.equal(result.attempt_count, 2);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

test("AI-selected carousel output uses the carousel-only schema instead of a default slide template", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-ai-carousel",
          status: "completed",
          output_text: JSON.stringify(validCarouselContent()),
          usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
        }),
      };
    };

    const result = await writeFormatContent({
      format: "CAROUSEL",
      context: {
        selectedCandidate: {
          id: "primary-carousel",
          format: "CAROUSEL",
          formatReason: "The AI strategist selected a short educational sequence.",
        },
      },
      settings: { cost_controls: { retry_limit: 0 } },
      dependencies: { fetchImpl },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.openai.test/v1/responses");
    assert.equal(calls[0].body.text.format.schema.properties.id.const, "primary-carousel");
    assert.equal(calls[0].body.text.format.schema.properties.format.const, "CAROUSEL");
    assert.equal(calls[0].body.text.format.schema.properties.slides.minItems, 3);
    assert.equal(Object.hasOwn(calls[0].body.text.format.schema.properties, "selectedHeadline"), false);
    assert.equal(result.output.format, "CAROUSEL");
    assert.equal(result.output.slideCount, 3);
    assert.equal(result.output.slides.length, 3);
    assert.equal(result.response_id, "resp-ai-carousel");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
  }
});
