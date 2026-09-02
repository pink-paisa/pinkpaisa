const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sharp = require("sharp");

const {
  stageSuppliedFullAiGraphic,
  cleanupStagedFullAiGraphic,
} = require("../services/social/socialAiImageService");
const {
  replaceDraftWithSuppliedFullAiGraphic,
  _private: {
    buildNativeFullAiGraphicAssetRows,
    reviewAssetReadiness,
    visualModeProvenancePassed,
  },
} = require("../services/social/socialManagerService");

const textManifest = [
  { key: "brand", text: "PINK PAISA • MONEY SMART" },
  { key: "headline", text: "PAUSE BEFORE YOU SCAN" },
  { key: "subline", text: "Verify. Check. Decide." },
  { key: "number_1", text: "1" },
  { key: "action_1", text: "CHECK THE NAME" },
  { key: "number_2", text: "2" },
  { key: "rupee_symbol", text: "₹" },
  { key: "action_2", text: "CHECK THE AMOUNT" },
  { key: "number_3", text: "3" },
  { key: "action_3", text: "REVIEW DETAILS" },
  { key: "number_4", text: "4" },
  { key: "action_4", text: "STOP IF UNSURE" },
  { key: "disclaimer", text: "Financial education, not financial advice." },
];

function checksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sourcePng() {
  const svg = Buffer.from(`<svg width="1092" height="1440" xmlns="http://www.w3.org/2000/svg">
    <rect width="1092" height="1440" fill="#fff4df"/>
    <rect x="50" y="50" width="992" height="1340" fill="#b80f4d"/>
    <circle cx="546" cy="720" r="280" fill="#351927"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

function passingValidation(blocks = textManifest) {
  return {
    decision: "PASS",
    exactTextMatch: true,
    brandIdentityMatch: true,
    mobileLegible: true,
    safeAreaPassed: true,
    unapprovedTextPresent: false,
    unrelatedLogoOrWatermarkPresent: false,
    observedTextBlocks: blocks.map((block) => block.text),
    issues: [],
    response_id: "resp-independent-vision-1",
  };
}

function memoryStore(records) {
  return async ({ fileName, buffer }) => {
    const row = {
      fileName,
      buffer: Buffer.from(buffer),
      storage_provider: "external",
      storage_key: `native/${fileName}`,
      url: `https://media.pinkpaisa.test/native/${fileName}`,
      checksum_sha256: checksum(buffer),
    };
    records.push(row);
    return row;
  };
}

async function stagedFixture() {
  const sourceBuffer = await sourcePng();
  const stores = [];
  let validatorInput = null;
  const stage = await stageSuppliedFullAiGraphic({
    sourceBuffer,
    format: "SINGLE_IMAGE",
    draftIdentity: "draft-native-test",
    model: null,
    prompt: "Generate the complete Pink Paisa poster with all supplied copy baked into the pixels.",
    generationTool: "codex_builtin_imagegen",
    toolExecutionId: "exec-native-test",
    expectedTextBlocks: textManifest,
    dependencies: {
      storeCampaignAsset: memoryStore(stores),
      validateFullAiGraphicPoster: async (input) => {
        validatorInput = input;
        return passingValidation(input.expectedTextBlocks);
      },
    },
  });
  return { sourceBuffer, stores, validatorInput, stage };
}

test("supplied FULL_AI_GRAPHIC uses fill resize/encoding only and stores distinct byte-identical normalized roles", async () => {
  const { sourceBuffer, stores, validatorInput, stage } = await stagedFixture();
  assert.equal(stores.length, 3);
  assert.deepEqual(stores[0].buffer, sourceBuffer);
  assert.match(stores[0].fileName, /provider-original-01\.png$/);
  assert.notEqual(stage.normalized.url, stage.final.url);
  assert.notEqual(stage.normalized.storage_key, stage.final.storage_key);
  assert.equal(stage.normalized.checksum_sha256, stage.final.checksum_sha256);
  assert.deepEqual(stores[1].buffer, stores[2].buffer);
  assert.equal(stage.normalization.renderer, "sharp_resize_encode_only_v1");
  assert.equal(stage.normalization.resize_fit, "fill");
  assert.equal(stage.normalization.pixel_overlay_applied, false);
  assert.equal(stage.provider_original.mime_type, "image/png");
  assert.equal(stage.provider_response_id, null);
  assert.equal(stage.generation_tool, "codex_builtin_imagegen");
  assert.equal(stage.tool_execution_id, "exec-native-test");
  assert.equal(stage.model, "openai-imagegen-builtin-unspecified");
  assert.deepEqual(validatorInput.expectedTextBlocks, textManifest);
  const metadata = await sharp(validatorInput.buffer).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  assert.equal(metadata.format, "jpeg");
});

