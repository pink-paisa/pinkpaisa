const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function timestamp(seconds) {
  const safe = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function buildSrt(scenes = []) {
  let cursor = 0;
  return (Array.isArray(scenes) ? scenes : []).map((scene, index) => {
    const duration = Math.min(Math.max(Number(scene.durationSeconds || scene.duration_seconds || 3), 1), 60);
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    const text = String(scene.onScreenText || scene.on_screen_text || scene.voiceover || "")
      .replace(/\r?\n+/g, " ")
      .trim();
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${text}\n`;
  }).filter((row) => !row.endsWith("\n\n")).join("\n");
}

function allowedMediaRoots() {
  const configured = String(process.env.SOCIAL_MEDIA_STORAGE_ROOT || "").trim();
  const audioLibrary = String(process.env.SOCIAL_AUDIO_LIBRARY_ROOT || "").trim()
    || path.resolve(__dirname, "..", "..", "private", "social-audio-library");
  return [...new Set([
    path.resolve(configured || path.resolve(__dirname, "..", "..", "uploads")),
    path.resolve(audioLibrary),
  ])];
}

function assertAllowedPath(filePath, roots = allowedMediaRoots()) {
  const resolved = path.resolve(String(filePath || ""));
  if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    const error = new Error("Reel assembly paths must remain inside the configured media storage root");
    error.code = "social_reel_path_not_allowed";
    throw error;
  }
  return resolved;
}

function escapeConcatPath(filePath) {
  return String(filePath).replace(/'/g, "'\\''");
}

function escapeSubtitleFilterPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildManualActions({ nativeTrendingAudio = false, collaborationInvitation = false, interactiveSticker = false, contentLabel = "Reel" } = {}) {
  return [
    nativeTrendingAudio ? `Open the assembled ${contentLabel} in Instagram's first-party app, add approved Instagram-native trending audio before sharing, then publish and confirm it manually; never reuse scraped copyrighted audio.` : null,
    collaborationInvitation ? "Send the approved Instagram collaboration invitation manually to the named account and confirm acceptance separately." : null,
    interactiveSticker ? "Add the approved Instagram-native interactive sticker manually and verify its destination before sharing." : null,
  ].filter(Boolean).map((instructions, index) => ({
    key: `manual_instagram_action_${index + 1}`,
    status: "MANUAL_ACTION_REQUIRED",
    instructions,
  }));
}

async function checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function runFfmpeg(binary, args, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(binary, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-12000); });
    child.on("error", (cause) => {
      const error = new Error(`FFmpeg could not be started: ${String(cause?.message || "binary unavailable").slice(0, 1000)}`);
      error.code = "social_ffmpeg_unavailable";
      error.cause = cause;
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const error = new Error(`FFmpeg Reel assembly failed with exit code ${code}: ${stderr.slice(-3000)}`);
      error.code = "social_reel_assembly_failed";
      return reject(error);
    });
  });
}

function sceneMidpointTimestamps(scenes = []) {
  let cursor = 0;
  return (Array.isArray(scenes) ? scenes : []).map((scene, sceneIndex) => {
    const duration = Math.min(Math.max(Number(scene.durationSeconds || scene.duration_seconds || 3), 1), 60);
    const timestampSeconds = cursor + (duration / 2);
    cursor += duration;
    return { scene_index: sceneIndex, timestamp_seconds: timestampSeconds };
  });
}

