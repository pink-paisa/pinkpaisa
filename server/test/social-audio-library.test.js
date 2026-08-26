const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const mongoose = require("mongoose");

const SocialAudioTrack = require("../models/SocialAudioTrack");
const {
  resolveUsableAudioTrack,
  selectDraftAudioTrack,
  uploadAudioTrack,
  updateAudioTrack,
  _private: { hashIp, inspectUploadContract, resolveAudioLibraryRoot, resolveFfprobeBinary },
} = require("../services/social/socialAudioLibraryService");
const { buildReadiness } = require("../services/social/socialPublishingService");
const { _private: { assembleReelCreative } } = require("../services/social/socialManagerService");
const { assembleReel } = require("../services/social/socialReelAssemblyService");
const { _private: { selectForDraftWithServices } } = require("../controllers/socialAudioLibraryController");

const adminId = new mongoose.Types.ObjectId();
const trackId = new mongoose.Types.ObjectId();
const draftId = new mongoose.Types.ObjectId();
const checksum = "a".repeat(64);

function mp3Buffer() {
  return Buffer.concat([Buffer.from("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0015", "binary"), Buffer.alloc(100, 7)]);
}

function usableTrack(overrides = {}) {
  return {
    _id: trackId,
    title: "Pink Paisa owned rhythm",
    source: "Commissioned directly for Pink Paisa",
    original_filename: "pink-paisa-rhythm.mp3",
    storage_provider: "local",
    storage_key: "private/social-audio-library/pinkpaisa-audio-test.mp3",
    checksum_sha256: checksum,
    mime_type: "audio/mpeg",
    extension: ".mp3",
    file_size_bytes: 110,
    duration_seconds: 30,
    audio_codec: "mp3",
    sample_rate_hz: 44100,
    audio_channels: 2,
    license_status: "OWNED",
    license_reference: "Internal commission PP-AUDIO-001",
    rights_confirmed: true,
    rights_confirmation_statement: "I verified Pink Paisa may edit and publish this recording.",
    rights_confirmed_by_admin_id: adminId,
    rights_confirmed_at: new Date("2026-08-23T10:00:00.000Z"),
    rights_events: [],
    uploaded_by_admin_id: adminId,
    is_active: true,
    deactivated_at: null,
    created_at: new Date("2026-08-23T10:00:00.000Z"),
    ...overrides,
  };
}

test("audio upload contract rejects extension, MIME, signature, and path spoofing", () => {
  assert.equal(inspectUploadContract({
    originalname: "track.mp3",
    mimetype: "audio/mpeg",
    buffer: mp3Buffer(),
  }).mimeType, "audio/mpeg");

  assert.throws(() => inspectUploadContract({
    originalname: "../track.mp3",
    mimetype: "audio/mpeg",
    buffer: mp3Buffer(),
  }), (error) => error.code === "social_audio_filename_invalid");
  assert.throws(() => inspectUploadContract({
    originalname: "..\\track.mp3",
    mimetype: "audio/mpeg",
    buffer: mp3Buffer(),
  }), (error) => error.code === "social_audio_filename_invalid");
  assert.throws(() => inspectUploadContract({
    originalname: "track.mp3",
    mimetype: "audio/ogg",
    buffer: mp3Buffer(),
  }), (error) => error.code === "social_audio_mime_mismatch");
  assert.throws(() => inspectUploadContract({
    originalname: "track.mp3",
    mimetype: "audio/mpeg",
    buffer: Buffer.alloc(100, 0),
  }), (error) => error.code === "social_audio_signature_mismatch");
});

