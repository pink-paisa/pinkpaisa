const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const sharp = require("sharp");

const SocialAsset = require("../models/SocialAsset");
const SocialManualAction = require("../models/SocialManualAction");
const SocialPublication = require("../models/SocialPublication");
const {
  generateSocialVisuals,
  visualRequestsForRecommendation,
} = require("../services/social/socialAiImageService");
const {
  buildBrandLogoContract,
  serializeBrandLogoContract,
} = require("../services/social/socialBrandLogoPolicy");
const {
  duplicateDraft,
  executeGenerationRun,
  regenerateDraftVisual,
  _private: {
    assembleReelCreative,
    duplicateBrandLogoDraftLike,
    creativeAssetIds,
    persistInstagramNativeManualActions,
    reviewAssetReadiness,
  },
} = require("../services/social/socialManagerService");

function reelRecommendation(audioDirection = "Use Instagram-native trending audio added manually after publishing", format = "REEL") {
  return {
    format,
    imageGenerationPrompt: "Create an original Pink Paisa vertical editorial scene with clear caption-safe space.",
    formatContent: {
      format,
      coverHeadline: "One money habit to try this week",
      coverImagePrompt: "Create an original Pink Paisa vertical Reel cover with warm editorial lighting.",
      audioDirection,
      scenes: [
        {
          sceneNumber: 1,
          durationSeconds: 3,
          voiceover: "Start with one realistic weekly money check-in.",
          onScreenText: "Pick one weekly check-in",
          visualInstruction: "An Indian woman opening a notebook at a warm home workspace.",
        },
        {
          sceneNumber: 2,
          durationSeconds: 4,
          voiceover: "Keep the action small enough to repeat.",
          onScreenText: "Make it repeatable",
          visualInstruction: "A close view of a simple, uncluttered weekly plan.",
        },
      ],
    },
    visualBrief: {
      format,
      assets: [{
        sequence: 1,
        role: format === "VIDEO_FEED" ? "VIDEO_FEED_COVER" : "REEL_COVER",
        imagePrompt: "Create an original Pink Paisa vertical Reel cover with warm editorial lighting.",
        overlayInstructions: "Keep the upper third clear.",
        requiredObjects: ["Notebook"],
        prohibitedObjects: ["Visible logos", "Watermarks"],
      }],
    },
  };
}

function storyboardVisual(sequence, sceneIndex, format = "REEL") {
  return {
    sequence,
    scene_index: sceneIndex,
    asset_purpose: format === "VIDEO_FEED" ? "VIDEO_FEED_STORYBOARD_FRAME" : "REEL_STORYBOARD_FRAME",
    file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\frame-${sequence}.jpg`,
    url: `https://media.pinkpaisa.in/uploads/generated/campaigns/frame-${sequence}.jpg`,
    storage_key: `uploads/generated/campaigns/frame-${sequence}.jpg`,
    checksum_sha256: String(sequence).repeat(64).slice(0, 64),
    provider: "openai",
    model: "gpt-image-2",
  };
}

function passingBrandLogoValidation(contract, responseId = "logo-validator-response", usage = {}) {
  const serialized = serializeBrandLogoContract(contract);
  const box = serialized.safe_corner?.target_box || {};
  const canvasWidth = Number(box.canvas_width || 1080);
  const canvasHeight = Number(box.canvas_height || 1920);
  const width = Number(box.width || 210);
  const height = Number(box.height || 210);
  return {
    decision: "PASS",
    badgeId: serialized.reference_asset_id,
    referenceChecksumSha256: serialized.reference_checksum_sha256,
    approvedLogoPresent: true,
    referenceIdentityMatch: true,
    wordmarkExactMatch: true,
    iconGeometryMatch: true,
    brandColourMatch: true,
    registeredMarkRecognizable: true,
    singleBadgeOccurrence: true,
    observedBadgeCount: 1,
    observedBadgeWidthPx: width,
    safeCornerMatch: true,
    fullyInsideSafeBox: true,
    acceptedWidthRange: true,
    observedCorner: serialized.locked_corner,
    normalizedBoundingBox: {
      x: Number(box.left || 64) / canvasWidth,
      y: Number(box.top || 250) / canvasHeight,
      width: width / canvasWidth,
      height: height / canvasHeight,
    },
    mobileLegible: true,
    protectedContentOverlapPresent: false,
    unapprovedTextPresent: false,
    observedUnapprovedText: null,
    unrelatedLogoOrWatermarkPresent: false,
    issues: [],
    response_id: responseId,
    usage,
    post_generation_logo_overlay_applied: false,
  };
}

