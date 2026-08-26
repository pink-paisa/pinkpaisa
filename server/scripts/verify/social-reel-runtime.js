const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });
const sharp = require("sharp");
const { assembleReel } = require("../../services/social/socialReelAssemblyService");

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-6000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(stdout);
      return reject(new Error(`${path.basename(binary)} exited ${code}: ${stderr}`));
    });
  });
}

async function main() {
  const ffmpegBinary = String(process.env.FFMPEG_PATH || "ffmpeg").trim();
  const ffprobeBinary = String(process.env.FFPROBE_PATH || "ffprobe").trim();
  const temporaryRoot = path.resolve(os.tmpdir());
  const workingDirectory = await fs.mkdtemp(path.join(temporaryRoot, "pinkpaisa-reel-runtime-"));
  try {
    const firstFrame = path.join(workingDirectory, "frame-1.png");
    const secondFrame = path.join(workingDirectory, "frame-2.png");
    const outputPath = path.join(workingDirectory, "runtime-smoke.mp4");
    await Promise.all([
      sharp({ create: { width: 540, height: 960, channels: 3, background: "#d62d85" } }).png().toFile(firstFrame),
      sharp({ create: { width: 540, height: 960, channels: 3, background: "#472d85" } }).png().toFile(secondFrame),
    ]);

    const assembled = await assembleReel({
      framePaths: [firstFrame, secondFrame],
      scenes: [
        { durationSeconds: 1, onScreenText: "Save with confidence" },
        { durationSeconds: 1, onScreenText: "Build one habit" },
        { durationSeconds: 1, onScreenText: "Review and adjust" },
      ],
      outputPath,
      dependencies: { allowedRoots: [workingDirectory], ffmpegBinary },
    });

    const probe = JSON.parse(await run(ffprobeBinary, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,pix_fmt:format=duration,size",
      "-of", "json",
      outputPath,
    ]));
    const video = probe.streams?.[0] || {};
    const duration = Number(probe.format?.duration || 0);
    const subtitleCues = (assembled.subtitle_text.match(/-->/g) || []).length;
    if (video.codec_name !== "h264" || video.width !== 1080 || video.height !== 1920 || subtitleCues !== 3 || duration < 2.8 || duration > 3.2) {
      throw new Error(`Unexpected Reel output: ${JSON.stringify({ video, duration, subtitleCues })}`);
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      ffmpeg: ffmpegBinary,
      ffprobe: ffprobeBinary,
      codec: video.codec_name,
      dimensions: `${video.width}x${video.height}`,
      pixel_format: video.pix_fmt,
      duration_seconds: duration,
      size_bytes: Number(probe.format?.size || assembled.size_bytes),
      subtitle_cues: subtitleCues,
      checksum_sha256: assembled.checksum_sha256,
    }, null, 2)}\n`);
  } finally {
    const resolved = path.resolve(workingDirectory);
    const expectedPrefix = `${temporaryRoot}${path.sep}pinkpaisa-reel-runtime-`;
    if (!resolved.startsWith(expectedPrefix)) throw new Error("Refusing unsafe Reel smoke-test cleanup");
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
