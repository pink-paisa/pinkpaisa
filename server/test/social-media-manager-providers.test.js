const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { RESEARCH_OUTPUT_SCHEMA } = require("../services/social/socialSchemas");
const {
  callStructuredResponse,
} = require("../services/social/openAiSocialProvider");
const {
  buildInstagramCaption,
  buildReadiness,
  publishSocialDraft,
  publishingFeatureEnabled,
  queueSocialPublication,
  reconcileUncertainPublication,
  reconcileCheckpointedSocialPublications,
  recoverStaleSocialPublications,
} = require("../services/social/socialPublishingService");
const { generateSocialVisuals } = require("../services/social/socialAiImageService");
const { buildSocialCaptionContract } = require("../services/social/socialCaptionPolicy");

function validSingleImageRecommendation() {
  const formatReason = "One clear educational action is strongest as a single portrait post.";
  const imagePrompt = "Create an original premium Pink Paisa editorial scene of an Indian woman calmly planning at a warm home desk, with sophisticated blush, plum, cream and sage styling and clear headline-safe negative space.";
  return {
    internalTitle: "A realistic emergency-fund start",
    whyToday: "A salary-cycle check-in makes one practical buffer action useful today.",
    objective: "EDUCATION",
    format: "SINGLE_IMAGE",
    contentPillar: "Money Education",
    targetAudienceSegment: "Indian women building their first emergency fund",
    topic: "Choose a realistic starter money buffer",
    verifiedProductId: null,
    verifiedProductTitle: null,
    hooks: [
      "Your emergency fund can start smaller than you think",
      "One money buffer, a little more breathing room",
      "Start your safety net with one realistic number",
    ],
    onPostCopy: {
      headline: "Build a buffer that fits your life",
      supportingCopy: "Start realistic. Grow consistently.",
      slides: [],
      storyFrames: [],
      reelScenes: [],
    },
    caption: "Choose a starter amount that fits your real month, then build it consistently.",
    cta: "Save this and choose your starter amount.",
    hashtags: ["#PinkPaisa", "#MoneyConfidence", "#EmergencyFund", "#WomenAndMoney", "#FinancialWellness"],
    visualConcept: {
      layout: "Portrait editorial scene with a clear upper-left text-safe region",
      mainVisual: "An Indian woman planning calmly at a warm, uncluttered table",
      textHierarchy: "Headline first, supporting line second and CTA near the lower safe margin",
      graphicElements: "Subtle plum and sage shapes with no generated text",
      mood: "Warm, capable and reassuring",
      photographyOrIllustrationDirection: "Premium natural-light editorial photography",
      aspectRatio: "4:5",
    },
    imageGenerationPrompt: imagePrompt,
    altText: "An Indian woman calmly planning at a warm table with clear space for a money-buffer headline.",
    financialDisclaimer: "Educational content only. This is not personalised investment advice.",
    affiliateDisclosure: null,
    recommendedLandingPage: "/quiz",
    utmParameters: {
      source: "instagram",
      medium: "organic_social",
      campaign: "20260822-money-education",
      content: "emergency-fund-starter",
    },
    sources: [],
    confidence: 0.86,
    riskFlags: [],
    scoreBreakdown: {
      brandRelevance: 23,
      audienceUsefulness: 18,
      timeliness: 12,
      originality: 13,
      engagementPotential: 8,
      businessAlignment: 8,
      evidenceQuality: 3,
      compliancePenalty: 0,
      total: 85,
    },
    formatReason,
    postType: "EDUCATIONAL",
    formatContent: {
      id: "primary",
      format: "SINGLE_IMAGE",
      postType: "EDUCATIONAL",
      objective: "EDUCATION",
      contentPillar: "Money Education",
      targetAudience: "Indian women building their first emergency fund",
      whyToday: "A salary-cycle check-in makes this immediately actionable.",
      formatReason,
      hookOptions: [
        "Your emergency fund can start smaller than you think",
        "One money buffer, a little more breathing room",
        "Start your safety net with one realistic number",
      ],
      caption: "Choose a starter amount that fits your real month, then build it consistently.",
      cta: "Save this and choose your starter amount.",
      hashtags: ["#PinkPaisa", "#MoneyConfidence", "#EmergencyFund", "#WomenAndMoney", "#FinancialWellness"],
      altText: "An Indian woman calmly planning at a warm table with clear space for a money-buffer headline.",
      recommendedLandingPage: "/quiz",
      sourceIndexes: [],
      financialDisclaimer: "Educational content only. This is not personalised investment advice.",
      affiliateDisclosure: null,
      selectedHeadline: "Build a buffer that fits your life",
      supportingText: "Start realistic. Grow consistently.",
      imagePrompt,
      negativeVisualInstructions: ["No logos, watermarks, visible text, fake statements or currency notes."],
      overlayInstructions: {
        logoPosition: "Top-right safe area",
        headlinePosition: "Upper-left negative space",
        ctaPosition: "Lower-left safe area",
        disclosurePosition: "Bottom edge inside safe margin",
        safeAreaNotes: "Keep the left third uncluttered and all subjects away from crop boundaries.",
      },
    },
    visualBrief: {
      id: "primary",
      format: "SINGLE_IMAGE",
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      formatReason,
      aspectRatio: "4:5",
      subject: "An Indian woman calmly reviewing a simple monthly plan",
      setting: "A warm contemporary Indian home workspace",
      composition: "Subject on the right with deliberate negative space on the upper left",
      cameraAngle: "Natural eye-level three-quarter view",
      lighting: "Soft natural window light with warm fill",
      palette: "Warm blush, deep plum, cream, muted coral and sage",
      mood: "Capable, warm, reassuring and modern",
      indianCulturalContext: "Contemporary Indian home styling without stereotypes",
      subjectRepresentationRequirements: ["Represent an adult Indian woman naturally and respectfully."],
      textSafeRegions: ["Upper-left third and lower-left footer inside safe margins"],
      references: [],
      assets: [{
        sequence: 1,
        role: "FEED_VISUAL",
        imagePrompt,
        overlayInstructions: "Keep upper-left and lower-left regions clear for exact approved overlay copy.",
        requiredObjects: ["A simple notebook and pen"],
        prohibitedObjects: ["Visible text, watermarks, unrelated logos, fake interfaces and currency notes"],
      }],
    },
    verifiedProductFacts: null,
  };
}