async function requiredLogoReelAssemblyInput({ sceneFrames, validateFinalVideoBrandLogo } = {}) {
  const recommendation = reelRecommendation("Original silent narration; no audio");
  const runId = new mongoose.Types.ObjectId();
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    generation_run_id: runId,
    idempotency_key: `social-draft:${runId}:mandatory-brand-logo`,
    manual_action_ids: [],
  };
  const runtimeContract = await buildBrandLogoContract({ draftLike: draft, recommendation });
  draft.brand_logo_contract = serializeBrandLogoContract(runtimeContract);
  return {
    runtimeContract,
    input: {
      draft,
      run: { _id: runId },
      recommendation,
      imageResult: {
        provider: "openai",
        model: "gpt-image-2",
        original_visuals: [
          { sequence: 1, asset_purpose: "REEL_COVER" },
          storyboardVisual(2, 0),
          storyboardVisual(3, 1),
        ],
      },
      creativeResult: {
        asset_group_id: "required-logo-reel-cover",
        assets: [],
        asset_urls: [],
        validation_status: "valid",
        manual_review_required: false,
        manual_review_flags: [],
      },
      visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
      settings: { models: { compliance_model: "gpt-5.6-luna" } },
      dependencies: {
        getGeneratedCampaignAssetReference: () => ({
          filePath: "C:\\workspace\\server\\uploads\\generated\\campaigns\\required-logo-reel.mp4",
        }),
        assembleReel: async (input) => ({
          path: input.outputPath,
          mime_type: "video/mp4",
          size_bytes: 4096,
          checksum_sha256: "f".repeat(64),
          audio_rights: null,
          command_profile: "ffmpeg_h264_aac_1080x1920_v1",
          brand_logo_scene_frames: sceneFrames,
        }),
        validateFinalVideoBrandLogo,
      },
    },
  };
}

test("Reel visual generation expands one cover brief into cover plus approved storyboard scenes", () => {
  const requests = visualRequestsForRecommendation(reelRecommendation());

  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.asset_purpose), [
    "REEL_COVER",
    "REEL_STORYBOARD_FRAME",
    "REEL_STORYBOARD_FRAME",
  ]);
  assert.deepEqual(requests.map((request) => request.sequence), [1, 2, 3]);
  assert.deepEqual(requests.slice(1).map((request) => request.scene_index), [0, 1]);
  assert.match(requests[2].prompt, /Make it repeatable|simple, uncluttered weekly plan/i);
});

test("Video Feed visual generation preserves its distinct cover and storyboard contract", () => {
  const requests = visualRequestsForRecommendation(reelRecommendation("Original silent narration; no audio", "VIDEO_FEED"));

  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.asset_purpose), [
    "VIDEO_FEED_COVER",
    "VIDEO_FEED_STORYBOARD_FRAME",
    "VIDEO_FEED_STORYBOARD_FRAME",
  ]);
  assert.deepEqual(requests.map((request) => request.sequence), [1, 2, 3]);
});

