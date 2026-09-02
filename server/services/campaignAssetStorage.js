const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "uploads", "generated", "campaigns");
const DEFAULT_SERVER_URL = "http://localhost:5000";
const GENERATED_CAMPAIGN_ASSET_PREFIX = "uploads/generated/campaigns/";

function trimText(value) {
  return String(value || "").trim();
}

function getServerBaseUrl() {
  return trimText(process.env.PUBLIC_MEDIA_BASE_URL || process.env.SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function safeFileName(value) {
  const fileName = trimText(value);
  if (!fileName || /[\\/]/.test(fileName) || !/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw new Error("Invalid campaign asset file name");
  }
  return fileName;
}

function getGeneratedCampaignAssetReference(value) {
  const raw = trimText(value).replace(/\\/g, "/");
  if (!raw) return null;

  let normalized = raw;
  try {
    normalized = new URL(raw).pathname || "";
  } catch (_error) {
    normalized = raw;
  }

  normalized = normalized.replace(/^\/+/, "");
  if (!normalized.startsWith(GENERATED_CAMPAIGN_ASSET_PREFIX)) return null;

  const fileName = safeFileName(normalized.slice(GENERATED_CAMPAIGN_ASSET_PREFIX.length));
  const filePath = path.resolve(OUTPUT_DIR, fileName);
  const outputRoot = path.resolve(OUTPUT_DIR);
  if (filePath !== outputRoot && !filePath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("Campaign asset path is outside the campaign directory");
  }

  return {
    fileName,
    filePath,
    storageKey: `${GENERATED_CAMPAIGN_ASSET_PREFIX}${fileName}`,
  };
}

function createCampaignAssetVersion() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

async function writeLocal(fileName, buffer) {
  await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, safeFileName(fileName));
  const temporaryPath = path.join(
    OUTPUT_DIR,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return filePath;
}

async function storeCampaignAsset({ fileName, buffer }) {
  const resolvedFileName = safeFileName(fileName);
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

  const filePath = await writeLocal(resolvedFileName, buffer);
  return {
    url: `${getServerBaseUrl()}/uploads/generated/campaigns/${resolvedFileName}`,
    file_path: filePath,
    storage_provider: "local",
    storage_key: `${GENERATED_CAMPAIGN_ASSET_PREFIX}${resolvedFileName}`,
    checksum_sha256: checksum,
  };
}

async function listGeneratedCampaignAssets({ olderThan = null, outputDir = OUTPUT_DIR } = {}) {
  const root = path.resolve(outputDir);
  const cutoff = olderThan == null ? null : new Date(olderThan).getTime();
  if (cutoff != null && !Number.isFinite(cutoff)) {
    throw new Error("Invalid generated campaign asset cutoff");
  }

  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const assets = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    let fileName;
    try {
      fileName = safeFileName(entry.name);
    } catch (_error) {
      continue;
    }
    const filePath = path.resolve(root, fileName);
    if (!filePath.startsWith(`${root}${path.sep}`)) continue;
    let stat;
    try {
      stat = await fs.promises.lstat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (cutoff != null && stat.mtimeMs > cutoff) continue;
    assets.push({
      storage_provider: "local",
      storage_key: `${GENERATED_CAMPAIGN_ASSET_PREFIX}${fileName}`,
      file_path: filePath,
      file_size_bytes: Number(stat.size || 0),
      modified_at: stat.mtime.toISOString(),
    });
  }
  return assets.sort((left, right) => left.storage_key.localeCompare(right.storage_key));
}

async function deleteCampaignAsset(asset = {}) {
  if (!asset.storage_key) return false;
  if (asset.storage_provider === "local") {
    const normalizedKey = trimText(asset.storage_key).replace(/\\/g, "/");
    const reference = getGeneratedCampaignAssetReference(normalizedKey);
    if (!reference) throw new Error("Campaign asset path is outside the campaign directory");
    const resolvedPath = reference.filePath;
    await fs.promises.rm(resolvedPath, { force: true });
    return true;
  }
  return false;
}

module.exports = {
  createCampaignAssetVersion,
  deleteCampaignAsset,
  getGeneratedCampaignAssetReference,
  listGeneratedCampaignAssets,
  storeCampaignAsset,
  _private: {
    createCampaignAssetVersion,
    getGeneratedCampaignAssetReference,
    listGeneratedCampaignAssets,
    safeFileName,
    writeLocal,
  },
};