function readyFixture() {
  const recommendation = validSingleImageRecommendation();
  const draft = {
    _id: "draft-1",
    generation_run_id: "run-1",
    status: "APPROVED",
    revision: 3,
    approved_revision: 3,
    approved_at: new Date("2026-08-22T08:00:00.000Z"),
    approved_by_admin_id: "admin-1",
    current_package: { primaryRecommendation: recommendation },
    asset_ids: ["asset-1"],
  };
  const assets = [{
    _id: "asset-1",
    is_active: true,
    deleted_at: null,
    slide_number: 1,
    url: "https://media.pinkpaisa.in/social/draft-1.jpg",
    validation_status: "valid",
    manual_review_required: false,
    manual_review_status: "not_required",
    image_generation_status: "SUCCEEDED",
    image_provider: "openai",
    image_model: "gpt-image-2",
    original_asset_url: "https://media.pinkpaisa.in/social/draft-1-ai-original.jpg",
    source_provenance: "generated_without_reference",
    provenance: {
      base_image: {
        type: "openai_generated_original_visual",
        generation_status: "SUCCEEDED",
        provider: "openai",
        model: "gpt-image-2",
        source_url: "https://media.pinkpaisa.in/social/draft-1-ai-original.jpg",
        source_provenance: "generated_without_reference",
      },
    },
  }];
  const settings = {
    approval: { require_human_approval: true },
    publishing: { enabled: true, provider: "INSTAGRAM_GRAPH", auto_publish: false },
  };
  const connection = {
    id: "connection-1",
    is_connected: true,
    status: "connected",
    instagram_username: "pinkpaisa",
    account_type: "BUSINESS",
    granted_scopes: ["instagram_business_content_publish"],
    token_expires_at: "2026-09-22T00:00:00.000Z",
  };
  return { draft, assets, settings, connection };
}

function withPublishingEnv(value, callback) {
  const previousManager = process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED;
  const previousInstagram = process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
  process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED = value;
  delete process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previousManager === undefined) delete process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED;
      else process.env.SOCIAL_MANAGER_PUBLISHING_ENABLED = previousManager;
      if (previousInstagram === undefined) delete process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED;
      else process.env.SOCIAL_INSTAGRAM_PUBLISHING_ENABLED = previousInstagram;
    });
}

test("publishing remains disabled unless both the server and admin flags are enabled", async () => {
  await withPublishingEnv("false", () => {
    const fixture = readyFixture();
    assert.equal(publishingFeatureEnabled(fixture.settings), false);
    const readiness = buildReadiness({ ...fixture, now: new Date("2026-08-22T09:00:00.000Z"), publishNow: true });
    assert.equal(readiness.ready, false);
    assert.ok(readiness.blockers.some((blocker) => blocker.code === "publishing_disabled"));
  });

  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    assert.equal(publishingFeatureEnabled({ ...fixture.settings, publishing: { ...fixture.settings.publishing, enabled: false } }), false);
    assert.equal(publishingFeatureEnabled(fixture.settings), true);
  });
});

test("readiness requires approval of the current revision and Instagram publish permission", async () => {
  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    const ready = buildReadiness({ ...fixture, now: new Date("2026-08-22T09:00:00.000Z"), publishNow: true });
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.blockers, []);

    const staleApproval = buildReadiness({
      ...fixture,
      draft: { ...fixture.draft, approved_revision: 2 },
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: true,
    });
    assert.equal(staleApproval.ready, false);
    assert.ok(staleApproval.blockers.some((blocker) => blocker.code === "approval_required"));

    const missingPermission = buildReadiness({
      ...fixture,
      connection: { ...fixture.connection, granted_scopes: ["instagram_basic"] },
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: true,
    });
    assert.equal(missingPermission.ready, false);
    assert.ok(missingPermission.blockers.some((blocker) => blocker.code === "instagram_permission_missing"));
  });
});

test("scheduled readiness blocks early publication and permits a due schedule", async () => {
  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    const scheduled = {
      ...fixture.draft,
      status: "SCHEDULED",
      scheduled_for: new Date("2026-08-22T10:00:00.000Z"),
    };
    const early = buildReadiness({
      ...fixture,
      draft: scheduled,
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: false,
    });
    assert.ok(early.blockers.some((blocker) => blocker.code === "schedule_not_due"));

    const due = buildReadiness({
      ...fixture,
      draft: scheduled,
      now: new Date("2026-08-22T10:00:00.000Z"),
      publishNow: false,
    });
    assert.equal(due.ready, true);
  });
});

test("Instagram caption assembly preserves early affiliate disclosure, CTA, and hashtags", () => {
  const recommendation = validSingleImageRecommendation();
  recommendation.affiliateDisclosure = "Affiliate disclosure: Pink Paisa may earn a commission.";
  recommendation.caption = "A practical caption for today.";
  recommendation.cta = "Save this for later.";
  recommendation.financialDisclaimer = "Educational content only.";
  recommendation.hashtags = ["#PinkPaisa", "#MoneyConfidence", "#WomenAndMoney", "#FinancialWellness", "#IndianWomen"];
  const caption = buildInstagramCaption(recommendation);
  assert.equal(caption.split("\n\n")[0], recommendation.affiliateDisclosure);
  assert.match(caption, /Save this for later\./);
  assert.match(caption, /#PinkPaisa #MoneyConfidence #WomenAndMoney #FinancialWellness #IndianWomen$/);
});

test("publishing readiness blocks a complete Instagram caption over 2,200 characters", async () => {
  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    fixture.draft.current_package.primaryRecommendation.caption = "x".repeat(2200);
    const readiness = buildReadiness({ ...fixture, now: new Date("2026-08-22T09:00:00.000Z"), publishNow: true });
    assert.ok(readiness.blockers.some((blocker) => blocker.code === "caption_length_invalid"));
  });
});

test("publishing readiness rejects a caption changed after approval", async () => {
  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    const approved = buildReadiness({
      ...fixture,
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: true,
    });
    fixture.draft.approval_json = {
      caption_checksum_sha256: approved.caption_checksum_sha256,
    };

    const unchanged = buildReadiness({
      ...fixture,
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: true,
    });
    assert.equal(unchanged.blockers.some((blocker) => blocker.code === "caption_approval_checksum_mismatch"), false);

    fixture.draft.current_package.primaryRecommendation.cta = "Use the updated call to action.";
    const changed = buildReadiness({
      ...fixture,
      now: new Date("2026-08-22T09:00:00.000Z"),
      publishNow: true,
    });
    assert.ok(changed.blockers.some((blocker) => blocker.code === "caption_approval_checksum_mismatch"));
  });
});

test("affiliate publishing readiness requires the exact active catalog identity and landing page", async () => {
  await withPublishingEnv("true", () => {
    const fixture = readyFixture();
    const recommendation = fixture.draft.current_package.primaryRecommendation;
    recommendation.contentPillar = "Curated Wellness and Affiliate Products";
    recommendation.verifiedProductId = "product-1";
    recommendation.verifiedProductTitle = "Calm Wellness Journal";
    recommendation.affiliateDisclosure = "Affiliate disclosure: Pink Paisa may earn a commission.";
    recommendation.recommendedLandingPage = "/product/calm-wellness-journal";
    const product = { _id: "product-1", title: "Calm Wellness Journal", slug: "calm-wellness-journal" };
    const ready = buildReadiness({ ...fixture, affiliateProduct: product, now: new Date("2026-08-22T09:00:00.000Z"), publishNow: true });
    assert.equal(ready.blockers.some((blocker) => blocker.code === "affiliate_product_unverified"), false);
    const missing = buildReadiness({ ...fixture, affiliateProduct: null, now: new Date("2026-08-22T09:00:00.000Z"), publishNow: true });
    assert.ok(missing.blockers.some((blocker) => blocker.code === "affiliate_product_unverified"));
  });
});

