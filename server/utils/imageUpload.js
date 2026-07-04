const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const UPLOADS_ROOT = path.join(__dirname, "../uploads");

function getPublicUploadBaseUrl() {
  return (
    String(process.env.PUBLIC_MEDIA_BASE_URL || "").trim()
    || String(process.env.SERVER_URL || "").trim()
    || "http://localhost:5000"
  ).replace(/\/+$/, "");
}

function normalizeSubdir(subdir = "") {
  return String(subdir || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function buildPublicUploadUrl(relativePath = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `${getPublicUploadBaseUrl()}/uploads/${normalized}`;
}

async function ensureUploadDirectory(subdir = "") {
  const normalized = normalizeSubdir(subdir);
  const absoluteDir = normalized ? path.join(UPLOADS_ROOT, normalized) : UPLOADS_ROOT;
  await fs.mkdir(absoluteDir, { recursive: true });
  return { absoluteDir, normalized };
}

async function saveImageBufferAsWebp(buffer, { subdir = "", prefix = "image", maxWidth = 1600, maxHeight = 1600, quality = 82 } = {}) {
  const { absoluteDir, normalized } = await ensureUploadDirectory(subdir);
  await sharp(buffer, { failOn: "error" }).metadata();

  const fileName = `${prefix}-${Date.now()}-${crypto.randomBytes(12).toString("hex")}.webp`;
  const relativePath = normalized ? `${normalized}/${fileName}` : fileName;
  const optimizedBuffer = await sharp(buffer)
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();

  await fs.writeFile(path.join(absoluteDir, fileName), optimizedBuffer);

  return {
    fileName,
    relativePath,
    publicUrl: buildPublicUploadUrl(relativePath),
    size: optimizedBuffer.length,
    format: "webp",
  };
}

module.exports = {
  UPLOADS_ROOT,
  buildPublicUploadUrl,
  getPublicUploadBaseUrl,
  saveImageBufferAsWebp,
};