test("Reel image generation accepts and preserves the cover-plus-storyboard count", async () => {
  const image = await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: "#f4d6df" },
  }).jpeg().toBuffer();
  let calls = 0;
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "reel-count-contract", generation_date: "2026-08-23" },
    recommendation: reelRecommendation("Original silent voiceover plan; no audio"),
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2" },
      ai_generation: { max_image_retries: 1 },
    },
    dependencies: {
      generateOpenAiImage: async () => {
        calls += 1;
        return { buffer: image, response_id: `reel-image-${calls}`, usage: {} };
      },
      storeCampaignAsset: async ({ fileName, buffer }) => ({
        url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
        storage_provider: "local",
        storage_key: `uploads/generated/campaigns/${fileName}`,
        file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\${fileName}`,
        checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      }),
      validateBrandLogoReference: async ({ contract }) => (
        passingBrandLogoValidation(contract, `reel-logo-validation-${calls}`)
      ),
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.image_count, 3);
  assert.deepEqual(result.original_visuals.map((visual) => visual.asset_purpose), [
    "REEL_COVER",
    "REEL_STORYBOARD_FRAME",
    "REEL_STORYBOARD_FRAME",
  ]);
  assert.ok(result.original_visuals.every((visual) => visual.file_path.endsWith(".jpg")));
});

test("targeted Reel recovery buys only the requested scene frame before the retained-set rebuild", async () => {
  const image = await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: "#ead1dc" },
  }).jpeg().toBuffer();
  let imageCalls = 0;
  const result = await generateSocialVisuals({
    draftLike: { idempotency_key: "reel-targeted-scene-three", generation_date: "2026-09-02" },
    recommendation: reelRecommendation("Original silent voiceover plan; no audio"),
    settings: {
      models: { image_provider: "openai", image_model: "gpt-image-2" },
      ai_generation: { max_image_retries: 3 },
    },
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    assetSequence: 3,
    comparisonVisuals: [
      { sequence: 1, checksum_sha256: "1".repeat(64) },
      { sequence: 2, checksum_sha256: "2".repeat(64) },
    ],
    dependencies: {
      generateOpenAiImage: async () => {
        imageCalls += 1;
        return { buffer: image, response_id: "reel-target-scene-2", usage: {} };
      },
      validateBrandLogoReference: async ({ contract }) => (
        passingBrandLogoValidation(contract, "reel-target-scene-2-logo")
      ),
      storeCampaignAsset: async ({ fileName, buffer }) => ({
        url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
        storage_provider: "local",
        storage_key: `uploads/generated/campaigns/${fileName}`,
        file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\${fileName}`,
        checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      }),
    },
  });

  assert.equal(imageCalls, 1);
  assert.equal(result.partial_generation, true);
  assert.equal(result.requested_asset_sequence, 3);
  assert.equal(result.original_visuals.length, 1);
  assert.equal(result.original_visuals[0].sequence, 3);
  assert.equal(result.original_visuals[0].scene_index, 1);
  assert.equal(result.original_visuals[0].asset_purpose, "REEL_STORYBOARD_FRAME");
});

