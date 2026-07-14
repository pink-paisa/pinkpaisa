const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { assertSafeRemoteImageUrl } = require("../utils/vendorMedia");

const DEFAULT_SERVER_URL = "http://localhost:5000";
const MAX_REFERENCE_BYTES = Math.max(Number(process.env.MARKETING_REFERENCE_IMAGE_MAX_BYTES || 30 * 1024 * 1024), 1024 * 1024);
const MAX_REFERENCE_PIXELS = Math.max(Number(process.env.MARKETING_REFERENCE_IMAGE_MAX_PIXELS || 40 * 1000 * 1000), 1000 * 1000);
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);

function trimText(value) {
  return String(value || "").trim();
}

function campaignReferenceError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function resolveProductReferenceImage(product = {}) {
  return trimText(
    product.affiliate_campaign_asset_url
    || product.featured_image
    || (Array.isArray(product.images) ? product.images.find(Boolean) : null)
    || ""
  ) || null;
}

function resolveVendorReferenceImage(vendorProduct = {}, publicProduct = {}) {
  return trimText(
    publicProduct.affiliate_campaign_asset_url
    || vendorProduct.featured_image
    || publicProduct.featured_image
    || (Array.isArray(vendorProduct.additional_images) ? vendorProduct.additional_images.find(Boolean) : null)
    || (Array.isArray(publicProduct.images) ? publicProduct.images.find(Boolean) : null)
    || ""
  ) || null;
}

function getServerBaseUrl() {
  return trimText(process.env.PUBLIC_MEDIA_BASE_URL || process.env.SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function resolvePublicUrl(value) {
  const raw = trimText(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${getServerBaseUrl()}${raw}`;
  return `${getServerBaseUrl()}/${raw.replace(/^\/+/, "")}`;
}

function resolveLocalPath(value) {
  const raw = trimText(value);
  if (!raw) return null;
  let clean = raw.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(raw)) {
    try {
      const candidate = new URL(raw);
      const server = new URL(getServerBaseUrl());
      if (candidate.origin !== server.origin || !candidate.pathname.startsWith("/uploads/")) return null;
      clean = decodeURIComponent(candidate.pathname).replace(/^\/+/, "");
    } catch {
      return null;
    }
  }
  const serverRoot = path.resolve(__dirname, "..");
  const resolved = path.resolve(serverRoot, clean);
  if (resolved !== serverRoot && !resolved.startsWith(`${serverRoot}${path.sep}`)) return null;
  return resolved;
}

async function downloadReferenceBuffer(sourceUrl) {
  const localPath = resolveLocalPath(sourceUrl);
  if (localPath && fs.existsSync(localPath)) {
    const stat = await fs.promises.stat(localPath);
    if (stat.size > MAX_REFERENCE_BYTES) {
      throw campaignReferenceError("reference_image_unavailable", "Product reference image is too large.");
    }
    return fs.promises.readFile(localPath);
  }

  const publicUrl = resolvePublicUrl(sourceUrl);
  if (!publicUrl) {
    throw campaignReferenceError("reference_image_required", "Product image required.");
  }

  try {
    await assertSafeRemoteImageUrl(publicUrl);
    const response = await axios.get(publicUrl, {
      responseType: "arraybuffer",
      timeout: 25000,
      maxContentLength: MAX_REFERENCE_BYTES,
      maxBodyLength: MAX_REFERENCE_BYTES,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw campaignReferenceError(
      "reference_image_unavailable",
      "Product reference image could not be downloaded.",
      error,
    );
  }
}

async function normalizeReferenceBuffer(sourceBuffer, sourceUrl = "product-reference") {
  if (!Buffer.isBuffer(sourceBuffer) || !sourceBuffer.length || sourceBuffer.length > MAX_REFERENCE_BYTES) {
    throw campaignReferenceError("reference_image_unavailable", "Product reference image is empty or too large.");
  }

  try {
    const sharp = require("sharp");
    const input = sharp(sourceBuffer, { failOn: "error", limitInputPixels: MAX_REFERENCE_PIXELS });
    const metadata = await input.metadata();
    if (!SUPPORTED_FORMATS.has(String(metadata.format || "").toLowerCase())) {
      throw campaignReferenceError(
        "reference_image_unavailable",
        "Product reference image must be JPEG, PNG, or WebP.",
      );
    }
    if (!metadata.width || !metadata.height || (metadata.width * metadata.height) > MAX_REFERENCE_PIXELS) {
      throw campaignReferenceError("reference_image_unavailable", "Product reference image dimensions are unsupported.");
    }

    const buffer = await sharp(sourceBuffer, { failOn: "error", limitInputPixels: MAX_REFERENCE_PIXELS })
      .rotate()
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (!buffer.length || buffer.length > MAX_REFERENCE_BYTES) {
      throw campaignReferenceError("reference_image_unavailable", "Normalized product reference image is too large.");
    }

    const normalizedMetadata = await sharp(buffer).metadata();
    return {
      buffer,
      mime_type: "image/png",
      source_url: trimText(sourceUrl) || "product-reference",
      source_format: metadata.format,
      width: normalizedMetadata.width || metadata.width,
      height: normalizedMetadata.height || metadata.height,
    };
  } catch (error) {
    if (error?.code === "reference_image_unavailable") throw error;
    throw campaignReferenceError(
      "reference_image_unavailable",
      "Product reference image is malformed or unsupported.",
      error,
    );
  }
}

async function readAndNormalizeReferenceImage(sourceUrl) {
  const normalizedSourceUrl = trimText(sourceUrl);
  if (!normalizedSourceUrl) {
    throw campaignReferenceError("reference_image_required", "Product image required.");
  }

  const sourceBuffer = await downloadReferenceBuffer(normalizedSourceUrl);
  return normalizeReferenceBuffer(sourceBuffer, normalizedSourceUrl);
}

module.exports = {
  campaignReferenceError,
  normalizeReferenceBuffer,
  readAndNormalizeReferenceImage,
  resolveProductReferenceImage,
  resolveVendorReferenceImage,
  _private: {
    downloadReferenceBuffer,
    resolveLocalPath,
    resolvePublicUrl,
  },
};