async function extractSceneFrameFromVideo({
  videoPath,
  scene,
  sceneIndex = 0,
  timestampSeconds = null,
  dependencies = {},
} = {}) {
  const roots = dependencies.allowedRoots || allowedMediaRoots();
  const input = assertAllowedPath(videoPath, roots);
  const duration = Math.min(Math.max(Number(scene?.durationSeconds || scene?.duration_seconds || 3), 1), 60);
  const timestampValue = Number.isFinite(Number(timestampSeconds))
    ? Number(timestampSeconds)
    : duration / 2;
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "pinkpaisa-reel-scene-proof-"));
  try {
    const framePath = path.join(temporaryDirectory, `scene-${Number(sceneIndex) + 1}.png`);
    await runFfmpeg(
      dependencies.ffmpegBinary || process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-y",
        "-ss",
        String(timestampValue),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        framePath,
      ],
      dependencies.spawnImpl || spawn,
    );
    const buffer = await fsp.readFile(framePath);
    if (!buffer.length) {
      const error = new Error(`FFmpeg did not extract a verification frame for scene ${Number(sceneIndex) + 1}`);
      error.code = "social_reel_logo_frame_missing";
      throw error;
    }
    return {
      scene_index: Number(sceneIndex),
      timestamp_seconds: timestampValue,
      buffer,
      checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => null);
  }
}

async function extractSceneFramesFromVideo({
  videoPath,
  scenes,
  dependencies = {},
} = {}) {
  const roots = dependencies.allowedRoots || allowedMediaRoots();
  const input = assertAllowedPath(videoPath, roots);
  const timestamps = sceneMidpointTimestamps(scenes);
  if (!timestamps.length) {
    const error = new Error("A complete scene plan is required to verify the AI-baked badge in the final video");
    error.code = "social_reel_scenes_missing";
    throw error;
  }
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "pinkpaisa-reel-proof-"));
  try {
    const frames = [];
    for (const row of timestamps) {
      const framePath = path.join(temporaryDirectory, `scene-${row.scene_index + 1}.png`);
      await runFfmpeg(
        dependencies.ffmpegBinary || process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-y",
          "-ss",
          String(row.timestamp_seconds),
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
          framePath,
        ],
        dependencies.spawnImpl || spawn,
      );
      const buffer = await fsp.readFile(framePath);
      if (!buffer.length) {
        const error = new Error(`FFmpeg did not extract a verification frame for scene ${row.scene_index + 1}`);
        error.code = "social_reel_logo_frame_missing";
        throw error;
      }
      frames.push({
        ...row,
        buffer,
        checksum_sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      });
    }
    return frames;
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => null);
  }
}