test("injected Reel assembly cycles bounded frames across every scene and persists MP4, SRT, cover, and native-audio work", async () => {
  const draftId = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const coverId = new mongoose.Types.ObjectId();
  const draft = {
    _id: draftId,
    generation_run_id: runId,
    weekly_plan_id: null,
    idempotency_key: `social-draft:${runId}:1`,
    manual_action_ids: [],
  };
  const cover = {
    _id: coverId,
    asset_role: "FINAL_COMPOSED",
    asset_type: "reel_cover",
    media_kind: "IMAGE",
    publication_role: "COVER",
    social_format: "REEL",
    mime_type: "image/jpeg",
    validation_status: "valid",
    manual_review_status: "not_required",
    image_generation_status: "VALIDATED",
    image_provider: "openai",
    original_asset_url: "https://media.pinkpaisa.in/cover-original.jpg",
    source_provenance: "generated_without_reference",
    provenance: { base_image: { type: "openai_generated_original_visual" } },
  };
  const updates = [];
  const actions = [];
  let assemblyInput = null;
  let storedSubtitle = null;
  const AssetModel = {
    updateMany: async (query, update) => { updates.push({ query, update }); },
    findOneAndUpdate: async (_query, update) => {
      const document = new SocialAsset(update.$set);
      await document.validate();
      return document;
    },
  };
  const ActionModel = {
    findOneAndUpdate: async (_query, update) => {
      const document = new SocialManualAction(update.$setOnInsert);
      await document.validate();
      actions.push(document);
      return document;
    },
  };

  const recommendation = reelRecommendation();
  recommendation.formatContent.scenes.push({
    sceneNumber: 3,
    durationSeconds: 5,
    voiceover: "Finish with a quick check that the habit still fits real life.",
    onScreenText: "Review and adjust",
    visualInstruction: "The same planner closes her notebook with a calm, confident expression.",
  });
  const result = await assembleReelCreative({
    draft,
    run: { _id: runId },
    recommendation,
    imageResult: {
      provider: "openai",
      model: "gpt-image-2",
      original_visuals: [
        { sequence: 1, asset_purpose: "REEL_COVER" },
        storyboardVisual(2, 0),
        storyboardVisual(3, 1),
      ],
    },
    creativeResult: {
      asset_group_id: "cover-group",
      assets: [cover],
      asset_urls: ["https://media.pinkpaisa.in/cover.jpg"],
      primary_asset_url: "https://media.pinkpaisa.in/cover.jpg",
      validation_status: "valid",
      manual_review_required: false,
      manual_review_flags: [],
    },
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    actor: new mongoose.Types.ObjectId(),
    AssetModel,
    dependencies: {
      SocialManualAction: ActionModel,
      getGeneratedCampaignAssetReference: () => ({ filePath: "C:\\workspace\\server\\uploads\\generated\\campaigns\\reel.mp4" }),
      storeCampaignAsset: async ({ fileName, buffer }) => {
        storedSubtitle = { fileName, text: buffer.toString("utf8") };
        return {
          url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
          storage_provider: "local",
          storage_key: `uploads/generated/campaigns/${fileName}`,
          file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\${fileName}`,
          checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        };
      },
      assembleReel: async (input) => {
        assemblyInput = input;
        return {
          path: input.outputPath,
          mime_type: "video/mp4",
          size_bytes: 4096,
          checksum_sha256: "a".repeat(64),
          audio_rights: null,
          command_profile: "ffmpeg_h264_aac_1080x1920_v1",
        };
      },
    },
  });

  assert.equal(assemblyInput.framePaths.length, 3);
  assert.equal(assemblyInput.scenes.length, 3);
  assert.equal(assemblyInput.framePaths[2], assemblyInput.framePaths[0]);
  assert.equal(assemblyInput.audioPath, null);
  assert.equal(result.assets.length, 3);
  assert.equal(result.reel_video_asset.asset_role, "FINAL_VIDEO");
  assert.equal(result.reel_video_asset.asset_type, "reel_video");
  assert.equal(result.reel_video_asset.media_kind, "VIDEO");
  assert.equal(result.reel_video_asset.publication_role, "PRIMARY_MEDIA");
  assert.equal(result.reel_video_asset.mime_type, "video/mp4");
  assert.equal(result.reel_video_asset.duration_seconds, 12);
  assert.equal(result.primary_asset_url, result.reel_video_asset.url);
  assert.equal(result.reel_video_asset.provenance.storyboard_frames.length, 3);
  assert.equal(result.reel_video_asset.provenance.storyboard_frames[2].reused_for_scene, true);
  assert.equal(result.reel_subtitle_asset.asset_role, "SUBTITLE_TRACK");
  assert.equal(result.reel_subtitle_asset.asset_type, "subtitle_file");
  assert.equal(result.reel_subtitle_asset.media_kind, "SUBTITLE");
  assert.equal(result.reel_subtitle_asset.publication_role, "NOT_PUBLISHABLE");
  assert.equal(result.reel_subtitle_asset.mime_type, "application/x-subrip");
  assert.equal(result.reel_subtitle_asset.subtitle_language, "en-IN");
  assert.equal(result.reel_subtitle_asset.validation_status, "valid");
  assert.match(storedSubtitle.fileName, /\.srt$/);
  assert.match(storedSubtitle.text, /00:00:07,000 --> 00:00:12,000/);
  assert.match(storedSubtitle.text, /Review and adjust/);
  assert.equal((storedSubtitle.text.match(/-->/g) || []).length, 3);
  assert.deepEqual(creativeAssetIds(result.assets).map(String), result.assets.map((asset) => String(asset._id)));
  assert.deepEqual(
    creativeAssetIds(result.assets, { publishableCompositionOnly: true }).map(String),
    [String(cover._id), String(result.reel_video_asset._id)],
  );
  assert.equal(result.manual_review_required, true);
  assert.equal(actions.length, 1);
  assert.match(actions[0].instructions[0], /Instagram-native trending audio before sharing/i);
  assert.deepEqual(draft.manual_action_ids.map(String), [String(actions[0]._id)]);
  assert.ok(updates.some(({ query, update }) => (
    query.asset_type === "reel_cover"
    && update.$set.publication_role === "COVER"
  )));

  const readiness = reviewAssetReadiness(result.assets);
  assert.equal(readiness.passed, true, readiness.issues.join("; "));
  assert.equal(readiness.finalAssets.length, 2);
});

test("Video Feed assembly persists a distinct H.264 primary asset that passes publication readiness", async () => {
  const draftId = new mongoose.Types.ObjectId();
  const runId = new mongoose.Types.ObjectId();
  const cover = {
    _id: new mongoose.Types.ObjectId(),
    asset_role: "FINAL_COMPOSED",
    asset_type: "reel_cover",
    media_kind: "IMAGE",
    publication_role: "COVER",
    social_format: "VIDEO_FEED",
    mime_type: "image/jpeg",
    validation_status: "valid",
    manual_review_status: "not_required",
    image_generation_status: "VALIDATED",
    image_provider: "openai",
    original_asset_url: "https://media.pinkpaisa.in/video-feed-cover-original.jpg",
    source_provenance: "generated_without_reference",
    provenance: { base_image: { type: "openai_generated_original_visual" } },
  };
  const AssetModel = {
    updateMany: async () => undefined,
    findOneAndUpdate: async (_query, update) => {
      const document = new SocialAsset(update.$set);
      await document.validate();
      return document;
    },
  };
  const recommendation = reelRecommendation("Original silent narration; no audio", "VIDEO_FEED");
  const result = await assembleReelCreative({
    draft: {
      _id: draftId,
      generation_run_id: runId,
      idempotency_key: `social-draft:${runId}:1`,
      manual_action_ids: [],
    },
    run: { _id: runId },
    recommendation,
    imageResult: {
      provider: "openai",
      model: "gpt-image-2",
      original_visuals: [
        { sequence: 1, asset_purpose: "VIDEO_FEED_COVER" },
        storyboardVisual(2, 0, "VIDEO_FEED"),
        storyboardVisual(3, 1, "VIDEO_FEED"),
      ],
    },
    creativeResult: {
      asset_group_id: "video-feed-cover-group",
      assets: [cover],
      asset_urls: ["https://media.pinkpaisa.in/video-feed-cover.jpg"],
      primary_asset_url: "https://media.pinkpaisa.in/video-feed-cover.jpg",
      validation_status: "valid",
      manual_review_required: false,
      manual_review_flags: [],
    },
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    AssetModel,
    dependencies: {
      getGeneratedCampaignAssetReference: () => ({ filePath: "C:\\workspace\\server\\uploads\\generated\\campaigns\\video-feed.mp4" }),
      storeCampaignAsset: async ({ fileName, buffer }) => ({
        url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
        storage_provider: "local",
        storage_key: `uploads/generated/campaigns/${fileName}`,
        file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\${fileName}`,
        checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      }),
      assembleReel: async (input) => ({
        path: input.outputPath,
        mime_type: "video/mp4",
        size_bytes: 8192,
        checksum_sha256: "b".repeat(64),
        audio_rights: null,
        command_profile: "ffmpeg_h264_aac_1080x1920_v1",
      }),
    },
  });

  assert.equal(result.reel_video_asset.asset_type, "video_feed");
  assert.equal(result.reel_video_asset.social_format, "VIDEO_FEED");
  assert.equal(result.reel_video_asset.media_kind, "VIDEO");
  assert.equal(result.reel_video_asset.publication_role, "PRIMARY_MEDIA");
  assert.equal(result.reel_video_asset.video_codec, "h264");
  assert.equal(result.reel_video_asset.mime_type, "video/mp4");
  assert.equal(result.manual_actions.length, 0);
  const readiness = reviewAssetReadiness(result.assets);
  assert.equal(readiness.passed, true, readiness.issues.join("; "));

  for (const contentType of ["VIDEO_FEED", "STORY"]) {
    const publication = new SocialPublication({
      draft_id: new mongoose.Types.ObjectId(),
      generation_run_id: runId,
      idempotency_key: `publication-${contentType.toLowerCase()}-${draftId}`,
      provider: "INSTAGRAM_GRAPH",
      approved_revision: 1,
      content_type: contentType,
      asset_ids: [result.reel_video_asset._id],
      asset_urls: [result.reel_video_asset.url],
      caption_hash: "c".repeat(64),
      asset_fingerprint: "d".repeat(64),
      payload_fingerprint: "e".repeat(64),
      readiness_snapshot: { passed: true },
    });
    await publication.validate();
  }

  const invalidPublishedRecord = new SocialPublication({
    draft_id: new mongoose.Types.ObjectId(),
    generation_run_id: runId,
    idempotency_key: `publication-missing-id-${draftId}`,
    provider: "INSTAGRAM_GRAPH",
    approved_revision: 1,
    status: "PUBLISHED",
    content_type: "VIDEO_FEED",
    asset_ids: [result.reel_video_asset._id],
    asset_urls: [result.reel_video_asset.url],
    caption_hash: "c".repeat(64),
    asset_fingerprint: "d".repeat(64),
    payload_fingerprint: "f".repeat(64),
    readiness_snapshot: { passed: true },
  });
  await assert.rejects(
    () => invalidPublishedRecord.validate(),
    /PUBLISHED publications require Meta's published media identifier/,
  );
});

