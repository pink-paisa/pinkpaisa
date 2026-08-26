const crypto = require("crypto");
const dns = require("dns").promises;
const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");

const axios = require("axios");
const sharp = require("sharp");

const Product = require("../../models/Product");

const MAX_PRODUCT_REFERENCE_BYTES = Math.min(
  Math.max(Number(process.env.SOCIAL_PRODUCT_IMAGE_MAX_BYTES || 12 * 1024 * 1024), 1024 * 1024),
  25 * 1024 * 1024,
);
const MAX_PRODUCT_REFERENCE_PIXELS = Math.min(
  Math.max(Number(process.env.SOCIAL_PRODUCT_IMAGE_MAX_PIXELS || 30_000_000), 1_000_000),
  40_000_000,
);
const RIGHTS_CLEARED = new Set(["admin_confirmed", "owned", "licensed", "api_permitted"]);
const BUILT_IN_ALLOWED_HOSTS = Object.freeze([
  "pinkpaisa.in",
  "www.pinkpaisa.in",
  "media.pinkpaisa.in",
  "media-amazon.com",
  "ssl-images-amazon.com",
  "images-amazon.com",
]);
const MIME_BY_SIGNATURE = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

function trimText(value) {
  return String(value || "").trim();
}

function productCreativeError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 422;
  if (cause) error.cause = cause;
  return error;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function productImageUrl(product = {}) {
  return trimText(
    product.affiliate_campaign_asset_url
    || product.featured_image
    || (Array.isArray(product.images) ? product.images.find(Boolean) : null),
  ) || null;
}

function recordId(product = {}) {
  return trimText(product._id?.toString?.() || product.id);
}

async function resolveVerifiedProductRecord(reference = {}, dependencies = {}) {
  const expectedId = trimText(reference.id);
  const expectedTitle = trimText(reference.title);
  const expectedUrl = trimText(reference.url);
  if (!expectedId || !expectedTitle || !expectedUrl) {
    throw productCreativeError(
      "reference_image_required",
      "A complete verified product id, title, and authentic image URL is required for product creative generation.",
    );
  }

  let product;
  try {
    if (typeof dependencies.getVerifiedProductRecord === "function") {
      product = await dependencies.getVerifiedProductRecord({ id: expectedId });
    } else {
      const ProductModel = dependencies.Product || Product;
      let query = ProductModel.findOne({
        _id: expectedId,
        status: "active",
        is_visible: true,
        archived_at: null,
      });
      if (typeof query.select === "function") {
        query = query.select("title status is_visible archived_at is_affiliate affiliate_is_instagram_pick affiliate_link_check_status affiliate_compliance_status affiliate_campaign_usage_rights affiliate_campaign_asset_url featured_image images affiliate_image_provenance");
      }
      if (typeof query.lean === "function") query = query.lean();
      product = await query;
    }
  } catch (cause) {
    throw productCreativeError(
      "social_verified_product_unavailable",
      "The verified product could not be reloaded from the production product database.",
      cause,
    );
  }

  if (!product || product.status !== "active" || product.is_visible === false || product.archived_at) {
    throw productCreativeError(
      "social_verified_product_unavailable",
      "The verified product is no longer active and visible in the production product database.",
    );
  }
  const actualId = recordId(product);
  const actualTitle = trimText(product.title);
  const actualUrl = productImageUrl(product);
  if (actualId !== expectedId || actualTitle !== expectedTitle || actualUrl !== expectedUrl) {
    throw productCreativeError(
      "social_product_reference_mismatch",
      "The approved product id, title, or image URL no longer matches the production product database.",
    );
  }
  if (product.is_affiliate && (
    product.affiliate_is_instagram_pick !== true
    || product.affiliate_link_check_status !== "ok"
    || product.affiliate_compliance_status !== "compliant"
    || !RIGHTS_CLEARED.has(trimText(product.affiliate_campaign_usage_rights).toLowerCase())
  )) {
    throw productCreativeError(
      "social_product_reference_rights_invalid",
      "The affiliate product must remain an approved Instagram pick with link health exactly ok, compliant status, and rights-cleared imagery for social creative use.",
    );
  }

  return {
    id: actualId,
    title: actualTitle,
    url: actualUrl,
    is_affiliate: Boolean(product.is_affiliate),
    usage_rights_status: product.is_affiliate
      ? trimText(product.affiliate_campaign_usage_rights).toLowerCase()
      : "owned",
    database_model: "Product",
    database_record_verified: true,
    image_provenance: trimText(product.affiliate_image_provenance) || (product.is_affiliate ? "unknown" : "admin_product"),
  };
}