test("supplied FULL_AI_GRAPHIC rejects failed independent validation before storing any bytes", async () => {
  const stores = [];
  await assert.rejects(
    stageSuppliedFullAiGraphic({
      sourceBuffer: await sourcePng(),
      format: "SINGLE_IMAGE",
      draftIdentity: "draft-native-invalid",
      prompt: "Generate the full poster.",
      generationTool: "codex_builtin_imagegen",
      toolExecutionId: "exec-native-invalid",
      expectedTextBlocks: textManifest,
      dependencies: {
        storeCampaignAsset: memoryStore(stores),
        validateFullAiGraphicPoster: async () => ({
          ...passingValidation(),
          decision: "REGENERATE",
          unapprovedTextPresent: true,
          issues: ["unexpected text"],
        }),
      },
    }),
    (error) => error.code === "social_full_ai_graphic_poster_invalid",
  );
  assert.equal(stores.length, 0);
});

test("staged FULL_AI_GRAPHIC cleanup deletes every unique file in reverse order", async () => {
  const { stage } = await stagedFixture();
  const deleted = [];
  const result = await cleanupStagedFullAiGraphic(stage.staged_files, {
    deleteCampaignAsset: async (file) => deleted.push(file.storage_key),
  });
  assert.equal(result.failed, 0);
  assert.equal(result.attempted, 3);
  assert.deepEqual(deleted, [...stage.staged_files].reverse().map((file) => file.storage_key));
});

test("legacy FULL_AI_GRAPHIC v1 branded-finish provenance remains accepted", () => {
  const approvedCopy = { selectedHeadline: "Legacy approved headline" };
  const approvedCopyChecksum = checksum(Buffer.from(JSON.stringify(approvedCopy)));
  const validation = {
    decision: "PASS",
    exactHeadlineMatch: true,
    observedText: approvedCopy.selectedHeadline,
    response_id: "resp-legacy-full-ai-v1",
  };
  const asset = {
    visual_mode: "FULL_AI_GRAPHIC",
    renderer: "sharp_svg_overlay",
    approved_copy_checksum_sha256: approvedCopyChecksum,
    overlay_json: {
      brand_name: "Pink Paisa",
      approved_copy: approvedCopy,
      approved_copy_checksum_sha256: approvedCopyChecksum,
      logo: { source: "approved-logo.png" },
      text_rendering: {
        method: "openai_image_with_validated_short_headline",
        image_ai_used_for_text: true,
        full_ai_graphic_text_validation: validation,
      },
    },
    provenance: {
      renderer: "sharp_svg_overlay",
      base_image: { contains_approved_copy_by_design: true, text_validation: validation },
      overlay: {
        method: "sharp_branded_finish_after_validated_ai_headline",
        image_ai_used_for_text: true,
        copy_source: "formatContent",
        approved_copy_checksum_sha256: approvedCopyChecksum,
      },
      logo: { source: "approved-logo.png" },
    },
  };
  assert.equal(visualModeProvenancePassed(asset, "FULL_AI_GRAPHIC", approvedCopy), true);
});