test("mandatory-logo Reel assembly blocks a final MP4 when any scene extraction is missing", async () => {
  const { input } = await requiredLogoReelAssemblyInput({
    sceneFrames: [{ scene_index: 0, timestamp_seconds: 1.5, buffer: Buffer.from("scene-one") }],
    validateFinalVideoBrandLogo: async () => {
      throw new Error("The validator must not run when a final scene frame is missing");
    },
  });

  await assert.rejects(
    () => assembleReelCreative(input),
    (error) => {
      assert.equal(error.code, "social_reel_logo_frame_missing");
      assert.match(error.message, /one independent badge-verification frame for every scene/i);
      return true;
    },
  );
});

test("mandatory-logo Reel assembly blocks a final MP4 when one extracted scene fails badge validation", async () => {
  let validationCalls = 0;
  let runtimeContract;
  const ledgerRows = [];
  const fixture = await requiredLogoReelAssemblyInput({
    sceneFrames: [
      { scene_index: 0, timestamp_seconds: 1.5, buffer: Buffer.from("scene-one") },
      { scene_index: 1, timestamp_seconds: 5, buffer: Buffer.from("scene-two") },
    ],
    validateFinalVideoBrandLogo: async ({ contract }) => {
      validationCalls += 1;
      const evidence = passingBrandLogoValidation(contract, `final-scene-validation-${validationCalls}`);
      if (validationCalls >= 2) {
        return {
          ...evidence,
          decision: "REGENERATE",
          referenceIdentityMatch: false,
          issues: ["The approved Pink Paisa badge is malformed in this final scene."],
        };
      }
      return evidence;
    },
  });
  runtimeContract = fixture.runtimeContract;
  fixture.input.paidEvidenceContext = {
    callId: "paid-call-reel-logo-failure",
    operation: "DUPLICATE",
    requestId: "request-reel-logo-failure",
  };
  fixture.input.dependencies.SocialPaidCallUsageLedger = {
    create: async (row) => { ledgerRows.push(row); return row; },
  };

  await assert.rejects(
    () => assembleReelCreative(fixture.input),
    (error) => {
      assert.equal(error.code, "social_brand_logo_validation_exhausted");
      assert.match(error.message, /did not survive final Reel scale\/crop validation in scene 2/i);
      assert.equal(error.brand_logo_scene_evidence.length, 2);
      assert.equal(error.brand_logo_scene_evidence[0].scene_index, 0);
      assert.equal(error.brand_logo_scene_evidence[1].scene_index, 1);
      assert.equal(error.brand_logo_scene_evidence[1].validation_attempt_count, 3);
      assert.equal(error.brand_logo_scene_evidence[1].post_generation_logo_overlay_applied, false);
      assert.equal(error.reel_logo_validation_evidence.status, "FAILED");
      assert.equal(error.reel_logo_validation_evidence.republish_attempted, false);
      assert.deepEqual(error.reel_logo_validation_evidence.provider_response_ids, [
        "final-scene-validation-1",
        "final-scene-validation-2",
        "final-scene-validation-3",
        "final-scene-validation-4",
      ]);
      assert.equal(
        error.brand_logo_scene_evidence[0].referenceChecksumSha256,
        serializeBrandLogoContract(runtimeContract).reference_checksum_sha256,
      );
      return true;
    },
  );
  assert.equal(validationCalls, 4);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].status, "FAILED");
  assert.equal(ledgerRows[0].operation, "DUPLICATE");
  assert.equal(ledgerRows[0].evidence.validation_attempt_count, 4);
});