test("guarded publishing never invokes the Instagram adapter when publishing is disabled", async () => {
  await withPublishingEnv("false", async () => {
    const fixture = readyFixture();
    let publishCalls = 0;
    const audits = [];
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: {
        find: () => ({ sort: async () => fixture.assets }),
      },
      SocialPublication: { findOne: async () => null },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      getInstagramConnectionSummary: async () => fixture.connection,
      publishInstagramDraft: async () => {
        publishCalls += 1;
        throw new Error("must not be reached");
      },
    };

    await assert.rejects(
      publishSocialDraft({
        draftId: fixture.draft._id,
        settings: fixture.settings,
        dependencies,
      }),
      (error) => error.code === "publishing_disabled" && error.statusCode === 409,
    );
    assert.equal(publishCalls, 0);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "PUBLISH_BLOCKED");
  });
});

test("Publish now queues a durable intent without calling Instagram in the request", async () => {
  await withPublishingEnv("true", async () => {
    const fixture = readyFixture();
    fixture.draft.save = async () => fixture.draft;
    const audits = [];
    let createdInput = null;
    let instagramCalls = 0;
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: { find: () => ({ sort: async () => fixture.assets }) },
      SocialPublication: {
        findOne: async () => null,
        create: async (input) => {
          createdInput = input;
          return { _id: "publication-1", ...input, attempt_count: 0, save: async function save() { return this; } };
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      getInstagramConnectionSummary: async () => fixture.connection,
      publishInstagramDraft: async () => { instagramCalls += 1; },
    };
    const result = await queueSocialPublication({
      draftId: fixture.draft._id,
      settings: fixture.settings,
      actorAdminId: "admin-1",
      now: new Date("2026-08-22T09:00:00.000Z"),
      dependencies,
    });
    assert.equal(instagramCalls, 0);
    assert.equal(result.publication.status, "QUEUED");
    assert.equal(createdInput.max_attempts, 4);
    assert.equal(fixture.draft.publication_id, "publication-1");
    assert.equal(audits.at(-1).action, "PUBLISH_QUEUED");
  });
});

test("atomic publication claim prevents a second worker from reaching Instagram", async () => {
  await withPublishingEnv("true", async () => {
    const fixture = readyFixture();
    const recommendation = fixture.draft.current_package.primaryRecommendation;
    const caption = buildInstagramCaption(recommendation);
    const { buildPublicationFingerprint } = require("../services/social/socialCompliance");
    const payloadFingerprint = buildPublicationFingerprint({
      recommendation: { ...recommendation, caption },
      assetUrls: fixture.assets.map((asset) => asset.url),
    });
    const publication = {
      _id: "publication-1",
      draft_id: fixture.draft._id,
      status: "QUEUED",
      attempt_count: 0,
      max_attempts: 4,
      payload_fingerprint: payloadFingerprint,
    };
    let instagramCalls = 0;
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: { find: () => ({ sort: async () => fixture.assets }) },
      SocialPublication: {
        findOne: async () => publication,
        findOneAndUpdate: async () => null,
      },
      SocialAuditLog: { create: async (entry) => entry },
      getInstagramConnectionSummary: async () => fixture.connection,
      publishInstagramDraft: async () => { instagramCalls += 1; },
    };
    await assert.rejects(
      publishSocialDraft({ draftId: fixture.draft._id, settings: fixture.settings, dependencies }),
      (error) => error.code === "publish_in_progress" && error.statusCode === 409,
    );
    assert.equal(instagramCalls, 0);
  });
});

test("a provider result without Meta's media identifier is quarantined and never marked published", async () => {
  await withPublishingEnv("true", async () => {
    const fixture = readyFixture();
    fixture.draft.manual_action_ids = [];
    fixture.draft.save = async () => fixture.draft;
    const recommendation = fixture.draft.current_package.primaryRecommendation;
    const caption = buildInstagramCaption(recommendation);
    const { buildPublicationFingerprint } = require("../services/social/socialCompliance");
    const payloadFingerprint = buildPublicationFingerprint({
      recommendation: { ...recommendation, caption },
      assetUrls: fixture.assets.map((asset) => asset.url),
    });
    const publication = {
      _id: "publication-missing-id",
      draft_id: fixture.draft._id,
      status: "QUEUED",
      attempt_count: 0,
      retry_count: 0,
      max_attempts: 4,
      payload_fingerprint: payloadFingerprint,
      child_creation_ids: [],
      async save() { return this; },
    };
    const audits = [];
    const actions = [];
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: { find: () => ({ sort: async () => fixture.assets }) },
      SocialPublication: {
        findOne: async () => publication,
        findOneAndUpdate: async () => {
          publication.status = "VALIDATING";
          publication.attempt_count += 1;
          return publication;
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          const action = { _id: "manual-uncertain-publish-1", ...update.$setOnInsert };
          actions.push(action);
          return action;
        },
      },
      getInstagramConnectionSummary: async () => fixture.connection,
      assertWeeklyPublicationCapacity: async () => ({ ok: true }),
      publishInstagramDraft: async () => ({
        content_type: "single_image",
        creation_id: "container-1",
        media_id: null,
        permalink: null,
      }),
    };

    await assert.rejects(
      () => publishSocialDraft({
        draftId: fixture.draft._id,
        settings: fixture.settings,
        dependencies,
      }),
      (error) => error.code === "instagram_publish_identifier_missing"
        && error.details.instagram_outcome_uncertain === true,
    );
    assert.equal(publication.status, "UNCERTAIN");
    assert.equal(publication.external_publication_id, undefined);
    assert.equal(fixture.draft.status, "FAILED");
    assert.equal(fixture.draft.last_error.stage, "PUBLISH_OUTCOME_UNCERTAIN");
    assert.deepEqual(fixture.draft.manual_action_ids, ["manual-uncertain-publish-1"]);
    assert.equal(fixture.draft.publication_json.reconciliation_manual_action_id, "manual-uncertain-publish-1");
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "PUBLISH_RECONCILIATION");
    assert.equal(actions[0].priority, "CRITICAL");
    assert.equal(actions[0].publication_id, publication._id);
    assert.match(actions[0].instructions.join(" "), /Do not publish this draft again/i);
    assert.ok(audits.some((audit) => audit.action === "PUBLISH_OUTCOME_UNCERTAIN"));
    assert.ok(audits.some((audit) => audit.metadata?.manual_action_id === "manual-uncertain-publish-1"));
    assert.equal(audits.some((audit) => audit.action === "PUBLISHED"), false);
  });
});