test("admin upload probes audio and persists checksum, guarded path, and auditable rights", async () => {
  let storedRecord;
  let auditRecord;
  const file = { originalname: "owned-track.mp3", mimetype: "audio/mpeg", buffer: mp3Buffer() };
  const expectedChecksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const result = await uploadAudioTrack({
    file,
    input: {
      title: "Owned Pink Paisa track",
      source: "Commissioned recording",
      license_status: "OWNED",
      license_reference: "Internal contract PP-17",
      rights_confirmed: "true",
      rights_confirmation_statement: "I verified that Pink Paisa owns and may edit this track.",
    },
    actor: { _id: adminId },
    requestId: "audio-upload-test",
    ip: "127.0.0.1",
    dependencies: {
      probeAudio: async () => ({ durationSeconds: 24.5, codec: "mp3", sampleRateHz: 44100, channels: 2 }),
      writeAudioFile: async ({ filename }) => ({
        filePath: `C:\\workspace\\server\\private\\social-audio-library\\${filename}`,
        storageKey: `private/social-audio-library/${filename}`,
      }),
      checksumFile: async () => expectedChecksum,
      SocialAudioTrack: {
        findOne: async () => null,
        create: async (record) => {
          storedRecord = record;
          return { _id: trackId, ...record };
        },
      },
      SocialAuditLog: { create: async (record) => { auditRecord = record; return record; } },
    },
  });

  assert.equal(storedRecord.checksum_sha256, expectedChecksum);
  assert.match(storedRecord.storage_key, /^private\/social-audio-library\/pinkpaisa-audio-/);
  assert.equal(storedRecord.rights_confirmed, true);
  assert.equal(storedRecord.rights_events.length, 1);
  assert.equal(String(storedRecord.rights_events[0].recorded_by_admin_id), String(adminId));
  assert.equal(result.usable, true);
  assert.equal(result.storage_key, undefined);
  assert.equal(result.stream_path, `/social-media-manager/admin/audio-library/${trackId}/file`);
  assert.equal(auditRecord.action, "AUDIO_TRACK_UPLOADED");
  assert.equal(auditRecord.metadata.scraped, false);
});

test("licensed/public-domain uploads require a concrete licence reference", async () => {
  await assert.rejects(() => uploadAudioTrack({
    file: { originalname: "licensed.mp3", mimetype: "audio/mpeg", buffer: mp3Buffer() },
    input: {
      title: "Licensed track",
      source: "Music vendor",
      license_status: "LICENSED",
      rights_confirmed: true,
      rights_confirmation_statement: "I reviewed the licence.",
    },
    actor: { _id: adminId },
  }), (error) => error.code === "social_audio_license_reference_required");
});

test("FFprobe path is injectable and audit IP hashing uses a required keyed salt", () => {
  assert.equal(resolveFfprobeBinary({ ffprobeBinary: "C:\\tools\\ffprobe.exe", env: {} }), "C:\\tools\\ffprobe.exe");
  assert.equal(resolveFfprobeBinary({ env: { FFPROBE_PATH: "/opt/pinkpaisa/ffprobe" } }), "/opt/pinkpaisa/ffprobe");
  assert.equal(resolveFfprobeBinary({ env: {} }), "ffprobe");
  assert.throws(
    () => resolveAudioLibraryRoot({ SOCIAL_AUDIO_LIBRARY_ROOT: "relative/audio" }),
    (error) => error.code === "social_audio_library_root_invalid",
  );
  const env = { NODE_ENV: "production", SOCIAL_AUDIT_IP_SALT: "unit-test-secret-salt" };
  assert.equal(
    hashIp("203.0.113.4", env),
    crypto.createHmac("sha256", env.SOCIAL_AUDIT_IP_SALT).update("203.0.113.4").digest("hex"),
  );
  assert.throws(
    () => hashIp("203.0.113.4", { NODE_ENV: "production" }),
    (error) => error.code === "social_audit_ip_salt_required" && error.statusCode === 503,
  );
  assert.equal(hashIp("203.0.113.4", { NODE_ENV: "test" }), null);
});

test("library originals stay outside public uploads and stream only through the private admin response", () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, "..", "services", "social", "socialAudioLibraryService.js"), "utf8");
  const controllerSource = fs.readFileSync(path.join(__dirname, "..", "controllers", "socialAudioLibraryController.js"), "utf8");
  assert.match(serviceSource, /"private",\s*"social-audio-library"/);
  assert.doesNotMatch(serviceSource, /"uploads",\s*"social-audio-library"/);
  assert.match(controllerSource, /Cache-Control",\s*"private, no-store"/);
  assert.match(controllerSource, /X-Content-Type-Options",\s*"nosniff"/);
  assert.match(controllerSource, /res\.sendFile\(filePath,\s*\{\s*acceptRanges:\s*true,\s*cacheControl:\s*false\s*\}\)/);
});