test("final-video badge recovery retries only the failing scene and preserves paid validator evidence", async () => {
  let validationCalls = 0;
  const reextractedScenes = [];
  const ledgerRows = [];
  const fixture = await requiredLogoReelAssemblyInput({
    sceneFrames: [
      { scene_index: 0, timestamp_seconds: 1.5, buffer: Buffer.from("scene-one") },
      { scene_index: 1, timestamp_seconds: 5, buffer: Buffer.from("scene-two") },
      { scene_index: 2, timestamp_seconds: 9, buffer: Buffer.from("scene-three-reuses-one") },
    ],
    validateFinalVideoBrandLogo: async ({ contract }) => {
      validationCalls += 1;
      const evidence = passingBrandLogoValidation(
        contract,
        `bounded-final-scene-${validationCalls}`,
        { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      );
      if (validationCalls === 1) {
        return {
          ...evidence,
          decision: "REGENERATE",
          referenceIdentityMatch: false,
          issues: ["First extraction needs a bounded scene-only validation retry."],
        };
      }
      return evidence;
    },
  });
  fixture.input.recommendation.formatContent.scenes.push({
    sceneNumber: 3,
    durationSeconds: 4,
    voiceover: "Repeat the first visual safely.",
    onScreenText: "Repeat safely",
    visualInstruction: "Reuse the first bounded storyboard visual.",
  });
  fixture.input.run.stage_executions = [];
  fixture.input.paidEvidenceContext = {
    callId: "paid-call-reel-logo-1",
    operation: "VISUAL_REGENERATION",
    requestId: "request-reel-logo-1",
  };
  fixture.input.AssetModel = {
    updateMany: async () => undefined,
    findOneAndUpdate: async (_query, update) => ({ _id: new mongoose.Types.ObjectId(), ...update.$set }),
  };
  fixture.input.dependencies.extractReelSceneFrame = async ({ sceneIndex, timestampSeconds }) => {
    reextractedScenes.push(sceneIndex);
    const buffer = Buffer.from(`reextracted-scene-${sceneIndex}`);
    return {
      scene_index: sceneIndex,
      timestamp_seconds: timestampSeconds,
      buffer,
      checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  };
  fixture.input.dependencies.storeCampaignAsset = async ({ fileName, buffer }) => ({
    url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
    storage_provider: "local",
    storage_key: `uploads/generated/campaigns/${fileName}`,
    checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  });
  fixture.input.dependencies.SocialPaidCallUsageLedger = {
    create: async (row) => { ledgerRows.push(row); return row; },
  };

  const result = await assembleReelCreative(fixture.input);

  assert.deepEqual(reextractedScenes, [0]);
  assert.equal(validationCalls, 4);
  assert.equal(result.reel_logo_validation_evidence.status, "SUCCEEDED");
  assert.equal(result.reel_logo_validation_evidence.validation_attempt_count, 4);
  assert.equal(result.reel_logo_validation_evidence.validated_scene_count, 3);
  assert.equal(result.reel_logo_validation_evidence.usage.total_tokens, 48);
  assert.deepEqual(result.reel_logo_validation_evidence.provider_response_ids, [
    "bounded-final-scene-1",
    "bounded-final-scene-2",
    "bounded-final-scene-3",
    "bounded-final-scene-4",
  ]);
  assert.equal(result.reel_video_asset.provenance.brand_logo_scene_evidence[0].validation_attempt_count, 2);
  assert.deepEqual(
    result.reel_video_asset.provenance.brand_logo_scene_evidence.map((row) => row.source_asset_sequence),
    [2, 3, 2],
  );
  assert.equal(result.reel_video_asset.provenance.post_generation_logo_overlay_applied, false);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].status, "SUCCEEDED");
  assert.equal(ledgerRows[0].operation, "VISUAL_REGENERATION");
  assert.equal(ledgerRows[0].evidence.republish_attempted, false);
  assert.equal(fixture.input.run.stage_executions.length, 4);
});