test("a successful Meta publish with failed media enrichment stays published and creates durable follow-up", async () => {
  await withPublishingEnv("true", async () => {
    const fixture = readyFixture();
    fixture.draft.manual_action_ids = [];
    fixture.draft.save = async () => fixture.draft;
    const recommendation = fixture.draft.current_package.primaryRecommendation;
    recommendation.hashtags = ["PinkPaisa", "#MoneyConfidence", "##EmergencyFund", "WomenAndMoney", "FinancialWellness"];
    const caption = buildInstagramCaption(recommendation);
    const reviewedCaptionContract = buildSocialCaptionContract(recommendation);
    fixture.draft.approval_json = { caption_checksum_sha256: reviewedCaptionContract.checksum_sha256 };
    const { buildPublicationFingerprint } = require("../services/social/socialCompliance");
    const payloadFingerprint = buildPublicationFingerprint({
      recommendation: { ...recommendation, caption },
      assetUrls: fixture.assets.map((asset) => asset.url),
    });
    const publication = {
      _id: "publication-enrichment-warning",
      draft_id: fixture.draft._id,
      status: "QUEUED",
      attempt_count: 0,
      retry_count: 0,
      max_attempts: 4,
      payload_fingerprint: payloadFingerprint,
      child_creation_ids: [],
      async save() { return this; },
    };
    const actions = [];
    const audits = [];
    const weeklySyncs = [];
    let providerCaption = null;
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: { find: () => ({ sort: async () => fixture.assets }) },
      SocialPublication: {
        findOne: async () => publication,
        findOneAndUpdate: async () => {
          publication.status = "VALIDATING";
          publication.attempt_count += 1;
          return publication;
        },
      },
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          const action = { _id: "manual-enrichment-1", ...update.$setOnInsert };
          actions.push(action);
          return action;
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      getInstagramConnectionSummary: async () => fixture.connection,
      assertWeeklyPublicationCapacity: async () => ({ ok: true }),
      syncWeeklyPlanFromDraft: async (_draft, state) => { weeklySyncs.push(state); },
      publishInstagramDraft: async (input) => {
        providerCaption = input.caption;
        return {
          content_type: "single_image",
          creation_id: "container-enrichment-warning",
          media_id: "meta-media-enrichment-1",
          permalink: null,
          enrichment_warning: {
            code: "instagram_media_enrichment_failed",
            message: "UNTRUSTED provider detail access_token=do-not-store",
            provider_status: 503,
            provider_code: "2",
            is_retriable: true,
          },
          connection: { instagram_username: "pinkpaisa" },
        };
      },
    };

    const result = await publishSocialDraft({
      draftId: fixture.draft._id,
      settings: fixture.settings,
      dependencies,
    });

    assert.equal(result.status, "PUBLISHED");
    assert.equal(caption, reviewedCaptionContract.caption);
    assert.equal(providerCaption, reviewedCaptionContract.caption);
    assert.match(providerCaption, /#PinkPaisa #MoneyConfidence #EmergencyFund #WomenAndMoney #FinancialWellness$/);
    assert.equal(publication.status, "PUBLISHED");
    assert.equal(publication.external_publication_id, "meta-media-enrichment-1");
    assert.equal(publication.external_permalink, null);
    assert.equal(publication.provider_response_metadata.media_enrichment_status, "WARNING");
    assert.equal(publication.provider_response_metadata.media_enrichment_warning.code, "instagram_media_enrichment_failed");
    assert.doesNotMatch(JSON.stringify(publication.provider_response_metadata), /UNTRUSTED|do-not-store/i);
    assert.equal(fixture.draft.status, "PUBLISHED");
    assert.equal(fixture.draft.publication_json.media_enrichment_status, "WARNING");
    assert.equal(fixture.draft.publication_json.media_enrichment_manual_action_id, "manual-enrichment-1");
    assert.deepEqual(fixture.draft.manual_action_ids, ["manual-enrichment-1"]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "PUBLISH_RECONCILIATION");
    assert.equal(actions[0].publication_id, publication._id);
    assert.equal(actions[0].external_reference_id, "meta-media-enrichment-1");
    assert.match(actions[0].instructions.join(" "), /Do not publish this draft again/i);
    assert.equal(weeklySyncs.at(-1).status, "PUBLISHED");
    assert.ok(audits.some((audit) => audit.action === "PUBLISHED" && audit.action_status === "SUCCEEDED"));
    assert.ok(audits.some((audit) => audit.action === "PUBLISHED_MEDIA_ENRICHMENT_FAILED" && audit.action_status === "FAILED"));
    assert.equal(audits.some((audit) => audit.action === "PUBLISH_FAILED"), false);
  });
});

test("a due scheduled readiness failure becomes a visible failed draft and linked manual action", async () => {
  await withPublishingEnv("true", async () => {
    const fixture = readyFixture();
    fixture.draft.status = "SCHEDULED";
    fixture.draft.scheduled_for = new Date("2026-08-22T09:00:00.000Z");
    fixture.draft.manual_action_ids = [];
    fixture.draft.save = async () => fixture.draft;
    fixture.connection.granted_scopes = [];
    const actions = [];
    const audits = [];
    let providerCalls = 0;
    const dependencies = {
      SocialPostDraft: { findById: async () => fixture.draft },
      SocialAsset: { find: () => ({ sort: async () => fixture.assets }) },
      SocialPublication: { findOne: async () => null },
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          const action = { _id: "manual-readiness-1", ...update.$setOnInsert };
          actions.push(action);
          return action;
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      getInstagramConnectionSummary: async () => fixture.connection,
      assertWeeklyPublicationCapacity: async () => ({ ok: true }),
      publishInstagramDraft: async () => { providerCalls += 1; },
    };

    await assert.rejects(
      () => publishSocialDraft({
        draftId: fixture.draft._id,
        settings: fixture.settings,
        publishNow: false,
        now: new Date("2026-08-22T09:01:00.000Z"),
        dependencies,
      }),
      (error) => error.code === "instagram_permission_missing"
        && error.manual_action_id === "manual-readiness-1",
    );
    assert.equal(providerCalls, 0);
    assert.equal(fixture.draft.status, "FAILED");
    assert.equal(fixture.draft.last_error.stage, "PUBLISHING_READINESS");
    assert.deepEqual(fixture.draft.manual_action_ids, ["manual-readiness-1"]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action_type, "PUBLISH_RECONCILIATION");
    assert.equal(actions[0].draft_id, fixture.draft._id);
    assert.ok(audits.some((audit) => audit.action === "PUBLISH_BLOCKED" && audit.metadata.scheduled_failure_persisted === true));
  });
});

