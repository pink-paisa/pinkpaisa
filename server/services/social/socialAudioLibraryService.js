const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const SocialAsset = require("../../models/SocialAsset");
const SocialAudioTrack = require("../../models/SocialAudioTrack");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPostDraft = require("../../models/SocialPostDraft");
const { syncWeeklyPlanFromDraft } = require("./socialWeeklyPlanSyncService");

const AUDIO_LIBRARY_PREFIX = "private/social-audio-library/";
const AUDIO_LIBRARY_ROOT = resolveAudioLibraryRoot();
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_DURATION_SECONDS = 15 * 60;
const USABLE_LICENSE_STATUSES = new Set(["OWNED", "LICENSED", "PUBLIC_DOMAIN", "ADMIN_APPROVED"]);
const FILE_CONTRACTS = Object.freeze({
  ".mp3": {
    mimeType: "audio/mpeg",
    acceptedMimes: new Set(["audio/mpeg", "audio/mp3"]),
    codecs: /^(mp3|mp2)$/i,
    signature: (buffer) => buffer.subarray(0, 3).toString("ascii") === "ID3"
      || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0),
  },
  ".m4a": {
    mimeType: "audio/mp4",
    acceptedMimes: new Set(["audio/mp4", "audio/x-m4a", "video/mp4"]),
    codecs: /^(aac|alac|mp3)$/i,
    signature: (buffer) => buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp",
  },
  ".wav": {
    mimeType: "audio/wav",
    acceptedMimes: new Set(["audio/wav", "audio/x-wav", "audio/wave"]),
    codecs: /^(pcm_|adpcm_|wavpack|flac)/i,
    signature: (buffer) => buffer.length >= 12
      && buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WAVE",
  },
  ".ogg": {
    mimeType: "audio/ogg",
    acceptedMimes: new Set(["audio/ogg", "application/ogg"]),
    codecs: /^(vorbis|opus|flac)$/i,
    signature: (buffer) => buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "OggS",
  },
});

function trimText(value) {
  return String(value || "").trim();
}

function actorId(actor) {
  return actor?._id || actor?.id || null;
}