test("explicit collaborator and Story sticker directions create durable manual tasks", async () => {
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    generation_run_id: new mongoose.Types.ObjectId(),
    manual_action_ids: [],
  };
  const actor = new mongoose.Types.ObjectId();
  const persisted = [];
  const actions = await persistInstagramNativeManualActions({
    draft,
    run: { _id: draft.generation_run_id },
    actor,
    recommendation: {
      format: "STORY",
      caption: "Invite @pinkpaisa.partner as collaborator after approval.",
      formatContent: {
        format: "STORY",
        frames: [
          { interactionPrompt: "Add the approved poll sticker: Which habit will you try?" },
          { interactionPrompt: null },
        ],
      },
    },
    dependencies: {
      SocialManualAction: {
        findOneAndUpdate: async (_query, update) => {
          const document = new SocialManualAction(update.$setOnInsert);
          await document.validate();
          persisted.push(document);
          return document;
        },
      },
    },
  });

  assert.equal(actions.length, 2);
  assert.equal(persisted.length, 2);
  assert.equal(draft.manual_action_ids.length, 2);
  assert.ok(actions.some((action) => /collaboration invitation/i.test(action.title)));
  assert.ok(actions.some((action) => /Story sticker/i.test(action.title)));
  assert.ok(actions.every((action) => action.status === "OPEN" && action.action_type === "META_NATIVE_INTERACTION"));
});