test("only active rights-confirmed local tracks resolve for Reel assembly", async () => {
  const resolved = await resolveUsableAudioTrack(trackId, {
    dependencies: {
      SocialAudioTrack: { findById: async () => usableTrack() },
      fileExists: async (filePath) => filePath.endsWith("pinkpaisa-audio-test.mp3"),
      checksumFile: async () => checksum,
    },
  });
  assert.match(resolved.filePath.replace(/\\/g, "/"), /private\/social-audio-library\/pinkpaisa-audio-test\.mp3$/);
  assert.deepEqual({
    track_id: resolved.metadata.track_id,
    checksum_sha256: resolved.metadata.checksum_sha256,
    license_status: resolved.metadata.license_status,
    rights_confirmed: resolved.metadata.rights_confirmed,
  }, {
    track_id: String(trackId), checksum_sha256: checksum, license_status: "OWNED", rights_confirmed: true,
  });

  await assert.rejects(() => resolveUsableAudioTrack(trackId, {
    dependencies: { SocialAudioTrack: { findById: async () => usableTrack({ license_status: "REVOKED", rights_confirmed: false, is_active: false }) } },
  }), (error) => error.code === "social_reel_audio_rights_required" && error.statusCode === 422);
  await assert.rejects(() => resolveUsableAudioTrack(trackId, {
    dependencies: {
      SocialAudioTrack: { findById: async () => usableTrack() },
      fileExists: async () => true,
      checksumFile: async () => "b".repeat(64),
    },
  }), (error) => error.code === "social_reel_audio_checksum_mismatch" && error.statusCode === 422);
});

test("selecting Reel audio rebuilds the MP4 from retained frames, increments revision, and invalidates human approval", async () => {
  let audit;
  let rebuildCalls = 0;
  let imageCalls = 0;
  const originalId = new mongoose.Types.ObjectId();
  const coverId = new mongoose.Types.ObjectId();
  const videoId = new mongoose.Types.ObjectId();
  const frozenWeeklySlot = new Date("2026-08-28T05:30:00.000Z");
  const draft = {
    _id: draftId,
    generation_run_id: new mongoose.Types.ObjectId(),
    weekly_plan_id: new mongoose.Types.ObjectId(),
    candidate_id: "candidate-reel-audio",
    current_package: { primaryRecommendation: { format: "REEL" } },
    visual_mode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    revision: 1,
    status: "APPROVED",
    approval_json: { status: "APPROVED" },
    approved_at: new Date(),
    approved_by_admin_id: adminId,
    approved_revision: 1,
    scheduled_for: frozenWeeklySlot,
    save: async () => draft,
  };
  const result = await selectDraftAudioTrack(draftId, trackId, {
    actor: { _id: adminId },
    dependencies: {
      SocialPostDraft: { findById: async () => draft },
      SocialAudioTrack: { findById: async () => usableTrack() },
      fileExists: async () => true,
      checksumFile: async () => checksum,
      generateSocialVisuals: async () => { imageCalls += 1; throw new Error("audio rebuild must not generate images"); },
      rebuildDraftReelFromRetainedFrames: async ({ draft: rebuildDraft, selectedAudio }) => {
        rebuildCalls += 1;
        assert.equal(String(rebuildDraft.audio_track_id), String(trackId));
        assert.equal(String(selectedAudio.track._id), String(trackId));
        return {
          originals: [{ _id: originalId }],
          baseImages: [{ url: "/uploads/generated/campaigns/retained-reel-frame.jpg" }],
          creativeResult: {
            validation_status: "needs_manual_review",
            manual_review_required: true,
            manual_review_flags: ["REEL_PLAYBACK_AND_CROP", "AUDIO_USAGE_RIGHTS"],
            asset_group_id: "rebuilt-audio-group",
            primary_asset_url: "/uploads/generated/campaigns/rebuilt-with-audio.mp4",
            assets: [
              { _id: coverId, asset_role: "FINAL_COMPOSED", url: "/uploads/generated/campaigns/reused-cover.jpg" },
              { _id: videoId, asset_role: "FINAL_VIDEO", url: "/uploads/generated/campaigns/rebuilt-with-audio.mp4" },
            ],
          },
        };
      },
      SocialAsset: {},
      SocialAuditLog: { create: async (record) => { audit = record; } },
      syncWeeklyPlanFromDraft: async () => null,
    },
  });
  assert.equal(String(draft.audio_track_id), String(trackId));
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(draft.revision, 2);
  assert.equal(draft.approved_at, null);
  assert.equal(draft.scheduled_for, frozenWeeklySlot);
  assert.equal(draft.approval_json.status, "NEEDS_REVIEW");
  assert.equal(draft.creative_readiness.reel_assembly_status, "COMPLETED");
  assert.equal(String(draft.creative_readiness.reel_video_asset_id), String(videoId));
  assert.deepEqual(draft.original_ai_asset_ids.map(String), [String(originalId)]);
  assert.deepEqual(draft.final_composed_asset_ids.map(String), [String(coverId), String(videoId)]);
  assert.equal(rebuildCalls, 1);
  assert.equal(imageCalls, 0);
  assert.equal(audit.action, "REEL_AUDIO_SELECTED");
  assert.equal(audit.metadata.rebuilt_from_retained_frames, true);
  assert.equal(audit.metadata.image_generation_invoked, false);
  assert.equal(result.selected_track.usable, true);
  assert.equal(result.reused, false);
});