test("native v2 final asset validates and passes manager readiness", async () => {
  const { stage } = await stagedFixture();
  const draftId = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const recommendation = {
    format: "SINGLE_IMAGE",
    caption: "Pause before acting on a financial headline.",
    cta: "Save this checklist.",
    hashtags: ["#PinkPaisa", "#MoneySmart", "#FinancialEducation", "#ScamAwareness", "#WomenAndMoney"],
    financialDisclaimer: "Financial education, not financial advice.",
    affiliateDisclosure: null,
    formatContent: {
      format: "SINGLE_IMAGE",
      selectedHeadline: "PAUSE BEFORE YOU SCAN",
      supportingText: "Verify. Check. Decide.",
    },
  };
  const draft = {
    _id: draftId,
    generation_run_id: runId,
    idempotency_key: "native-v2-draft",
    current_package: { primaryRecommendation: recommendation },
    visual_mode: "FULL_AI_GRAPHIC",
    visual_mode_resolution: { requested: "FULL_AI_GRAPHIC", effective: "FULL_AI_GRAPHIC", eligible: true, reasons: [] },
  };
  const prepared = await buildNativeFullAiGraphicAssetRows({
    draft,
    stage,
    renderItem: {
      sequence: 1,
      source_path: "formatContent",
      approved_copy: {
        selectedHeadline: "PAUSE BEFORE YOU SCAN",
        supportingText: "Verify. Check. Decide.",
      },
    },
    expectedTextBlocks: textManifest,
  });
  draft.full_ai_graphic_manifest = {
    contract_version: 2,
    expected_text_blocks: textManifest,
    checksum_sha256: checksum(Buffer.from(JSON.stringify(textManifest))),
    approved_copy_checksum_sha256: prepared.approvedCopyChecksum,
  };
  // Manager uses its stable object checksum, supplied by the prepared asset.
  draft.full_ai_graphic_manifest.checksum_sha256 = prepared.finalRow.provenance.full_ai_graphic_manifest.checksum_sha256;
  const readiness = reviewAssetReadiness([prepared.originalRow, prepared.finalRow], { draft });
  assert.equal(readiness.passed, true, readiness.issues.join("\n"));
  assert.equal(prepared.originalRow.checksum_sha256, prepared.finalRow.checksum_sha256);
  assert.notEqual(prepared.originalRow.url, prepared.finalRow.url);
  assert.equal(prepared.finalRow.provenance.overlay.method, "none");
  assert.equal(prepared.finalRow.provenance.overlay.pixel_overlay_applied, false);
  assert.equal(prepared.finalRow.overlay_json.logo.source, null);
  assert.equal(prepared.finalRow.overlay_json.text_rendering.method, "openai_image_baked_in_exact_copy");
  assert.equal(prepared.finalRow.manual_review_flags.includes("BASE_IMAGE_CONTAINS_UNAPPROVED_TEXT"), false);
  assert.equal(prepared.finalRow.manual_review_flags.includes("AI_NATIVE_EXACT_TEXT_AND_BRAND"), true);
});