test("stale post-checkpoint publication is quarantined as uncertain without retry", async () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const stale = {
    _id: "publication-1",
    draft_id: "draft-1",
    status: "PUBLISHING",
    lease_expires_at: new Date("2026-08-22T09:55:00.000Z"),
  };
  const recovered = {
    ...stale,
    status: "UNCERTAIN",
    next_retry_at: null,
    last_error: {
      code: "stale_publish_outcome_uncertain",
      message: "Manual reconciliation required.",
    },
  };
  const draft = { _id: "draft-1", generation_run_id: "run-1", status: "PUBLISHING", save: async function save() { return this; } };
  const audits = [];
  const actions = [];
  const weeklySyncs = [];
  const result = await recoverStaleSocialPublications({
    now,
    dependencies: {
      SocialPublication: {
        find: () => ({ sort: () => ({ limit: async () => [stale] }) }),
        findOneAndUpdate: async () => recovered,
      },
      SocialPostDraft: { findById: async () => draft },
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          const action = { _id: "manual-stale-publish-1", ...update.$setOnInsert };
          actions.push(action);
          return action;
        },
      },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      syncWeeklyPlanFromDraft: async (_draft, input) => { weeklySyncs.push(input); },
    },
  });
  assert.deepEqual(result, { inspected: 1, requeued: 0, uncertain: 1 });
  assert.equal(draft.status, "FAILED");
  assert.equal(draft.last_error.stage, "PUBLISH_OUTCOME_UNCERTAIN");
  assert.deepEqual(draft.manual_action_ids, ["manual-stale-publish-1"]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].publication_id, "publication-1");
  assert.equal(audits[0].action, "PUBLISH_OUTCOME_UNCERTAIN");
  assert.equal(audits[0].metadata.manual_action_id, "manual-stale-publish-1");
  assert.equal(weeklySyncs[0].status, "FAILED");
  assert.equal(weeklySyncs[0].publicationId, "publication-1");
});

test("an administrator reconciles an uncertain publication atomically with an authoritative Meta media ID and no provider call", async () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const session = { id: "publication-reconciliation-session" };
  let transactionCalls = 0;
  let ended = false;
  let publicationSaveSession = null;
  let draftSaveSession = null;
  let actionCompletionCalls = 0;
  const publication = {
    _id: "publication-reconcile-1",
    draft_id: "draft-reconcile-1",
    generation_run_id: "run-reconcile-1",
    provider: "INSTAGRAM_GRAPH",
    status: "UNCERTAIN",
    creation_id: "container-parent-1",
    child_creation_ids: ["container-child-1"],
    provider_checkpoint: { creation_id: "container-parent-1", child_creation_ids: ["container-child-1"] },
    external_publication_id: null,
    external_permalink: null,
    last_error: { code: "instagram_publish_identifier_missing" },
    async save(options) { publicationSaveSession = options?.session || null; return this; },
  };
  const draft = {
    _id: "draft-reconcile-1",
    generation_run_id: "run-reconcile-1",
    weekly_plan_id: "plan-reconcile-1",
    candidate_id: "candidate-reconcile-1",
    publication_id: "publication-reconcile-1",
    status: "FAILED",
    manual_action_ids: ["manual-publication-reconcile-1"],
    publication_json: { status: "UNCERTAIN", outcome_uncertain: true },
    last_error: { stage: "PUBLISH_OUTCOME_UNCERTAIN" },
    async save(options) { draftSaveSession = options?.session || null; return this; },
  };
  const action = {
    _id: "manual-publication-reconcile-1",
    action_key: "social-publish-reconciliation:publication-reconcile-1:outcome-uncertain",
    action_type: "PUBLISH_RECONCILIATION",
    publication_id: publication._id,
    status: "OPEN",
  };
  const audits = [];
  const weeklySyncs = [];
  const dependencies = {
    startSession: async () => ({
      async withTransaction(work) { transactionCalls += 1; await work(); },
      async endSession() { ended = true; },
    }),
    SocialPublication: {
      findById: async () => publication,
      findOne: async () => null,
    },
    SocialPostDraft: { findById: async () => draft },
    SocialManualAction: {
      findOne: async () => action,
      async findOneAndUpdate(query, update, options) {
        assert.equal(query.action_key, action.action_key);
        assert.ok(query.status.$in.includes(action.status));
        assert.equal(options.session.id, session.id);
        actionCompletionCalls += 1;
        Object.assign(action, update.$set);
        return action;
      },
    },
    SocialAuditLog: {
      async create(value, options) {
        assert.equal(options.session.id, session.id);
        audits.push(...(Array.isArray(value) ? value : [value]));
        return value;
      },
    },
    async syncWeeklyPlanFromDraft(_draft, input) {
      weeklySyncs.push(input);
      assert.equal(input.dependencies.mongoSession.id, session.id);
      return { status: "COMPLETED" };
    },
  };
  dependencies.startSession = async () => ({
    ...session,
    async withTransaction(work) { transactionCalls += 1; await work(); },
    async endSession() { ended = true; },
  });

  const result = await reconcileUncertainPublication(publication._id, {
    actor: { _id: "507f1f77bcf86cd799439014" },
    externalPublicationId: "meta-media-authoritative-1",
    externalPermalink: "https://www.instagram.com/p/pink-paisa-1/",
    notes: "Confirmed the approved post in Instagram and copied its Meta media identifier.",
    now,
    dependencies,
  });
  assert.equal(result.reused, false);
  assert.equal(result.publication.status, "PUBLISHED");
  assert.equal(result.publication.external_publication_id, "meta-media-authoritative-1");
  assert.equal(result.draft.status, "PUBLISHED");
  assert.equal(result.reconciliation.manual_action_status, "COMPLETED");
  assert.equal(transactionCalls, 1);
  assert.equal(ended, true);
  assert.equal(publicationSaveSession.id, session.id);
  assert.equal(draftSaveSession.id, session.id);
  assert.equal(publication.provider_checkpoint.media_id, "meta-media-authoritative-1");
  assert.equal(publication.provider_response_metadata.reconciliation.provider_call_made, false);
  assert.equal(draft.last_error, null);
  assert.equal(draft.publication_json.reconciled_from_admin_confirmation, true);
  assert.equal(action.status, "COMPLETED");
  assert.equal(action.resolution_evidence.provider_reference_id, "meta-media-authoritative-1");
  assert.equal(actionCompletionCalls, 1);
  assert.equal(weeklySyncs.length, 1);
  assert.equal(weeklySyncs[0].status, "PUBLISHED");
  assert.deepEqual(audits.map((audit) => audit.action), [
    "PUBLISH_OUTCOME_RECONCILED",
    "MANUAL_ACTION_COMPLETED",
  ]);
  assert.ok(audits.every((audit) => audit.metadata.provider_call_made === false));

  const repeated = await reconcileUncertainPublication(publication._id, {
    actor: { _id: "507f1f77bcf86cd799439014" },
    externalPublicationId: "meta-media-authoritative-1",
    externalPermalink: "https://www.instagram.com/p/pink-paisa-1/",
    notes: "Repeated request after the original response was lost.",
    dependencies,
  });
  assert.equal(repeated.reused, true);
  assert.equal(actionCompletionCalls, 1);
  assert.equal(audits.length, 2);

  await assert.rejects(
    () => reconcileUncertainPublication(publication._id, {
      actor: { _id: "507f1f77bcf86cd799439014" },
      externalPublicationId: "meta-media-conflicting",
      notes: "Conflicting identifier.",
      dependencies,
    }),
    (error) => error.code === "social_publication_reconciliation_conflict" && error.statusCode === 409,
  );
});

