const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "uploads", "generated", "campaigns");
const DEFAULT_SERVER_URL = "http://localhost:5000";

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
    storage_key: `uploads/generated/campaigns/${resolvedFileName}`,
    checksum_sha256: checksum,
  };
}

async function deleteCampaignAsset(asset = {}) {
  if (!asset.storage_key) return false;
  if (asset.storage_provider === "local") {
    const normalizedKey = trimText(asset.storage_key).replace(/\\/g, "/");
    const expectedPrefix = "uploads/generated/campaigns/";
    if (!normalizedKey.startsWith(expectedPrefix)) throw new Error("Campaign asset path is outside the campaign directory");
    const resolvedPath = path.join(OUTPUT_DIR, safeFileName(normalizedKey.slice(expectedPrefix.length)));
    await fs.promises.rm(resolvedPath, { force: true });
    return true;
  }
  return false;
}

module.exports = {
  createCampaignAssetVersion,
  deleteCampaignAsset,
  storeCampaignAsset,
  _private: { createCampaignAssetVersion, safeFileName, writeLocal },
};