test("selecting audio for a Video Feed uses the same retained-frame video rebuild", async () => {
  const videoId = new mongoose.Types.ObjectId();
  const draft = {
    _id: draftId,
    generation_run_id: new mongoose.Types.ObjectId(),
    current_package: { primaryRecommendation: { format: "VIDEO_FEED" } },
    revision: 2,
    status: "NEEDS_REVIEW",
    save: async () => draft,
  };
  let rebuildCalls = 0;
  await selectDraftAudioTrack(draftId, trackId, {
    actor: { _id: adminId },
    dependencies: {
      SocialPostDraft: { findById: async () => draft },
      SocialAudioTrack: { findById: async () => usableTrack() },
      fileExists: async () => true,
      checksumFile: async () => checksum,
      rebuildDraftReelFromRetainedFrames: async ({ selectedAudio }) => {
        rebuildCalls += 1;
        assert.equal(String(selectedAudio.track._id), String(trackId));
        return {
          originals: [],
          baseImages: [{ url: "/uploads/generated/campaigns/retained-video-feed-frame.jpg" }],
          creativeResult: {
            validation_status: "needs_manual_review",
            manual_review_required: true,
            manual_review_flags: ["VIDEO_FEED_PLAYBACK_AND_CROP"],
            assets: [{ _id: videoId, asset_role: "FINAL_VIDEO", url: "/uploads/generated/campaigns/video-feed-with-audio.mp4" }],
          },
        };
      },
      SocialAuditLog: { create: async () => ({}) },
    },
  });
  assert.equal(rebuildCalls, 1);
  assert.equal(String(draft.audio_track_id), String(trackId));
  assert.equal(draft.status, "NEEDS_REVIEW");
  assert.equal(String(draft.creative_readiness.reel_video_asset_id), String(videoId));
});

test("audio controller trusts the retained-frame rebuild and never starts a second visual regeneration", async () => {
  const calls = [];
  const state = { statusCode: 200, body: null };
  const response = {
    status(code) { state.statusCode = code; return response; },
    json(value) { state.body = value; return response; },
  };
  await selectForDraftWithServices({
    params: { id: String(draftId) },
    body: { audio_track_id: String(trackId), rebuild: true, visual_mode: "FULL_AI_GRAPHIC" },
    user: { _id: adminId },
    id: "audio-controller-test",
    ip: "127.0.0.1",
  }, response, {
    selectDraftAudioTrackImpl: async (receivedDraftId, receivedTrackId) => {
      calls.push(["select", receivedDraftId, receivedTrackId]);
      return { reused: false, selected_track: { id: receivedTrackId }, draft: { status: "NEEDS_REVIEW" } };
    },
    getDraftDetailImpl: async (receivedDraftId) => {
      calls.push(["detail", receivedDraftId]);
      return { id: receivedDraftId, status: "NEEDS_REVIEW" };
    },
  });
  assert.deepEqual(calls, [
    ["select", String(draftId), String(trackId)],
    ["detail", String(draftId)],
  ]);
  assert.equal(state.statusCode, 200);
  assert.match(state.body.message, /rebuilt from retained frames/i);
  assert.equal(state.body.draft.status, "NEEDS_REVIEW");
  const controllerSource = fs.readFileSync(path.join(__dirname, "..", "controllers", "socialAudioLibraryController.js"), "utf8");
  assert.doesNotMatch(controllerSource, /regenerateDraftVisual/);
});