test("publication reconciliation rejects container IDs as non-authoritative before any mutation", async () => {
  let saves = 0;
  const publication = {
    _id: "publication-container-reject",
    draft_id: "draft-container-reject",
    provider: "INSTAGRAM_GRAPH",
    status: "UNCERTAIN",
    creation_id: "container-not-media",
    child_creation_ids: ["child-container-not-media"],
    provider_checkpoint: { creation_id: "checkpoint-container-not-media" },
    async save() { saves += 1; return this; },
  };
  await assert.rejects(
    () => reconcileUncertainPublication(publication._id, {
      actor: { _id: "507f1f77bcf86cd799439014" },
      externalPublicationId: "container-not-media",
      notes: "This is only the creation container.",
      dependencies: { SocialPublication: { findById: async () => publication } },
    }),
    (error) => error.code === "social_publication_external_id_not_authoritative" && error.statusCode === 422,
  );
  assert.equal(saves, 0);
  assert.equal(publication.status, "UNCERTAIN");
});

test("publication reconciliation rejects a Meta media ID already linked to another publication", async () => {
  const publication = {
    _id: "publication-duplicate-media-id",
    draft_id: "draft-duplicate-media-id",
    provider: "INSTAGRAM_GRAPH",
    status: "UNCERTAIN",
    creation_id: "container-duplicate-check",
    child_creation_ids: [],
    provider_checkpoint: { creation_id: "container-duplicate-check" },
    external_publication_id: null,
  };
  let draftReads = 0;
  await assert.rejects(
    () => reconcileUncertainPublication(publication._id, {
      actor: { _id: "507f1f77bcf86cd799439014" },
      externalPublicationId: "meta-media-owned-by-other-publication",
      notes: "Attempted duplicate reconciliation.",
      dependencies: {
        SocialPublication: {
          findById: async () => publication,
          findOne: async () => ({ _id: "other-publication" }),
        },
        SocialPostDraft: { findById: async () => { draftReads += 1; return null; } },
      },
    }),
    (error) => error.code === "social_publication_reconciliation_conflict" && error.statusCode === 409,
  );
  assert.equal(draftReads, 0);
  assert.equal(publication.status, "UNCERTAIN");
});

test("a late reconciliation audit failure rolls publication, draft, weekly state, and action back together", async () => {
  const publication = {
    _id: "publication-reconcile-rollback",
    draft_id: "draft-reconcile-rollback",
    generation_run_id: "run-reconcile-rollback",
    provider: "INSTAGRAM_GRAPH",
    status: "UNCERTAIN",
    creation_id: "rollback-container",
    child_creation_ids: [],
    provider_checkpoint: { creation_id: "rollback-container" },
    external_publication_id: null,
    last_error: { code: "uncertain" },
    async save() { return this; },
  };
  const draft = {
    _id: "draft-reconcile-rollback",
    generation_run_id: "run-reconcile-rollback",
    weekly_plan_id: "plan-reconcile-rollback",
    candidate_id: "candidate-reconcile-rollback",
    publication_id: publication._id,
    status: "FAILED",
    manual_action_ids: ["manual-reconcile-rollback"],
    publication_json: { status: "UNCERTAIN", outcome_uncertain: true },
    last_error: { stage: "PUBLISH_OUTCOME_UNCERTAIN" },
    async save() { return this; },
  };
  const action = {
    _id: "manual-reconcile-rollback",
    action_key: `social-publish-reconciliation:${publication._id}:outcome-uncertain`,
    action_type: "PUBLISH_RECONCILIATION",
    publication_id: publication._id,
    status: "OPEN",
  };
  const weekly = { status: "ACTIVE" };
  let auditCalls = 0;
  const original = {
    publication: { status: publication.status, external_publication_id: publication.external_publication_id, last_error: publication.last_error, provider_checkpoint: publication.provider_checkpoint },
    draft: { status: draft.status, published_at: draft.published_at, last_error: draft.last_error, publication_json: draft.publication_json },
    action: { status: action.status, completed_at: action.completed_at, resolution_evidence: action.resolution_evidence },
    weekly: weekly.status,
  };
  const dependencies = {
    startSession: async () => ({
      async withTransaction(work) {
        try {
          await work();
        } catch (error) {
          Object.assign(publication, original.publication);
          Object.assign(draft, original.draft);
          Object.assign(action, original.action);
          weekly.status = original.weekly;
          throw error;
        }
      },
      async endSession() {},
    }),
    SocialPublication: { findById: async () => publication, findOne: async () => null },
    SocialPostDraft: { findById: async () => draft },
    SocialManualAction: {
      findOne: async () => action,
      async findOneAndUpdate(_query, update) { Object.assign(action, update.$set); return action; },
    },
    SocialAuditLog: {
      async create(value) {
        auditCalls += 1;
        if (auditCalls === 2) throw new Error("late immutable audit failure");
        return value;
      },
    },
    async syncWeeklyPlanFromDraft() { weekly.status = "COMPLETED"; return weekly; },
  };
  await assert.rejects(
    () => reconcileUncertainPublication(publication._id, {
      actor: { _id: "507f1f77bcf86cd799439014" },
      externalPublicationId: "meta-media-rollback",
      notes: "Confirmed in Meta before the simulated audit failure.",
      dependencies,
    }),
    /late immutable audit failure/,
  );
  assert.equal(publication.status, "UNCERTAIN");
  assert.equal(publication.external_publication_id, null);
  assert.equal(draft.status, "FAILED");
  assert.equal(draft.published_at, undefined);
  assert.equal(action.status, "OPEN");
  assert.equal(weekly.status, "ACTIVE");
});

test("a checkpointed real Meta media ID reconciles both draft and linked weekly lifecycle", async () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const publication = {
    _id: "publication-checkpoint-1",
    draft_id: "draft-checkpoint-1",
    status: "PUBLISHED",
    external_publication_id: "meta-media-123",
    external_permalink: "https://www.instagram.com/p/example/",
    published_at: new Date("2026-08-22T09:59:00.000Z"),
    draft_reconciled_at: null,
    async save() { return this; },
  };
  const draft = {
    _id: "draft-checkpoint-1",
    generation_run_id: "run-checkpoint-1",
    status: "PUBLISHING",
    async save() { return this; },
  };
  const weeklySyncs = [];
  const audits = [];
  const result = await reconcileCheckpointedSocialPublications({
    now,
    dependencies: {
      SocialPublication: {
        find: () => ({ sort: () => ({ limit: async () => [publication] }) }),
      },
      SocialPostDraft: { findById: async () => draft },
      SocialAuditLog: { create: async (entry) => { audits.push(entry); return entry; } },
      syncWeeklyPlanFromDraft: async (_draft, input) => { weeklySyncs.push(input); },
    },
  });

  assert.deepEqual(result, { inspected: 1, reconciled: 1 });
  assert.equal(draft.status, "PUBLISHED");
  assert.equal(draft.publication_json.external_publication_id, "meta-media-123");
  assert.equal(publication.draft_reconciled_at, now);
  assert.equal(weeklySyncs[0].status, "PUBLISHED");
  assert.equal(weeklySyncs[0].publicationId, publication._id);
  assert.equal(audits[0].action, "PUBLISH_RECONCILED_FROM_CHECKPOINT");
});