test("generation, image regeneration, and duplication all invoke the shared Reel assembly boundary", () => {
  for (const operation of [executeGenerationRun, regenerateDraftVisual, duplicateDraft]) {
    assert.match(operation.toString(), /assembleReelCreative\s*\(/);
  }
  const regenerationSource = regenerateDraftVisual.toString();
  assert.match(regenerationSource, /"REEL", "VIDEO_FEED"/);
  assert.match(regenerationSource, /"ORIGINAL_AI_VISUAL", "GENERATED_FRAME"/);
  assert.match(regenerationSource, /original_visuals: combinedBaseImages/);
});

test("draft duplication reuses the complete frozen badge placement contract", async () => {
  const originalId = new mongoose.Types.ObjectId();
  const originalDraft = { _id: originalId, idempotency_key: `social-draft:${originalId}` };
  const runtime = await buildBrandLogoContract({
    draftLike: originalDraft,
    recommendation: reelRecommendation("Original silent narration; no audio"),
  });
  originalDraft.brand_logo_contract = serializeBrandLogoContract(runtime);

  const duplicateIdentity = duplicateBrandLogoDraftLike(originalDraft, "duplicate-request-key");

  assert.notEqual(duplicateIdentity.idempotency_key, originalDraft.idempotency_key);
  assert.deepEqual(duplicateIdentity.brand_logo_contract, originalDraft.brand_logo_contract);
  assert.equal(
    duplicateIdentity.brand_logo_contract.safe_corner.lock_id,
    originalDraft.brand_logo_contract.safe_corner.lock_id,
  );
  assert.deepEqual(
    duplicateIdentity.brand_logo_contract.safe_corner.target_box,
    originalDraft.brand_logo_contract.safe_corner.target_box,
  );
  assert.equal(duplicateBrandLogoDraftLike({ _id: originalId }, "legacy").brand_logo_contract, undefined);
});