test("revoking a selected track blocks affected drafts and opens a manual action", async () => {
  const track = usableTrack({
    save: async () => track,
  });
  const draftUpdates = [];
  let assetUpdate;
  const manualActions = [];
  const weeklySyncs = [];
  const affected = [{
    _id: draftId,
    generation_run_id: new mongoose.Types.ObjectId(),
    weekly_plan_id: new mongoose.Types.ObjectId(),
    candidate_id: "candidate-audio-rights-revoked",
    scheduled_for: new Date("2026-08-28T05:30:00.000Z"),
    status: "SCHEDULED",
  }];
  await updateAudioTrack(trackId, {
    license_status: "REVOKED",
    rights_confirmed: false,
    rights_confirmation_statement: "The vendor licence expired.",
  }, {
    actor: { _id: adminId },
    dependencies: {
      SocialAudioTrack: { findById: async () => track },
      SocialAuditLog: { create: async () => ({}) },
      SocialPostDraft: {
        find: () => ({ select: () => ({ lean: async () => affected }) }),
        updateMany: async (query, update) => { draftUpdates.push({ query, update }); },
      },
      SocialAsset: { updateMany: async (_query, update) => { assetUpdate = update; } },
      SocialManualAction: { findOneAndUpdate: async (_query, update) => { manualActions.push(update.$setOnInsert); } },
      syncWeeklyPlanFromDraft: async (draft, { status }) => { weeklySyncs.push({ draft, status }); },
    },
  });
  assert.equal(track.license_status, "REVOKED");
  assert.equal(track.is_active, false);
  assert.equal(draftUpdates[0].update.$set.status, "NEEDS_REVIEW");
  assert.equal(Object.hasOwn(draftUpdates[0].update.$set, "scheduled_for"), false);
  assert.equal(draftUpdates[1].update.$set.scheduled_for, null);
  assert.deepEqual(draftUpdates[1].query.$or, [{ weekly_plan_id: null }, { weekly_plan_id: { $exists: false } }]);
  assert.equal(assetUpdate.$set.is_active, false);
  assert.equal(weeklySyncs.length, 1);
  assert.equal(weeklySyncs[0].status, "NEEDS_REVIEW");
  assert.equal(weeklySyncs[0].draft.scheduled_for.toISOString(), "2026-08-28T05:30:00.000Z");
  assert.equal(manualActions.length, 1);
  assert.equal(manualActions[0].priority, "HIGH");
  assert.match(manualActions[0].instructions[0], /human approval/i);
});

test("publishing readiness rejects revoked or stale selected Reel audio", () => {
  const draft = {
    _id: draftId,
    audio_track_id: trackId,
    status: "APPROVED",
    revision: 1,
    approved_revision: 1,
    approved_at: new Date(),
    approved_by_admin_id: adminId,
    current_package: { primaryRecommendation: { format: "REEL", caption: "Safe caption", hashtags: [] } },
  };
  const video = {
    url: "https://media.pinkpaisa.in/reel.mp4",
    mime_type: "video/mp4",
    is_active: true,
    validation_status: "valid",
    manual_review_required: false,
    manual_review_status: "approved",
    provenance: { audio_rights: { track_id: String(trackId), checksum_sha256: checksum, rights_confirmed: true } },
  };
  const base = {
    draft,
    assets: [video],
    settings: { approval: { require_human_approval: true }, publishing: {} },
    connection: {},
  };
  const revoked = buildReadiness({ ...base, audioTrack: usableTrack({ license_status: "REVOKED", rights_confirmed: false, is_active: false }) });
  assert.ok(revoked.blockers.some((blocker) => blocker.code === "reel_audio_rights_required"));
  const stale = buildReadiness({ ...base, assets: [{ ...video, provenance: { audio_rights: { track_id: String(trackId), checksum_sha256: "b".repeat(64), rights_confirmed: true } } }], audioTrack: usableTrack() });
  assert.ok(stale.blockers.some((blocker) => blocker.code === "reel_audio_render_stale"));
  const matched = buildReadiness({ ...base, audioTrack: usableTrack() });
  assert.ok(!matched.blockers.some((blocker) => blocker.code.startsWith("reel_audio_")));
});