function errorWith(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function resolveAudioLibraryRoot(env = process.env) {
  const configured = trimText(env.SOCIAL_AUDIO_LIBRARY_ROOT);
  if (configured && !path.isAbsolute(configured)) {
    throw errorWith("SOCIAL_AUDIO_LIBRARY_ROOT must be an absolute path", "social_audio_library_root_invalid", 500);
  }
  return path.resolve(configured || path.resolve(__dirname, "..", "..", "private", "social-audio-library"));
}

function parseBoolean(value) {
  return value === true || ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function hashIp(ip, env = process.env) {
  const value = trimText(ip);
  if (!value) return null;
  const salt = trimText(env.SOCIAL_AUDIT_IP_SALT);
  if (!salt) {
    if (trimText(env.NODE_ENV).toLowerCase() === "production") {
      throw errorWith("SOCIAL_AUDIT_IP_SALT is required before recording social audit IP metadata", "social_audit_ip_salt_required", 503);
    }
    return null;
  }
  return crypto.createHmac("sha256", salt).update(value).digest("hex");
}

function safeOriginalFileName(value) {
  const original = trimText(value);
  if (!original || /[\x00-\x1f\x7f\\/]/.test(original) || path.basename(original) !== original || original.length > 255) {
    throw errorWith("The audio file name is invalid", "social_audio_filename_invalid", 400);
  }
  return original;
}

function inspectUploadContract(file = {}) {
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length < 12) {
    throw errorWith("A non-empty audio file is required", "social_audio_file_required", 400);
  }
  if (file.buffer.length > MAX_AUDIO_BYTES || Number(file.size || file.buffer.length) > MAX_AUDIO_BYTES) {
    throw errorWith("Audio files must be 25 MB or smaller", "social_audio_file_too_large", 413);
  }
  const originalFilename = safeOriginalFileName(file.originalname);
  const extension = path.extname(originalFilename).toLowerCase();
  const contract = FILE_CONTRACTS[extension];
  if (!contract) {
    throw errorWith("Only MP3, M4A, WAV, and OGG audio files are allowed", "social_audio_extension_not_allowed", 415);
  }
  const suppliedMime = trimText(file.mimetype).toLowerCase();
  if (!contract.acceptedMimes.has(suppliedMime)) {
    throw errorWith("The uploaded audio MIME type does not match its file extension", "social_audio_mime_mismatch", 415);
  }
  if (!contract.signature(file.buffer)) {
    throw errorWith("The uploaded file signature does not match its declared audio format", "social_audio_signature_mismatch", 415);
  }
  return { contract, extension, originalFilename, mimeType: contract.mimeType };
}

function resolveFfprobeBinary({ ffprobeBinary = null, env = process.env } = {}) {
  return trimText(ffprobeBinary || env.FFPROBE_PATH) || "ffprobe";
}

function probeAudioWithFfprobe(buffer, { spawnProcess = spawn, timeoutMs = 15_000, ffprobeBinary = null, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(resolveFfprobeBinary({ ffprobeBinary, env }), [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_name,codec_type,duration,sample_rate,channels",
      "-of", "json",
      "pipe:0",
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(errorWith("Audio inspection timed out", "social_audio_probe_timeout", 422));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", () => finish(errorWith(
      "FFprobe is required to validate uploaded audio before it enters the licensed library",
      "social_audio_probe_unavailable",
      503,
    )));
    child.on("close", (exitCode) => {
      if (exitCode !== 0) {
        return finish(errorWith(
          `The uploaded file could not be decoded as audio${trimText(stderr) ? `: ${trimText(stderr).slice(0, 300)}` : ""}`,
          "social_audio_decode_failed",
          422,
        ));
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        if (streams.some((row) => row.codec_type === "video")) {
          return finish(errorWith("Audio-library uploads cannot contain a video stream", "social_audio_video_stream_not_allowed", 422));
        }
        const stream = streams.find((row) => row.codec_type === "audio");
        const durationSeconds = Number(parsed.format?.duration || stream?.duration || 0);
        if (!stream || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new Error("no decodable audio stream with duration");
        }
        return finish(null, {
          durationSeconds,
          codec: trimText(stream.codec_name).toLowerCase(),
          sampleRateHz: Number(stream.sample_rate || 0) || null,
          channels: Number(stream.channels || 0) || null,
        });
      } catch (_error) {
        return finish(errorWith("The uploaded file has no valid audio stream", "social_audio_stream_missing", 422));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}

function getAudioTrackFileReference(value) {
  const raw = trimText(value).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw.startsWith(AUDIO_LIBRARY_PREFIX)) return null;
  const filename = raw.slice(AUDIO_LIBRARY_PREFIX.length);
  if (!filename || !/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes("..")) return null;
  const filePath = path.resolve(AUDIO_LIBRARY_ROOT, filename);
  if (filePath === AUDIO_LIBRARY_ROOT || !filePath.startsWith(`${AUDIO_LIBRARY_ROOT}${path.sep}`)) return null;
  return { filePath, storageKey: `${AUDIO_LIBRARY_PREFIX}${filename}`, filename };
}

async function checksumFile(filePath, { createReadStream = fs.createReadStream } = {}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeAudioFile({ filename, buffer, dependencies = {} }) {
  const fsp = dependencies.fsp || fs.promises;
  const reference = getAudioTrackFileReference(`${AUDIO_LIBRARY_PREFIX}${filename}`);
  if (!reference) throw errorWith("Could not resolve guarded audio-library storage", "social_audio_storage_path_invalid", 500);
  await fsp.mkdir(AUDIO_LIBRARY_ROOT, { recursive: true });
  const temporaryPath = path.join(AUDIO_LIBRARY_ROOT, `.${filename}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.tmp`);
  try {
    await fsp.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fsp.rename(temporaryPath, reference.filePath);
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return reference;
}

function publicAudioTrack(track) {
  const value = typeof track?.toObject === "function" ? track.toObject() : track;
  if (!value) return null;
  return {
    id: String(value._id || value.id || ""),
    title: value.title,
    source: value.source,
    original_filename: value.original_filename,
    stream_path: `/social-media-manager/admin/audio-library/${encodeURIComponent(String(value._id || value.id || ""))}/file`,
    storage_provider: value.storage_provider,
    checksum_sha256: value.checksum_sha256,
    mime_type: value.mime_type,
    extension: value.extension,
    file_size_bytes: value.file_size_bytes,
    duration_seconds: value.duration_seconds,
    audio_codec: value.audio_codec,
    sample_rate_hz: value.sample_rate_hz || null,
    audio_channels: value.audio_channels || null,
    license_status: value.license_status,
    license_reference: value.license_reference || null,
    rights_confirmed: Boolean(value.rights_confirmed),
    rights_confirmation_statement: value.rights_confirmation_statement,
    rights_confirmed_at: value.rights_confirmed_at || null,
    is_active: value.is_active !== false,
    usable: SocialAudioTrack.isUsable(value),
    created_at: value.created_at || null,
    updated_at: value.updated_at || null,
  };
}

async function appendAudioAudit({ track, action, summary, actor, requestId = null, ip = null, fieldChanges = [], metadata = null, dependencies = {} }) {
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  if (!AuditModel?.create) return null;
  return AuditModel.create({
    entity_type: "ASSET",
    entity_id: track._id,
    action,
    action_status: "SUCCEEDED",
    actor_type: "ADMIN",
    actor_admin_id: actorId(actor),
    actor_label: "Pink Paisa administrator",
    summary,
    field_changes: fieldChanges,
    request_id: requestId,
    source_ip_hash: hashIp(ip),
    metadata,
  });
}

function validateRightsInput(input = {}, { allowRevoked = false } = {}) {
  const licenseStatus = trimText(input.license_status || input.licenseStatus).toUpperCase();
  const allowed = allowRevoked
    ? [...USABLE_LICENSE_STATUSES, "REVOKED"]
    : [...USABLE_LICENSE_STATUSES];
  if (!allowed.includes(licenseStatus)) {
    throw errorWith(`license_status must be one of ${allowed.join(", ")}`, "social_audio_license_status_invalid", 400);
  }
  const rightsConfirmed = parseBoolean(input.rights_confirmed ?? input.rightsConfirmed);
  const statement = trimText(input.rights_confirmation_statement || input.rightsConfirmationStatement);
  const licenseReference = trimText(input.license_reference || input.licenseReference);
  if (licenseStatus !== "REVOKED" && !rightsConfirmed) {
    throw errorWith("An administrator must explicitly confirm the audio usage rights", "social_audio_rights_confirmation_required", 422);
  }
  if (!statement) {
    throw errorWith("A rights confirmation statement is required for the audit trail", "social_audio_rights_statement_required", 422);
  }
  if (["LICENSED", "PUBLIC_DOMAIN"].includes(licenseStatus) && !licenseReference) {
    throw errorWith("Licensed or public-domain audio requires a licence/source reference", "social_audio_license_reference_required", 422);
  }
  return { licenseStatus, rightsConfirmed: licenseStatus !== "REVOKED" && rightsConfirmed, statement, licenseReference: licenseReference || null };
}

async function uploadAudioTrack({ file, input = {}, actor, requestId = null, ip = null, dependencies = {} } = {}) {
  const adminId = actorId(actor);
  if (!adminId) throw errorWith("An authenticated administrator is required", "social_audio_admin_required", 403);
  const title = trimText(input.title);
  const source = trimText(input.source);
  if (!title || title.length > 180) throw errorWith("Audio title is required and must be 180 characters or fewer", "social_audio_title_invalid", 400);
  if (!source || source.length > 1000) throw errorWith("Audio source is required and must be 1,000 characters or fewer", "social_audio_source_invalid", 400);
  hashIp(ip);
  const rights = validateRightsInput(input);
  const upload = inspectUploadContract(file);
  const probeAudio = dependencies.probeAudio || ((buffer) => probeAudioWithFfprobe(buffer, dependencies));
  const technical = await probeAudio(file.buffer);
  const durationSeconds = Number(technical?.durationSeconds || technical?.duration_seconds || 0);
  const codec = trimText(technical?.codec || technical?.audio_codec).toLowerCase();
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
    throw errorWith("Audio duration must be greater than zero and no longer than 15 minutes", "social_audio_duration_invalid", 422);
  }
  if (!codec || !upload.contract.codecs.test(codec)) {
    throw errorWith("The decoded audio codec does not match the uploaded file format", "social_audio_codec_mismatch", 422);
  }
  const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const TrackModel = dependencies.SocialAudioTrack || SocialAudioTrack;
  const existing = typeof TrackModel.findOne === "function" ? await TrackModel.findOne({ checksum_sha256: checksum }) : null;
  if (existing) throw errorWith("This exact audio file already exists in the licensed library", "social_audio_duplicate", 409);
  const filename = `pinkpaisa-audio-${checksum.slice(0, 20)}-${crypto.randomBytes(5).toString("hex")}${upload.extension}`;
  const stored = await (dependencies.writeAudioFile || writeAudioFile)({ filename, buffer: file.buffer, dependencies });
  try {
    const storedChecksum = await (dependencies.checksumFile || checksumFile)(stored.filePath);
    if (storedChecksum !== checksum) {
      throw errorWith("Stored audio checksum does not match the validated upload", "social_audio_storage_checksum_mismatch", 500);
    }
  } catch (error) {
    const fsp = dependencies.fsp || fs.promises;
    if (stored.filePath) await fsp.rm(stored.filePath, { force: true }).catch(() => {});
    throw error;
  }
  const now = new Date();
  const rightsEvent = {
    license_status: rights.licenseStatus,
    confirmed: rights.rightsConfirmed,
    confirmation_statement: rights.statement,
    license_reference: rights.licenseReference,
    recorded_by_admin_id: adminId,
    recorded_at: now,
    source_ip_hash: hashIp(ip),
  };
  let track;
  try {
    track = await TrackModel.create({
      title,
      source,
      original_filename: upload.originalFilename,
      storage_provider: "local",
      storage_key: stored.storageKey || stored.storage_key,
      checksum_sha256: checksum,
      mime_type: upload.mimeType,
      extension: upload.extension,
      file_size_bytes: file.buffer.length,
      duration_seconds: Number(durationSeconds.toFixed(3)),
      audio_codec: codec,
      sample_rate_hz: Number(technical?.sampleRateHz || technical?.sample_rate_hz || 0) || null,
      audio_channels: Number(technical?.channels || technical?.audio_channels || 0) || null,
      license_status: rights.licenseStatus,
      license_reference: rights.licenseReference,
      rights_confirmed: rights.rightsConfirmed,
      rights_confirmation_statement: rights.statement,
      rights_confirmed_by_admin_id: adminId,
      rights_confirmed_at: now,
      rights_events: [rightsEvent],
      uploaded_by_admin_id: adminId,
      is_active: true,
    });
  } catch (error) {
    const fsp = dependencies.fsp || fs.promises;
    if (stored.filePath) await fsp.rm(stored.filePath, { force: true }).catch(() => {});
    throw error;
  }
  await appendAudioAudit({
    track,
    action: "AUDIO_TRACK_UPLOADED",
    summary: "Uploaded and decoded a locally stored audio track with administrator-confirmed usage rights.",
    actor,
    requestId,
    ip,
    metadata: { checksum_sha256: checksum, license_status: rights.licenseStatus, source, scraped: false },
    dependencies,
  });
  return publicAudioTrack(track);
}

async function listAudioTracks({ includeInactive = false, dependencies = {} } = {}) {
  const TrackModel = dependencies.SocialAudioTrack || SocialAudioTrack;
  const query = TrackModel.find(includeInactive ? {} : { is_active: true });
  const sorted = typeof query?.sort === "function" ? query.sort({ created_at: -1 }) : query;
  const rows = typeof sorted?.lean === "function" ? await sorted.lean() : await sorted;
  return { items: (rows || []).map(publicAudioTrack), maximum_file_size_bytes: MAX_AUDIO_BYTES, allowed_extensions: Object.keys(FILE_CONTRACTS) };
}

async function getAudioTrackFile(trackId, { dependencies = {} } = {}) {
  const TrackModel = dependencies.SocialAudioTrack || SocialAudioTrack;
  const track = await TrackModel.findById(trackId);
  if (!track) throw errorWith("Audio track not found", "social_audio_track_not_found", 404);
  const reference = getAudioTrackFileReference(track.storage_key);
  if (!reference) throw errorWith("The audio track has an invalid guarded storage path", "social_audio_storage_path_invalid", 422);
  const exists = dependencies.fileExists
    ? await dependencies.fileExists(reference.filePath)
    : await fs.promises.access(reference.filePath).then(() => true).catch(() => false);
  if (!exists) throw errorWith("The local audio file is missing", "social_audio_file_missing", 404);
  const actualChecksum = await (dependencies.checksumFile || checksumFile)(reference.filePath);
  if (actualChecksum !== track.checksum_sha256) {
    throw errorWith("The local audio file no longer matches its recorded checksum", "social_audio_checksum_mismatch", 422);
  }
  return { track, filePath: reference.filePath };
}

async function invalidateDraftsForTrack(track, { actor, reason, dependencies = {} } = {}) {
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const ActionModel = dependencies.SocialManualAction || SocialManualAction;
  if (!DraftModel?.find) return [];
  const query = DraftModel.find({ audio_track_id: track._id, status: { $ne: "PUBLISHED" } });
  const selected = typeof query?.select === "function" ? query.select("_id generation_run_id weekly_plan_id candidate_id status scheduled_for") : query;
  const drafts = typeof selected?.lean === "function" ? await selected.lean() : await selected;
  const draftIds = (drafts || []).map((draft) => draft._id);
  if (!draftIds.length) return [];
  await AssetModel.updateMany(
    { draft_id: { $in: draftIds }, asset_role: "FINAL_VIDEO", is_active: true },
    { $set: { is_active: false } },
  );
  await DraftModel.updateMany(
    { _id: { $in: draftIds }, status: { $in: ["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "FAILED"] } },
    {
      $set: {
        status: "NEEDS_REVIEW",
        approval_json: { required: true, status: "NEEDS_REVIEW", approved_revision: null },
        approved_at: null,
        approved_by_admin_id: null,
        approved_revision: null,
        scheduled_by_admin_id: null,
        schedule_json: null,
        creative_readiness: { status: "STALE", reason, checked_at: new Date() },
      },
    },
  );
  await DraftModel.updateMany(
    {
      _id: { $in: draftIds },
      status: "NEEDS_REVIEW",
      $or: [{ weekly_plan_id: null }, { weekly_plan_id: { $exists: false } }],
    },
    { $set: { scheduled_for: null } },
  );
  const syncDraft = dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft;
  await Promise.all((drafts || [])
    .filter((draft) => draft.weekly_plan_id && draft.candidate_id)
    .map((draft) => syncDraft(draft, { status: "NEEDS_REVIEW", dependencies })));
  if (ActionModel?.findOneAndUpdate) {
    const rightsEventKey = new Date(track.rights_confirmed_at || track.updated_at || Date.now()).getTime();
    await Promise.all((drafts || []).map((draft) => ActionModel.findOneAndUpdate(
      { action_key: `social-reel-audio-rights:${draft._id}:${track._id}:${rightsEventKey}` },
      { $setOnInsert: {
        action_key: `social-reel-audio-rights:${draft._id}:${track._id}:${rightsEventKey}`,
        action_type: "OTHER",
        status: "OPEN",
        priority: draft.status === "PUBLISHING" ? "CRITICAL" : "HIGH",
        title: "Replace or re-confirm the video audio track",
        description: `The selected local audio track can no longer be used: ${reason}`.slice(0, 4000),
        instructions: ["Select an active rights-confirmed audio track, rebuild the video, replay it, and obtain human approval before publishing."],
        provider: "INTERNAL",
        weekly_plan_id: draft.weekly_plan_id || null,
        generation_run_id: draft.generation_run_id || null,
        draft_id: draft._id,
        external_reference_id: String(track._id),
        assigned_to_admin_id: actorId(actor),
        created_by_admin_id: actorId(actor),
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    )));
  }
  return draftIds;
}

async function updateAudioTrack(trackId, input = {}, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  if (!actorId(actor)) throw errorWith("An authenticated administrator is required", "social_audio_admin_required", 403);
  hashIp(ip);
  const TrackModel = dependencies.SocialAudioTrack || SocialAudioTrack;
  const track = await TrackModel.findById(trackId);
  if (!track) throw errorWith("Audio track not found", "social_audio_track_not_found", 404);
  const before = publicAudioTrack(track);
  if (input.title !== undefined) {
    const title = trimText(input.title);
    if (!title || title.length > 180) throw errorWith("Audio title is invalid", "social_audio_title_invalid", 400);
    track.title = title;
  }
  if (input.source !== undefined) {
    const source = trimText(input.source);
    if (!source || source.length > 1000) throw errorWith("Audio source is invalid", "social_audio_source_invalid", 400);
    track.source = source;
  }
  const rightsChange = input.license_status !== undefined || input.licenseStatus !== undefined;
  if (rightsChange) {
    const rights = validateRightsInput(input, { allowRevoked: true });
    track.license_status = rights.licenseStatus;
    track.license_reference = rights.licenseReference;
    track.rights_confirmed = rights.rightsConfirmed;
    track.rights_confirmation_statement = rights.statement;
    track.rights_confirmed_by_admin_id = actorId(actor);
    track.rights_confirmed_at = new Date();
    track.is_active = rights.licenseStatus !== "REVOKED";
    track.deactivated_at = rights.licenseStatus === "REVOKED" ? new Date() : null;
    track.deactivated_by_admin_id = rights.licenseStatus === "REVOKED" ? actorId(actor) : null;
    track.rights_events.push({
      license_status: rights.licenseStatus,
      confirmed: rights.rightsConfirmed,
      confirmation_statement: rights.statement,
      license_reference: rights.licenseReference,
      recorded_by_admin_id: actorId(actor),
      recorded_at: new Date(),
      source_ip_hash: hashIp(ip),
    });
  }
  await track.save();
  const after = publicAudioTrack(track);
  await appendAudioAudit({
    track,
    action: "AUDIO_TRACK_UPDATED",
    summary: rightsChange ? "Updated the audio usage-rights decision and preserved an immutable rights event." : "Updated audio-library metadata.",
    actor,
    requestId,
    ip,
    fieldChanges: ["title", "source", "license_status", "license_reference", "rights_confirmed", "is_active"]
      .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map((field) => ({ field_path: field, before: before[field], after: after[field], is_redacted: false })),
    metadata: { checksum_sha256: track.checksum_sha256 },
    dependencies,
  });
  if (!SocialAudioTrack.isUsable(track)) {
    await invalidateDraftsForTrack(track, { actor, reason: `Audio rights status is ${track.license_status}`, dependencies });
  }
  return after;
}

async function deactivateAudioTrack(trackId, reason, options = {}) {
  const statement = trimText(reason);
  if (!statement) throw errorWith("A deactivation reason is required", "social_audio_deactivation_reason_required", 400);
  return updateAudioTrack(trackId, {
    license_status: "REVOKED",
    rights_confirmed: false,
    rights_confirmation_statement: statement,
  }, options);
}

async function resolveUsableAudioTrack(trackId, { dependencies = {} } = {}) {
  if (!trackId) return null;
  const TrackModel = dependencies.SocialAudioTrack || SocialAudioTrack;
  const track = await TrackModel.findById(trackId);
  if (!track) throw errorWith("The selected video audio track no longer exists", "social_reel_audio_track_missing", 422);
  if (!SocialAudioTrack.isUsable(track)) {
    throw errorWith("The selected video audio track does not have active, administrator-confirmed usage rights", "social_reel_audio_rights_required", 422);
  }
  const reference = getAudioTrackFileReference(track.storage_key);
  if (!reference) throw errorWith("The selected video audio track has an invalid local storage path", "social_reel_audio_path_invalid", 422);
  const exists = dependencies.fileExists
    ? await dependencies.fileExists(reference.filePath)
    : await fs.promises.access(reference.filePath).then(() => true).catch(() => false);
  if (!exists) throw errorWith("The selected video audio file is missing from guarded local storage", "social_reel_audio_file_missing", 422);
  const actualChecksum = await (dependencies.checksumFile || checksumFile)(reference.filePath);
  if (actualChecksum !== track.checksum_sha256) {
    throw errorWith("The selected video audio file no longer matches its recorded checksum", "social_reel_audio_checksum_mismatch", 422);
  }
  return {
    track,
    filePath: reference.filePath,
    metadata: {
      track_id: String(track._id),
      title: track.title,
      source: track.source,
      checksum_sha256: track.checksum_sha256,
      license_status: track.license_status,
      license_reference: track.license_reference || null,
      rights_confirmed: true,
      rights_confirmed_by_admin_id: String(track.rights_confirmed_by_admin_id),
      rights_confirmed_at: track.rights_confirmed_at,
    },
  };
}

async function rebuildDraftReelFromRetainedFrames(draft, {
  actor,
  selectedAudio = null,
  dependencies = {},
  AssetModel = SocialAsset,
} = {}) {
  if (typeof dependencies.rebuildDraftReelFromRetainedFrames === "function") {
    return dependencies.rebuildDraftReelFromRetainedFrames({
      draft,
      actor,
      selectedAudio,
      dependencies,
      AssetModel,
    });
  }
  // Lazy loading avoids a module-initialization cycle: socialManagerService
  // consumes this audio service while its retained-original compositor is the
  // canonical place where video covers, frames, subtitles and MP4s are rebuilt.
  const managerPrivate = require("./socialManagerService")._private;
  if (typeof managerPrivate?.recomposeDraftFromActiveOriginals !== "function") {
    throw errorWith("The retained-frame video rebuild service is unavailable", "social_reel_rebuild_unavailable", 503);
  }
  return managerPrivate.recomposeDraftFromActiveOriginals(draft, {
    actor,
    AssetModel,
    visualMode: draft.visual_mode_resolution?.effective || draft.visual_mode || "AI_VISUAL_WITH_EXACT_OVERLAY",
    dependencies: {
      ...dependencies,
      ...(selectedAudio ? { resolveUsableAudioTrack: async () => selectedAudio } : {}),
    },
  });
}

async function selectDraftAudioTrack(draftId, trackId, { actor, requestId = null, ip = null, dependencies = {} } = {}) {
  if (!actorId(actor)) throw errorWith("An authenticated administrator is required", "social_audio_admin_required", 403);
  hashIp(ip);
  const DraftModel = dependencies.SocialPostDraft || SocialPostDraft;
  const AssetModel = dependencies.SocialAsset || SocialAsset;
  const draft = await DraftModel.findById(draftId);
  if (!draft) throw errorWith("Social draft not found", "social_draft_not_found", 404);
  const socialFormat = String(draft.current_package?.primaryRecommendation?.format || "").toUpperCase();
  if (!["REEL", "VIDEO_FEED"].includes(socialFormat)) {
    throw errorWith("Licensed audio can only be selected for a Reel or Video Feed draft", "social_audio_reel_required", 422);
  }
  if (["PUBLISHING", "PUBLISHED"].includes(draft.status) || draft.publication_id) {
    throw errorWith("A publishing or previously attempted draft cannot change its audio; duplicate it first", "social_audio_draft_immutable", 409);
  }
  const selected = trackId ? await resolveUsableAudioTrack(trackId, { dependencies }) : null;
  const previousTrackId = draft.audio_track_id ? String(draft.audio_track_id) : null;
  const nextTrackId = selected?.track?._id ? String(selected.track._id) : null;
  if (previousTrackId === nextTrackId) {
    return { draft, selected_track: selected ? publicAudioTrack(selected.track) : null, reused: true };
  }
  draft.audio_track_id = selected?.track?._id || null;
  const weeklyProposedSchedule = draft.weekly_plan_id && draft.scheduled_for
    ? draft.scheduled_for
    : null;
  draft.audio_selection_json = selected ? {
    track_id: String(selected.track._id),
    title: selected.track.title,
    checksum_sha256: selected.track.checksum_sha256,
    license_status: selected.track.license_status,
    rights_confirmed_at: selected.track.rights_confirmed_at,
    selected_by_admin_id: actorId(actor),
    selected_at: new Date(),
  } : null;
  const rebuilt = await rebuildDraftReelFromRetainedFrames(draft, {
    actor,
    selectedAudio: selected,
    dependencies,
    AssetModel,
  });
  const creativeResult = rebuilt?.creativeResult || {};
  const rebuiltAssets = Array.isArray(creativeResult.assets) ? creativeResult.assets : [];
  const finalVideo = rebuiltAssets.find((asset) => String(asset?.asset_role || "").toUpperCase() === "FINAL_VIDEO")
    || creativeResult.reel_video_asset
    || null;
  if (!finalVideo) {
    throw errorWith("The retained-frame video rebuild did not produce a final MP4", "social_reel_rebuild_incomplete", 409);
  }
  const assetIds = rebuiltAssets.map((asset) => asset?._id || asset?.id).filter(Boolean);
  const finalAssetIds = rebuiltAssets
    .filter((asset) => ["FINAL_COMPOSED", "FINAL_VIDEO"].includes(String(asset?.asset_role || "").toUpperCase()))
    .map((asset) => asset?._id || asset?.id)
    .filter(Boolean);
  draft.asset_ids = assetIds;
  draft.final_composed_asset_ids = finalAssetIds;
  draft.original_ai_asset_ids = (rebuilt.originals || []).map((asset) => asset?._id || asset?.id).filter(Boolean);
  draft.full_ai_ready = true;
  draft.revision = Math.max(Number(draft.revision || 0), 0) + 1;
  draft.status = "NEEDS_REVIEW";
  draft.submitted_for_review_at = new Date();
  draft.approval_json = { required: true, status: "NEEDS_REVIEW", approved_revision: null, submitted_at: draft.submitted_for_review_at };
  draft.approved_at = null;
  draft.approved_by_admin_id = null;
  draft.approved_revision = null;
  draft.scheduled_for = weeklyProposedSchedule;
  draft.scheduled_by_admin_id = null;
  draft.schedule_json = null;
  draft.creative_readiness = {
    status: creativeResult.manual_review_required === false ? "READY" : "NEEDS_MANUAL_REVIEW",
    validation_status: creativeResult.validation_status || "needs_manual_review",
    manual_review_required: creativeResult.manual_review_required !== false,
    manual_review_flags: creativeResult.manual_review_flags || [],
    asset_group_id: creativeResult.asset_group_id || null,
    primary_asset_url: creativeResult.primary_asset_url || finalVideo.url || null,
    original_asset_urls: (rebuilt.baseImages || []).map((asset) => asset?.url).filter(Boolean),
    asset_count: rebuiltAssets.length,
    ai_visual_required: true,
    ai_visual_status: "REUSED",
    reel_assembly_status: "COMPLETED",
    reel_video_asset_id: finalVideo._id || finalVideo.id || null,
    reel_video_url: finalVideo.url || null,
    checked_at: new Date(),
  };
  await draft.save();
  await (dependencies.syncWeeklyPlanFromDraft || syncWeeklyPlanFromDraft)(draft, { status: "NEEDS_REVIEW", dependencies });
  const AuditModel = dependencies.SocialAuditLog || SocialAuditLog;
  if (AuditModel?.create) {
    await AuditModel.create({
      entity_type: "DRAFT",
      entity_id: draft._id,
      generation_run_id: draft.generation_run_id,
      draft_id: draft._id,
      action: "REEL_AUDIO_SELECTED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: actorId(actor),
      actor_label: "Pink Paisa administrator",
      summary: selected ? "Selected a rights-confirmed local audio track and rebuilt the video from retained AI frames." : "Removed the selected local audio track and rebuilt the video from retained AI frames.",
      field_changes: [{ field_path: "audio_track_id", before: previousTrackId, after: selected ? String(selected.track._id) : null, is_redacted: false }],
      request_id: requestId,
      source_ip_hash: hashIp(ip),
      metadata: {
        previous_audio_track_id: previousTrackId,
        selected_audio_track_id: nextTrackId,
        checksum_sha256: selected?.track?.checksum_sha256 || null,
        license_status: selected?.track?.license_status || null,
        rebuilt_from_retained_frames: true,
        image_generation_invoked: false,
        final_video_asset_id: String(finalVideo._id || finalVideo.id || "") || null,
        revision: draft.revision,
      },
    });
  }
  return { draft, selected_track: selected ? publicAudioTrack(selected.track) : null, reused: false };
}

module.exports = {
  deactivateAudioTrack,
  getAudioTrackFile,
  getAudioTrackFileReference,
  listAudioTracks,
  publicAudioTrack,
  resolveUsableAudioTrack,
  selectDraftAudioTrack,
  updateAudioTrack,
  uploadAudioTrack,
  _private: {
    FILE_CONTRACTS,
    MAX_AUDIO_BYTES,
    MAX_AUDIO_DURATION_SECONDS,
    checksumFile,
    inspectUploadContract,
    invalidateDraftsForTrack,
    hashIp,
    parseBoolean,
    probeAudioWithFfprobe,
    rebuildDraftReelFromRetainedFrames,
    resolveFfprobeBinary,
    resolveAudioLibraryRoot,
    safeOriginalFileName,
    validateRightsInput,
    writeAudioFile,
  },
};