test("late audit failure rolls back the native asset swap and cleans all staged files", async () => {
  const { sourceBuffer, stage } = await stagedFixture();
  const session = { id: "native-transaction-session" };
  const draftId = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const oldFinalId = new mongoose.Types.ObjectId();
  const oldPackage = {
    primaryRecommendation: {
      format: "SINGLE_IMAGE",
      objective: "EDUCATION",
      caption: "Pause before acting on a financial headline.",
      cta: "Save this checklist.",
      hashtags: ["#PinkPaisa", "#MoneySmart", "#FinancialEducation", "#ScamAwareness", "#WomenAndMoney"],
      financialDisclaimer: "Financial education, not financial advice.",
      affiliateDisclosure: null,
      utmParameters: { source: "instagram", medium: "organic_social", campaign: "native-test", content: "poster" },
      onPostCopy: { headline: "Old headline", supportingCopy: "Old supporting copy", slides: [], storyFrames: [], reelScenes: [] },
      imageGenerationPrompt: "Old prompt",
      altText: "Old poster alt text.",
      formatContent: {
        format: "SINGLE_IMAGE",
        selectedHeadline: "Old headline",
        supportingText: "Old supporting copy",
        imagePrompt: "Old prompt",
        altText: "Old poster alt text.",
        overlayInstructions: {},
      },
      visualBrief: {
        visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
        assets: [{ imagePrompt: "Old prompt", overlayInstructions: "Use an exact overlay." }],
      },
    },
  };
  const draft = {
    _id: draftId,
    generation_run_id: runId,
    idempotency_key: "native-rollback-draft",
    current_package: JSON.parse(JSON.stringify(oldPackage)),
    revision: 2,
    status: "APPROVED",
    publication_id: null,
    weekly_plan_id: null,
    asset_ids: [oldFinalId],
    original_ai_asset_ids: [],
    final_composed_asset_ids: [oldFinalId],
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    visual_mode_resolution: { requested: "AI_VISUAL_WITH_EXACT_OVERLAY", effective: "AI_VISUAL_WITH_EXACT_OVERLAY", eligible: true, reasons: [] },
    scheduled_for: new Date("2026-08-30T06:00:00.000Z"),
    approval_json: { required: true, status: "APPROVED", approved_revision: 2 },
    approved_revision: 2,
    saveCalls: [],
    async save(options) { this.saveCalls.push(options); return this; },
  };
  const assets = [{
    _id: oldFinalId,
    draft_id: draftId,
    asset_role: "FINAL_COMPOSED",
    is_active: true,
    deleted_at: null,
  }];
  const sessions = [];
  const query = (resolve) => ({
    session(value) { sessions.push(value); return this; },
    sort() { return this; },
    lean: async () => resolve(),
    then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
  });
  const DraftModel = {
    findById: async () => draft,
  };
  const AssetModel = {
    exists: async () => false,
    async insertMany(rows, options) {
      sessions.push(options.session);
      assets.push(...rows);
      return rows;
    },
    async updateMany(filter, update, options) {
      sessions.push(options.session);
      const excluded = new Set((filter._id?.$nin || []).map(String));
      assets.forEach((asset) => {
        if (String(asset.draft_id) === String(filter.draft_id)
          && asset.is_active === true
          && !excluded.has(String(asset._id))) asset.is_active = update.$set.is_active;
      });
    },
    find() {
      return query(() => assets.filter((asset) => asset.is_active !== false && !asset.deleted_at));
    },
  };
  const AuditModel = {
    findOne: () => query(() => null),
    async create(_rows, options) {
      sessions.push(options.session);
      throw Object.assign(new Error("late audit failure"), { code: "audit_write_failed" });
    },
  };
  let weeklyState = "APPROVED";
  const cleaned = [];
  const startSession = async () => ({
    async withTransaction(work) {
      const draftSnapshot = {
        current_package: JSON.parse(JSON.stringify(draft.current_package)),
        revision: draft.revision,
        status: draft.status,
        asset_ids: [...draft.asset_ids],
        original_ai_asset_ids: [...draft.original_ai_asset_ids],
        final_composed_asset_ids: [...draft.final_composed_asset_ids],
        visual_mode: draft.visual_mode,
        visual_mode_resolution: JSON.parse(JSON.stringify(draft.visual_mode_resolution)),
        scheduled_for: draft.scheduled_for,
        approval_json: JSON.parse(JSON.stringify(draft.approval_json)),
        approved_revision: draft.approved_revision,
      };
      const assetSnapshot = assets.map((asset) => ({ ...asset }));
      const weeklySnapshot = weeklyState;
      try {
        await work();
      } catch (error) {
        Object.assign(draft, draftSnapshot);
        assets.splice(0, assets.length, ...assetSnapshot);
        weeklyState = weeklySnapshot;
        throw error;
      }
    },
    async endSession() {},
    ...session,
  });

  await assert.rejects(
    replaceDraftWithSuppliedFullAiGraphic(draftId, {
      sourceBuffer,
      prompt: "Generate the complete poster with all visible text baked in.",
      expectedTextBlocks: textManifest,
      onImageCopy: {
        headline: "PAUSE BEFORE YOU SCAN",
        supportingText: "Verify. Check. Decide.",
        altText: "A Pink Paisa poster with four checks to pause and verify a financial headline.",
      },
      generationTool: "codex_builtin_imagegen",
      toolExecutionId: "exec-native-test",
      dependencies: {
        SocialPostDraft: DraftModel,
        SocialAsset: AssetModel,
        SocialAuditLog: AuditModel,
        startSession,
        validateSocialPackage: () => true,
        getSocialManagerSettings: async () => ({}),
        buildSocialManagerRuntimeSettings: () => ({}),
        stageSuppliedFullAiGraphic: async () => stage,
        deleteCampaignAsset: async (file) => { cleaned.push(file.storage_key); return true; },
        syncWeeklyPlanFromDraft: async () => { weeklyState = "NEEDS_REVIEW"; },
        getDraftDetail: async () => { throw new Error("must not read detail after rollback"); },
      },
    }),
    /late audit failure/,
  );
  assert.equal(assets.length, 1);
  assert.equal(assets[0].is_active, true);
  assert.equal(draft.status, "APPROVED");
  assert.equal(draft.revision, 2);
  assert.deepEqual(draft.current_package, oldPackage);
  assert.deepEqual(draft.asset_ids.map(String), [String(oldFinalId)]);
  assert.equal(weeklyState, "APPROVED");
  assert.deepEqual(cleaned, [...stage.staged_files].reverse().map((file) => file.storage_key));
  assert.ok(sessions.length >= 4);
  assert.ok(sessions.every((value) => value === session || value?.id === session.id));
});