test("Reel creative assembly passes the selected local track and auditable rights to FFmpeg", async () => {
  let assemblyInput;
  const runId = new mongoose.Types.ObjectId();
  const draft = {
    _id: draftId,
    generation_run_id: runId,
    idempotency_key: `social-draft:${runId}:1`,
    audio_track_id: trackId,
    manual_action_ids: [],
  };
  const recommendation = {
    format: "REEL",
    formatContent: {
      format: "REEL",
      audioDirection: "Use the approved Pink Paisa-owned library track.",
      scenes: [{ sceneNumber: 1, durationSeconds: 4, voiceover: "Build one calm money habit.", onScreenText: "One calm habit" }],
    },
  };
  const AssetModel = {
    updateMany: async () => {},
    findOneAndUpdate: async (_query, update) => ({ _id: new mongoose.Types.ObjectId(), ...update.$set }),
  };
  const result = await assembleReelCreative({
    draft,
    run: { _id: runId },
    recommendation,
    imageResult: {
      provider: "openai",
      model: "gpt-image-2",
      original_visuals: [{
        sequence: 2,
        scene_index: 0,
        asset_purpose: "REEL_STORYBOARD_FRAME",
        storage_key: "uploads/generated/campaigns/frame.jpg",
        url: "https://media.pinkpaisa.in/uploads/generated/campaigns/frame.jpg",
        checksum_sha256: "c".repeat(64),
      }],
    },
    creativeResult: { asset_group_id: "cover", assets: [], asset_urls: [], validation_status: "valid", manual_review_flags: [] },
    visualMode: "AI_VISUAL_WITH_EXACT_OVERLAY",
    actor: adminId,
    AssetModel,
    dependencies: {
      resolveUsableAudioTrack: async () => ({
        filePath: "C:\\workspace\\server\\private\\social-audio-library\\track.mp3",
        metadata: {
          track_id: String(trackId), title: "Owned track", source: "Pink Paisa", checksum_sha256: checksum,
          license_status: "OWNED", rights_confirmed: true, rights_confirmed_by_admin_id: String(adminId), rights_confirmed_at: new Date(),
        },
      }),
      getGeneratedCampaignAssetReference: (key) => ({ filePath: key.includes("frame")
        ? "C:\\workspace\\server\\uploads\\generated\\campaigns\\frame.jpg"
        : "C:\\workspace\\server\\uploads\\generated\\campaigns\\reel.mp4" }),
      storeCampaignAsset: async ({ fileName, buffer }) => ({
        url: `https://media.pinkpaisa.in/uploads/generated/campaigns/${fileName}`,
        storage_provider: "local",
        storage_key: `uploads/generated/campaigns/${fileName}`,
        file_path: `C:\\workspace\\server\\uploads\\generated\\campaigns\\${fileName}`,
        checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      }),
      assembleReel: async (input) => {
        assemblyInput = input;
        return {
          mime_type: "video/mp4", size_bytes: 4096, checksum_sha256: "d".repeat(64),
          audio_rights: input.audioMetadata, command_profile: "ffmpeg_h264_aac_1080x1920_v1",
        };
      },
    },
  });
  assert.match(assemblyInput.audioPath.replace(/\\/g, "/"), /private\/social-audio-library\/track\.mp3$/);
  assert.equal(assemblyInput.audioMetadata.checksum_sha256, checksum);
  assert.equal(result.reel_video_asset.provenance.audio_rights.track_id, String(trackId));
  assert.equal(result.reel_video_asset.provenance.audio_rights.rights_confirmed, true);
});

test("FFmpeg loops a short approved track so audio cannot truncate the full Reel scene plan", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pinkpaisa-audio-loop-test-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const frame = path.join(root, "frame.jpg");
  const audio = path.join(root, "track.mp3");
  const output = path.join(root, "reel.mp4");
  await Promise.all([fsp.writeFile(frame, "frame"), fsp.writeFile(audio, "audio")]);
  let args;
  const spawnImpl = (_binary, receivedArgs) => {
    args = receivedArgs;
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(async () => {
      await fsp.writeFile(output, "assembled-video");
      child.emit("close", 0);
    });
    return child;
  };
  const result = await assembleReel({
    framePaths: [frame],
    scenes: [{ durationSeconds: 30, onScreenText: "Complete scene" }],
    outputPath: output,
    audioPath: audio,
    audioMetadata: {
      track_id: String(trackId), checksum_sha256: checksum, license_status: "OWNED", rights_confirmed: true,
    },
    dependencies: { allowedRoots: [root], spawnImpl },
  });
  const audioInput = args.indexOf(audio);
  assert.ok(audioInput >= 3);
  assert.deepEqual(args.slice(audioInput - 3, audioInput + 1), ["-stream_loop", "-1", "-i", audio]);
  assert.equal(result.audio_rights.track_id, String(trackId));
  assert.equal(result.audio_rights.checksum_sha256, checksum);
});

test("SocialAudioTrack schema never allows a revoked track to remain active", async () => {
  const record = new SocialAudioTrack({
    ...usableTrack(),
    license_status: "REVOKED",
    rights_confirmed: false,
    is_active: true,
  });
  await assert.rejects(() => record.validate(), /revoked audio track cannot remain active/i);
});