async function assembleReel({
  framePaths,
  scenes,
  outputPath,
  audioPath = null,
  audioMetadata = null,
  burnSubtitles = true,
  dependencies = {},
} = {}) {
  const roots = dependencies.allowedRoots || allowedMediaRoots();
  const frames = (Array.isArray(framePaths) ? framePaths : []).map((filePath) => assertAllowedPath(filePath, roots));
  if (!frames.length) {
    const error = new Error("At least one approved or AI-generated storyboard frame is required for Reel assembly");
    error.code = "social_reel_frames_missing";
    throw error;
  }
  const output = assertAllowedPath(outputPath, roots);
  const audio = audioPath ? assertAllowedPath(audioPath, roots) : null;
  if (audio && (
    !["OWNED", "LICENSED", "PUBLIC_DOMAIN", "ADMIN_APPROVED"].includes(String(audioMetadata?.license_status || "").toUpperCase())
    || audioMetadata?.rights_confirmed !== true
    || !/^[a-f0-9]{64}$/.test(String(audioMetadata?.checksum_sha256 || "").toLowerCase())
  )) {
    const error = new Error("Reel audio requires recorded owned/licensed/admin-approved usage rights");
    error.code = "social_reel_audio_rights_required";
    throw error;
  }
  if (!Array.isArray(scenes) || !scenes.length) {
    const error = new Error("A Reel scene plan is required for duration, voiceover and subtitles");
    error.code = "social_reel_scenes_missing";
    throw error;
  }
  await fsp.mkdir(path.dirname(output), { recursive: true });
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "pinkpaisa-reel-"));
  const manifestPath = path.join(temporaryDirectory, "frames.txt");
  const subtitlePath = path.join(temporaryDirectory, "captions.srt");
  try {
    const sceneFrames = scenes.map((_scene, index) => frames[index % frames.length]);
    const manifest = scenes.map((scene, index) => {
      const frame = sceneFrames[index];
      const duration = Math.min(Math.max(Number(scene.durationSeconds || scene.duration_seconds || 3), 1), 60);
      return `file '${escapeConcatPath(frame)}'\nduration ${duration}`;
    }).join("\n") + `\nfile '${escapeConcatPath(sceneFrames[sceneFrames.length - 1])}'\n`;
    await fsp.writeFile(manifestPath, manifest, { encoding: "utf8", mode: 0o600 });
    const subtitleText = buildSrt(scenes);
    await fsp.writeFile(subtitlePath, subtitleText, { encoding: "utf8", mode: 0o600 });
    const totalDurationSeconds = scenes.reduce((total, scene) => (
      total + Math.min(Math.max(Number(scene.durationSeconds || scene.duration_seconds || 3), 1), 60)
    ), 0);
    const filters = [
      "scale=1080:1920:force_original_aspect_ratio=increase",
      "crop=1080:1920",
      "fps=30",
      "format=yuv420p",
      burnSubtitles && subtitleText ? `subtitles='${escapeSubtitleFilterPath(subtitlePath)}'` : null,
    ].filter(Boolean).join(",");
    const args = ["-y", "-f", "concat", "-safe", "0", "-i", manifestPath];
    if (audio) args.push("-stream_loop", "-1", "-i", audio);
    args.push("-vf", filters, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-t", String(totalDurationSeconds), "-movflags", "+faststart");
    if (audio) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
    else args.push("-an");
    args.push(output);
    await runFfmpeg(dependencies.ffmpegBinary || process.env.FFMPEG_PATH || "ffmpeg", args, dependencies.spawnImpl || spawn);
    const stats = await fsp.stat(output);
    if (!stats.isFile() || stats.size <= 0) {
      const error = new Error("FFmpeg did not create a valid Reel asset");
      error.code = "social_reel_output_missing";
      throw error;
    }
    return {
      path: output,
      mime_type: "video/mp4",
      size_bytes: stats.size,
      checksum_sha256: await checksum(output),
      subtitle_text: subtitleText,
      audio_rights: audio ? cloneAudioMetadata(audioMetadata) : null,
      command_profile: "ffmpeg_h264_aac_1080x1920_v1",
    };
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => null);
  }
}

function cloneAudioMetadata(value) {
  if (!value) return null;
  return {
    title: String(value.title || "").slice(0, 300) || null,
    creator: String(value.creator || "").slice(0, 300) || null,
    licence: String(value.licence || value.license || "").slice(0, 500) || null,
    licence_location: String(value.licence_location || value.license_url || "").slice(0, 2048) || null,
    license_status: String(value.license_status || "").toUpperCase(),
    license_reference: String(value.license_reference || "").slice(0, 2000) || null,
    rights_confirmed: value.rights_confirmed === true,
    rights_confirmed_by_admin_id: String(value.rights_confirmed_by_admin_id || "").slice(0, 100) || null,
    rights_confirmed_at: value.rights_confirmed_at || null,
    track_id: String(value.track_id || "").slice(0, 100) || null,
    checksum_sha256: /^[a-f0-9]{64}$/.test(String(value.checksum_sha256 || "").toLowerCase())
      ? String(value.checksum_sha256).toLowerCase()
      : null,
    source: String(value.source || "").slice(0, 1000) || null,
  };
}

module.exports = {
  assembleReel,
  buildManualActions,
  buildSrt,
  extractSceneFrameFromVideo,
  extractSceneFramesFromVideo,
  timestamp,
  _private: {
    allowedMediaRoots,
    assertAllowedPath,
    escapeConcatPath,
    escapeSubtitleFilterPath,
    runFfmpeg,
    sceneMidpointTimestamps,
  },
};