function configuredAllowedHosts() {
  const configured = trimText(process.env.SOCIAL_PRODUCT_IMAGE_ALLOWED_HOSTS)
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
  const baseUrls = [
    process.env.PUBLIC_MEDIA_BASE_URL,
    process.env.PUBLIC_SITE_URL,
    process.env.FRONTEND_URL,
  ].map(trimText).filter(Boolean);
  const baseHosts = baseUrls.flatMap((value) => {
    try {
      const parsed = new URL(value);
      return [parsed.hostname.toLowerCase()];
    } catch {
      return [];
    }
  });
  return [...new Set([...BUILT_IN_ALLOWED_HOSTS, ...configured, ...baseHosts])];
}

function hostIsAllowlisted(hostname, allowedHosts = configuredAllowedHosts()) {
  const normalized = trimText(hostname).toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

function isBlockedIpv4(address) {
  const octets = trimText(address).split(".").map((value) => Number.parseInt(value, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isBlockedIpv6(address) {
  const normalized = trimText(address).toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized || normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4) : false;
}

function isPublicAddress(address, family = net.isIP(address)) {
  if (Number(family) === 4) return !isBlockedIpv4(address);
  if (Number(family) === 6) return !isBlockedIpv6(address);
  return false;
}

function localUploadPath(sourceUrl) {
  const raw = trimText(sourceUrl);
  if (!raw) return null;
  let pathname = raw;
  if (/^https:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    const publicBase = trimText(process.env.PUBLIC_MEDIA_BASE_URL);
    if (!publicBase) return null;
    let allowedOrigin;
    try {
      allowedOrigin = new URL(publicBase).origin;
    } catch {
      return null;
    }
    if (parsed.origin !== allowedOrigin) return null;
    pathname = parsed.pathname;
  }
  if (!pathname.startsWith("/uploads/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const uploadsRoot = path.resolve(__dirname, "..", "..", "uploads");
  const resolved = path.resolve(uploadsRoot, decoded.replace(/^\/uploads\//, ""));
  if (resolved === uploadsRoot || !resolved.startsWith(`${uploadsRoot}${path.sep}`)) return null;
  return resolved;
}

function detectImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

async function validateAuthenticReferenceBuffer(buffer, {
  sourceUrl,
  declaredMimeType = null,
  suppliedChecksum = null,
  sourceKind = "verified_product_database",
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_PRODUCT_REFERENCE_BYTES) {
    throw productCreativeError("social_product_reference_invalid", "The authentic product image is empty or exceeds the guarded size limit.");
  }
  const signature = detectImageSignature(buffer);
  if (!signature) {
    throw productCreativeError("social_product_reference_invalid", "The authentic product image has an unsupported or invalid file signature.");
  }
  const mimeType = MIME_BY_SIGNATURE[signature];
  if (declaredMimeType && trimText(declaredMimeType).toLowerCase().split(";")[0] !== mimeType) {
    throw productCreativeError("social_product_reference_invalid", "The authentic product image MIME type does not match its file signature.");
  }
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error", limitInputPixels: MAX_PRODUCT_REFERENCE_PIXELS }).metadata();
  } catch (cause) {
    throw productCreativeError("social_product_reference_invalid", "The authentic product image could not be decoded safely.", cause);
  }
  if (
    !metadata.width
    || !metadata.height
    || metadata.width * metadata.height > MAX_PRODUCT_REFERENCE_PIXELS
    || trimText(metadata.format).toLowerCase() !== signature
  ) {
    throw productCreativeError("social_product_reference_invalid", "The authentic product image dimensions or decoded format are invalid.");
  }
  const checksum = sha256(buffer);
  const normalizedSuppliedChecksum = trimText(suppliedChecksum).toLowerCase();
  if (normalizedSuppliedChecksum && (!/^[a-f0-9]{64}$/.test(normalizedSuppliedChecksum) || normalizedSuppliedChecksum !== checksum)) {
    throw productCreativeError("social_product_reference_mismatch", "The authentic product image checksum does not match the verified source bytes.");
  }
  return {
    buffer,
    source_url: trimText(sourceUrl),
    checksum_sha256: checksum,
    mime_type: mimeType,
    detected_file_signature: signature,
    file_size_bytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    source_kind: sourceKind,
  };
}

function pinnedLookup(address) {
  return (_hostname, options, callback) => {
    const family = net.isIP(address);
    if (options && typeof options === "object" && options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

async function downloadAllowlistedProductImage(sourceUrl, dependencies = {}) {
  const localPath = localUploadPath(sourceUrl);
  if (localPath) {
    let stats;
    try {
      stats = await fs.promises.stat(localPath);
    } catch (cause) {
      throw productCreativeError("social_product_reference_unavailable", "The verified local product image is unavailable.", cause);
    }
    if (!stats.isFile() || stats.size > MAX_PRODUCT_REFERENCE_BYTES) {
      throw productCreativeError("social_product_reference_invalid", "The verified local product image is not a guarded file or exceeds the size limit.");
    }
    return { buffer: await fs.promises.readFile(localPath), declaredMimeType: null, sourceKind: "guarded_local_upload" };
  }

  let parsed;
  try {
    parsed = new URL(trimText(sourceUrl));
  } catch (cause) {
    throw productCreativeError("social_product_reference_url_invalid", "The product image URL is invalid.", cause);
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || (parsed.port && parsed.port !== "443")
  ) {
    throw productCreativeError("social_product_reference_url_invalid", "Remote product images must use a credential-free HTTPS URL on port 443.");
  }
  const allowedHosts = dependencies.allowedProductImageHosts || configuredAllowedHosts();
  if (!hostIsAllowlisted(parsed.hostname, allowedHosts)) {
    throw productCreativeError("social_product_reference_url_blocked", "The product image host is not on the explicit social product-media allowlist.");
  }
  let addresses;
  try {
    const lookup = dependencies.lookup || dns.lookup;
    addresses = net.isIP(parsed.hostname)
      ? [{ address: parsed.hostname, family: net.isIP(parsed.hostname) }]
      : await lookup(parsed.hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw productCreativeError("social_product_reference_unavailable", "The allowlisted product image host could not be resolved.", cause);
  }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
    throw productCreativeError("social_product_reference_url_blocked", "The product image URL resolves to a private, local, or reserved network address.");
  }

  const selectedAddress = addresses[0].address;
  const lookup = pinnedLookup(selectedAddress);
  const request = dependencies.httpGet || axios.get;
  let response;
  try {
    response = await request(parsed.toString(), {
      responseType: "arraybuffer",
      timeout: 20_000,
      maxRedirects: 0,
      maxContentLength: MAX_PRODUCT_REFERENCE_BYTES,
      maxBodyLength: MAX_PRODUCT_REFERENCE_BYTES,
      decompress: false,
      proxy: false,
      httpAgent: new http.Agent({ lookup }),
      httpsAgent: new https.Agent({ lookup }),
      validateStatus: (status) => status >= 200 && status < 300,
    });
  } catch (cause) {
    throw productCreativeError("social_product_reference_unavailable", "The allowlisted product image could not be downloaded safely.", cause);
  }
  const headers = response?.headers || {};
  const rawDeclaredLength = headers["content-length"] || headers.get?.("content-length") || null;
  const declaredLength = rawDeclaredLength == null ? 0 : Number(rawDeclaredLength);
  const contentEncoding = trimText(headers["content-encoding"] || headers.get?.("content-encoding")).toLowerCase();
  const declaredMimeType = trimText(headers["content-type"] || headers.get?.("content-type")).toLowerCase().split(";")[0];
  if (
    (rawDeclaredLength != null && (!Number.isFinite(declaredLength) || declaredLength < 1))
    || declaredLength > MAX_PRODUCT_REFERENCE_BYTES
    || (contentEncoding && contentEncoding !== "identity")
    || !Object.values(MIME_BY_SIGNATURE).includes(declaredMimeType)
  ) {
    throw productCreativeError("social_product_reference_invalid", "The product image response violates the guarded size or encoding policy.");
  }
  const buffer = Buffer.from(response?.data || []);
  if (!buffer.length || buffer.length > MAX_PRODUCT_REFERENCE_BYTES) {
    throw productCreativeError("social_product_reference_invalid", "The downloaded product image is empty or exceeds the guarded size limit.");
  }
  return {
    buffer,
    declaredMimeType,
    sourceKind: "allowlisted_https_download",
  };
}

async function readAuthenticProductReference(productRecord, dependencies = {}) {
  let downloaded;
  const reader = dependencies.readAuthenticProductReference || dependencies.readAndNormalizeReferenceImage;
  if (typeof reader === "function") {
    const supplied = await reader(productRecord.url);
    downloaded = {
      ...supplied,
      buffer: supplied?.buffer,
      declaredMimeType: supplied?.mime_type || supplied?.content_type || null,
      sourceKind: supplied?.source_kind || "verified_product_reader",
      suppliedChecksum: supplied?.checksum_sha256,
    };
  } else {
    downloaded = await downloadAllowlistedProductImage(productRecord.url, dependencies);
  }
  const sourceUrl = trimText(downloaded?.source_url || downloaded?.url || productRecord.url);
  if (sourceUrl !== productRecord.url) {
    throw productCreativeError("social_product_reference_mismatch", "The downloaded product reference URL does not match the production database record.");
  }
  const validated = await validateAuthenticReferenceBuffer(downloaded.buffer, {
    sourceUrl: productRecord.url,
    declaredMimeType: downloaded.declaredMimeType,
    suppliedChecksum: downloaded.suppliedChecksum,
    sourceKind: downloaded.sourceKind,
  });
  return {
    ...validated,
    product_id: productRecord.id,
    product_title: productRecord.title,
    database_model: productRecord.database_model,
    database_record_verified: true,
    usage_rights_status: productRecord.usage_rights_status,
    image_provenance: productRecord.image_provenance,
  };
}

async function compositeAuthenticProduct({ backgroundBuffer, reference, format }) {
  const vertical = ["STORY", "REEL", "VIDEO_FEED"].includes(trimText(format).toUpperCase());
  const canvas = vertical ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
  const beforeChecksum = sha256(reference.buffer);
  if (beforeChecksum !== reference.checksum_sha256) {
    throw productCreativeError("social_product_reference_mismatch", "The authentic product bytes changed before local composition.");
  }
  let productLayer;
  let layerMetadata;
  try {
    productLayer = await sharp(reference.buffer, { failOn: "error", limitInputPixels: MAX_PRODUCT_REFERENCE_PIXELS })
      .rotate()
      .resize({
        width: Math.floor(canvas.width * 0.46),
        height: Math.floor(canvas.height * 0.58),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    layerMetadata = await sharp(productLayer).metadata();
  } catch (cause) {
    throw productCreativeError("social_product_composite_failed", "The authentic product image could not be prepared for lossless local placement.", cause);
  }
  const left = Math.max(canvas.width - Number(layerMetadata.width || 0) - 54, 0);
  const top = Math.max(Math.floor((canvas.height - Number(layerMetadata.height || 0)) / 2) + (vertical ? 120 : 70), 0);
  let buffer;
  try {
    buffer = await sharp(backgroundBuffer, { failOn: "error", limitInputPixels: 40_000_000 })
      .composite([{ input: productLayer, left, top, blend: "over" }])
      .jpeg({ quality: 94, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
  } catch (cause) {
    throw productCreativeError("social_product_composite_failed", "The authentic product could not be composited onto the AI-only background.", cause);
  }
  if (sha256(reference.buffer) !== beforeChecksum) {
    throw productCreativeError("social_product_reference_mismatch", "The authentic product source bytes changed during composition.");
  }
  return {
    buffer,
    renderer: "sharp_authentic_product_composite_v1",
    placement: {
      left,
      top,
      width: Number(layerMetadata.width),
      height: Number(layerMetadata.height),
      fit: "inside",
      crop: false,
      occurrence_count: 1,
    },
    source_reference_checksum_sha256: beforeChecksum,
    source_reference_file_size_bytes: reference.buffer.length,
    product_pixels_generated_by_ai: false,
    packaging_editing_performed: false,
  };
}

module.exports = {
  MAX_PRODUCT_REFERENCE_BYTES,
  compositeAuthenticProduct,
  downloadAllowlistedProductImage,
  readAuthenticProductReference,
  resolveVerifiedProductRecord,
  validateAuthenticReferenceBuffer,
  _private: {
    configuredAllowedHosts,
    detectImageSignature,
    hostIsAllowlisted,
    isPublicAddress,
    localUploadPath,
    productImageUrl,
  },
};