test("OpenAI structured calls retry transient responses and keep strict, non-stored output", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_API_BASE_URL;
  const previousRandom = Math.random;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_API_BASE_URL = "https://api.openai.test/v1";
  Math.random = () => 0;
  const calls = [];
  try {
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "temporarily busy" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp-social-test",
          output_text: JSON.stringify({ signals: [], unconfirmedTopics: [] }),
          usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
        }),
      };
    };

    const result = await callStructuredResponse({
      stage: "research",
      input: { task: "test" },
      schema: RESEARCH_OUTPUT_SCHEMA,
      fetchImpl,
      maxAttempts: 2,
      timeoutMs: 2000,
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.openai.test/v1/responses");
    assert.equal(calls[0].options.headers.Authorization, "Bearer test-openai-key");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.metadata.stage, "research");
    assert.deepEqual(result.output, { signals: [], unconfirmedTopics: [] });
    assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 4, total_tokens: 16 });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_API_BASE_URL;
    else process.env.OPENAI_API_BASE_URL = previousBase;
    Math.random = previousRandom;
  }
});

async function generatedImageBuffer(seed = 1) {
  const tonePatterns = [
    [20, 45, 70, 95, 120, 145, 170, 195, 220],
    [220, 195, 170, 145, 120, 95, 70, 45, 20],
    [220, 25, 220, 25, 220, 25, 220, 25, 220],
  ];
  const tones = tonePatterns[(seed - 1) % tonePatterns.length];
  const columns = tones.map((tone, index) => (
    `<rect x="${index * 134}" y="0" width="134" height="1500" fill="rgb(${tone},${tone},${tone})" />`
  )).join("");
  const overlay = Buffer.from(`<svg width="1200" height="1500" xmlns="http://www.w3.org/2000/svg">
    ${columns}
  </svg>`);
  return sharp({
    create: {
      width: 1200,
      height: 1500,
      channels: 3,
      background: { r: 177, g: 82, b: 118 },
    },
  }).composite([{ input: overlay, top: 0, left: 0 }]).jpeg({ quality: 90 }).toBuffer();
}

function mockedAssetStore(stored) {
  return async ({ fileName, buffer }) => {
    stored.push({ fileName, buffer });
    return {
      url: `https://media.pinkpaisa.in/social/${fileName}`,
      storage_key: `social/${fileName}`,
      checksum_sha256: `checksum-${stored.length}`,
    };
  };
}

test("single-image generation invokes the configured OpenAI image provider for original artwork", async () => {
  const calls = [];
  const stored = [];
  const buffer = await generatedImageBuffer();
  const result = await generateSocialVisuals({
    draftLike: { generation_date: "2026-08-22", idempotency_key: "single-ai-visual" },
    recommendation: validSingleImageRecommendation(),
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2" },
      ai_generation: { max_image_retries: 1, image_quality: "medium" },
      cost_controls: { daily_image_generation_limit: 10 },
    },
    dependencies: {
      generateOpenAiImage: async (input) => {
        calls.push(input);
        return {
          buffer,
          response_id: "img-single-1",
          usage: { input_tokens: 11, output_tokens: 0, total_tokens: 11 },
        };
      },
      storeCampaignAsset: mockedAssetStore(stored),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-image-2");
  assert.equal(calls[0].size, "1088x1360");
  assert.match(calls[0].prompt, /Pink Paisa/);
  assert.match(calls[0].prompt, /Indian woman/);
  assert.match(calls[0].prompt, /no text|Render no text/i);
  assert.equal(stored.length, 2);
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.provider, "openai");
  assert.equal(result.image_count, 1);
  assert.equal(result.original_visuals[0].response_id, "img-single-1");
  assert.equal(result.original_visuals[0].source_provenance, "generated_without_reference");
  assert.doesNotMatch(result.original_visuals[0].source_provenance, /template/i);
});

test("carousel generation invokes OpenAI once for every required original visual", async () => {
  const calls = [];
  const stored = [];
  const recommendation = validSingleImageRecommendation();
  recommendation.format = "CAROUSEL";
  recommendation.formatContent = {
    ...recommendation.formatContent,
    id: "primary-carousel",
    format: "CAROUSEL",
    formatReason: "Three short actions need a swipeable sequence to remain clear and useful.",
    slideCount: 3,
    narrativeArc: "Name the problem, show two realistic actions, and close with one save-worthy reminder.",
    cohesiveArtDirection: "Warm Pink Paisa editorial scenes with a consistent palette and a distinct composition on each slide.",
    slides: Array.from({ length: 3 }, (_, index) => ({
      slideNumber: index + 1,
      headline: `Step ${index + 1}`,
      body: "One concise, practical and useful emergency-fund action for this slide.",
      imagePrompt: `Create cohesive original Pink Paisa carousel scene ${index + 1} with a distinct composition and generous exact-copy safe space.`,
      overlayInstructions: "Keep the upper-left quadrant clear for exact approved copy.",
    })),
  };
  delete recommendation.formatContent.selectedHeadline;
  delete recommendation.formatContent.supportingText;
  delete recommendation.formatContent.imagePrompt;
  delete recommendation.formatContent.negativeVisualInstructions;
  delete recommendation.formatContent.overlayInstructions;
  recommendation.visualBrief = {
    ...recommendation.visualBrief,
    format: "CAROUSEL",
    assets: Array.from({ length: 3 }, (_, index) => ({
      sequence: index + 1,
      role: index === 0 ? "CAROUSEL_COVER" : "CAROUSEL_SLIDE",
      imagePrompt: `Create cohesive original Pink Paisa carousel scene ${index + 1} with a distinct composition and generous exact-copy safe space.`,
      overlayInstructions: "Keep the upper-left quadrant clear for exact approved copy.",
      requiredObjects: ["A notebook"],
      prohibitedObjects: ["Visible text, watermarks and unrelated logos"],
    })),
  };

  const result = await generateSocialVisuals({
    draftLike: { generation_date: "2026-08-22", idempotency_key: "carousel-ai-visuals" },
    recommendation,
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2" },
      ai_generation: { max_image_retries: 1 },
      cost_controls: { daily_image_generation_limit: 10 },
    },
    dependencies: {
      generateOpenAiImage: async (input) => {
        calls.push(input);
        return { buffer: await generatedImageBuffer(calls.length), response_id: `img-carousel-${calls.length}`, usage: {} };
      },
      storeCampaignAsset: mockedAssetStore(stored),
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(stored.length, 6);
  assert.equal(result.image_count, 3);
  assert.deepEqual(result.original_visuals.map((visual) => visual.sequence), [1, 2, 3]);
  assert.deepEqual(result.original_visuals.map((visual) => visual.response_id), [
    "img-carousel-1",
    "img-carousel-2",
    "img-carousel-3",
  ]);
  assert.equal(new Set(calls.map((call) => call.prompt)).size, 3);
});

test("exhausted OpenAI image attempts expose failure details and never create template artwork", async () => {
  let calls = 0;
  let storeCalls = 0;
  await assert.rejects(
    generateSocialVisuals({
      draftLike: { generation_date: "2026-08-22", idempotency_key: "failed-ai-visual" },
      recommendation: validSingleImageRecommendation(),
      settings: {
        models: { image_provider: "openai", image_model: "gpt-image-2" },
        ai_generation: { max_image_retries: 1 },
      },
      dependencies: {
        generateOpenAiImage: async () => {
          calls += 1;
          const error = new Error("mock image provider unavailable");
          error.code = "provider_unavailable";
          throw error;
        },
        storeCampaignAsset: async () => {
          storeCalls += 1;
          throw new Error("must not store fallback artwork");
        },
      },
    }),
    (error) => {
      assert.equal(error.code, "social_image_generation_failed");
      assert.equal(error.image_generation.sequence, 1);
      assert.equal(error.image_generation.model, "gpt-image-2");
      assert.equal(error.image_generation.failures.length, 1);
      assert.equal(error.image_generation.failures[0].code, "provider_unavailable");
      assert.match(error.image_generation.failures[0].message, /mock image provider unavailable/);
      assert.equal(Object.hasOwn(error.image_generation, "fallback"), false);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.equal(storeCalls, 0);
});

test("product image generation passes the verified authentic product reference without replacement", async () => {
  const calls = [];
  const stored = [];
  const generated = await generatedImageBuffer();
  const sourceBuffer = await sharp({
    create: { width: 900, height: 900, channels: 3, background: { r: 244, g: 231, b: 218 } },
  }).png().toBuffer();
  const recommendation = validSingleImageRecommendation();
  Object.assign(recommendation, {
    format: "PRODUCT_FEATURE",
    postType: "AFFILIATE",
    objective: "PRODUCT_PROMOTION",
    contentPillar: "Curated Wellness and Affiliate Products",
    verifiedProductId: "product-1",
    verifiedProductTitle: "Calm Wellness Journal",
    verifiedProductFacts: {
      id: "product-1",
      title: "Calm Wellness Journal",
      brand: "Calm Co",
      category: "Healthy Lifestyle",
      subcategory: "Journals",
      asin: "B0CALM1234",
      imageUrl: "https://media.pinkpaisa.in/products/calm-wellness-journal.png",
      description: "A guided journal for a reflective desk routine.",
      affiliateUrl: "https://www.amazon.in/dp/B0CALM1234?tag=pinkpaisa-21",
      landingPage: "/product/calm-wellness-journal",
    },
    affiliateDisclosure: "Affiliate link: Pink Paisa may earn a commission at no extra cost to you.",
    recommendedLandingPage: "/product/calm-wellness-journal",
    formatContent: {
      ...recommendation.formatContent,
      format: "PRODUCT_FEATURE",
      postType: "AFFILIATE",
      objective: "PRODUCT_PROMOTION",
      contentPillar: "Curated Wellness and Affiliate Products",
      targetAudience: "Indian women building a calm and consistent reflection routine",
      whyToday: "A gentle weekend reset makes a guided reflection routine relevant today.",
      formatReason: "One authentic product in an original lifestyle setting is clearest as a focused product feature.",
      caption: "Affiliate link: Pink Paisa may earn a commission at no extra cost to you. Explore a guided journal for a calm reflection routine.",
      cta: "See the verified product details on Pink Paisa.",
      hashtags: ["#PinkPaisa", "#FinancialWellness", "#WellnessJournal", "#MindfulRoutine", "#WomenAndWellness"],
      altText: "The authentic Calm Wellness Journal in a warm Pink Paisa desk setting with clear headline space.",
      recommendedLandingPage: "/product/calm-wellness-journal",
      financialDisclaimer: null,
      affiliateDisclosure: "Affiliate link: Pink Paisa may earn a commission at no extra cost to you.",
      verifiedProductId: "product-1",
      verifiedProductTitle: "Calm Wellness Journal",
      verifiedProductImageUrl: "https://media.pinkpaisa.in/products/calm-wellness-journal.png",
      selectedHeadline: "A calmer reflection ritual",
      supportingText: "Meet the verified Calm Wellness Journal.",
      imagePrompt: "Create an original warm Pink Paisa desk environment around the supplied authentic Calm Wellness Journal, preserving its packaging, label, colour, proportions and variant exactly.",
      productPreservationInstructions: ["Keep the supplied product packaging, label, brand, colour, proportions and variant exactly unchanged."],
      negativeVisualInstructions: ["No replacement packaging, altered labels, prices, ratings, watermarks or unrelated logos."],
      overlayInstructions: {
        logoPosition: "Top-right safe area",
        headlinePosition: "Upper-left negative space",
        ctaPosition: "Lower-left safe area",
        disclosurePosition: "Bottom edge inside safe margin",
        safeAreaNotes: "Keep the product fully visible and preserve the upper-left text-safe region.",
      },
    },
    visualBrief: {
      ...recommendation.visualBrief,
      format: "PRODUCT_FEATURE",
      assets: [{
        sequence: 1,
        role: "PRODUCT_SCENE",
        imagePrompt: "Create an original warm Pink Paisa desk environment around the supplied authentic Calm Wellness Journal, preserving its packaging, label, colour, proportions and variant exactly.",
        overlayInstructions: "Keep the upper-left region clear for exact approved headline copy.",
        requiredObjects: ["The supplied authentic product"],
        prohibitedObjects: ["Replacement packaging, altered labels, prices, ratings or unrelated logos"],
      }],
    },
  });

  const result = await generateSocialVisuals({
    draftLike: { generation_date: "2026-08-22", idempotency_key: "product-ai-visual" },
    recommendation,
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2" },
      ai_generation: { max_image_retries: 1 },
    },
    dependencies: {
      getVerifiedProductRecord: async () => ({
        _id: recommendation.verifiedProductFacts.id,
        title: recommendation.verifiedProductFacts.title,
        status: "active",
        is_visible: true,
        archived_at: null,
        is_affiliate: true,
        affiliate_compliance_status: "compliant",
        affiliate_campaign_usage_rights: "admin_confirmed",
        affiliate_campaign_asset_url: recommendation.verifiedProductFacts.imageUrl,
        affiliate_image_provenance: "admin_provided",
      }),
      readAndNormalizeReferenceImage: async (url) => ({
        buffer: sourceBuffer,
        source_url: url,
        mime_type: "image/png",
      }),
      generateOpenAiImage: async (input) => {
        calls.push(input);
        return { buffer: generated, response_id: "img-product-1", usage: {} };
      },
      storeCampaignAsset: mockedAssetStore(stored),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], "reference"), false);
  assert.match(calls[0].prompt, /BACKGROUND ONLY/i);
  assert.match(calls[0].prompt, /do not render, depict, imitate, redraw, retouch or include any product/i);
  assert.equal(result.original_visuals[0].source_provenance, "generated_from_approved_source");
  assert.equal(result.original_visuals[0].reference_image_url, recommendation.verifiedProductFacts.imageUrl);
  assert.equal(result.original_visuals[0].authentic_product_reference.database_record_verified, true);
  assert.equal(result.original_visuals[0].authentic_product_composition.product_pixels_generated_by_ai, false);
  assert.equal(stored.length, 4);
  assert.equal(
    stored.find((row) => row.fileName.includes("authentic-product-reference")).buffer.equals(sourceBuffer),
    true,
  );
});
