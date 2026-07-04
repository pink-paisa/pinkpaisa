const axios = require("axios");
const dns = require("dns").promises;
const net = require("net");
const { getPublicUploadBaseUrl, saveImageBufferAsWebp } = require("./imageUpload");

const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;

function getPublicAppBaseUrl() {
  return getPublicUploadBaseUrl();
}

function isHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isManagedUploadUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (normalized.startsWith("/uploads/")) return true;
  return normalized.startsWith(`${getPublicAppBaseUrl()}/uploads/`);
}

function normalizeManagedUploadUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.startsWith("/uploads/")) return `${getPublicAppBaseUrl()}${normalized}`;
  return normalized;
}

function isBlockedIpv4(address = "") {
  const parts = String(address).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

function isBlockedIpv6(address = "") {
  const normalized = String(address || "").toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function isBlockedAddress(address = "", family = 0) {
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return false;
}

async function assertSafeRemoteImageUrl(imageUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(imageUrl || "").trim());
  } catch {
    throw new Error("Image URL must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Image URL must use http or https");
  }

  const hostname = String(parsedUrl.hostname || "").trim().toLowerCase();
  if (!hostname) throw new Error("Image URL hostname is required");
  if (["localhost", "0.0.0.0"].includes(hostname) || hostname.endsWith(".local")) {
    throw new Error("Image URL must not target a private or local network host");
  }

  const directIpFamily = net.isIP(hostname);
  const resolved = directIpFamily
    ? [{ address: hostname, family: directIpFamily }]
    : await dns.lookup(hostname, { all: true, verbatim: true });

  if (!resolved.length) throw new Error("Image URL hostname could not be resolved");

  for (const entry of resolved) {
    if (isBlockedAddress(entry.address, entry.family)) {
      throw new Error("Image URL must not target a private or local network host");
    }
  }

  return parsedUrl.toString();
}

function assertRemoteImageSize(headers = {}) {
  const rawLength = headers["content-length"];
  if (!rawLength) return;
  const contentLength = Number.parseInt(String(rawLength), 10);
  if (!Number.isNaN(contentLength) && contentLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(`Image URL is too large. Maximum allowed size is ${Math.round(MAX_REMOTE_IMAGE_BYTES / (1024 * 1024))} MB`);
  }
}

async function downloadRemoteImageToUpload(imageUrl) {
  const safeUrl = await assertSafeRemoteImageUrl(imageUrl);
  const response = await axios.get(safeUrl, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxRedirects: 5,
    maxContentLength: MAX_REMOTE_IMAGE_BYTES,
    maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  assertRemoteImageSize(response.headers);
  const contentType = String(response.headers["content-type"] || "");
  if (!contentType.startsWith("image/")) {
    throw new Error("Image URL did not return an image file");
  }
  const imageBuffer = Buffer.from(response.data);
  if (imageBuffer.length > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(`Image URL is too large. Maximum allowed size is ${Math.round(MAX_REMOTE_IMAGE_BYTES / (1024 * 1024))} MB`);
  }
  const uploadedImage = await saveImageBufferAsWebp(imageBuffer, {
    subdir: "vendor-products",
    prefix: "vendor",
    maxWidth: 1800,
    maxHeight: 1800,
    quality: 82,
  });
  return uploadedImage.publicUrl;
}

async function ingestVendorImage(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!isHttpUrl(normalized)) return normalizeManagedUploadUrl(normalized);
  if (isManagedUploadUrl(normalized)) return normalizeManagedUploadUrl(normalized);
  return downloadRemoteImageToUpload(normalized);
}

async function validateRemoteImageUrl(imageUrl) {
  const normalized = String(imageUrl || "").trim();
  if (!normalized) return null;
  if (!isHttpUrl(normalized) && !normalized.startsWith("/uploads/")) return "Image URL must start with http://, https://, or /uploads/";
  if (isManagedUploadUrl(normalized)) return null;
  try {
    const safeUrl = await assertSafeRemoteImageUrl(normalized);
    const response = await axios.get(safeUrl, {
      responseType: "stream",
      timeout: 10000,
      maxRedirects: 5,
      maxContentLength: MAX_REMOTE_IMAGE_BYTES,
      maxBodyLength: MAX_REMOTE_IMAGE_BYTES,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const contentType = String(response.headers["content-type"] || "");
    assertRemoteImageSize(response.headers);
    response.data.destroy();
    if (!contentType.startsWith("image/")) return "Image URL does not point to an image";
    return null;
  } catch (error) {
    if (error?.message) return error.message;
    return error?.response?.status ? `Image URL returned ${error.response.status}` : "Image URL could not be reached";
  }
}

module.exports = {
  MAX_REMOTE_IMAGE_BYTES,
  assertSafeRemoteImageUrl,
  getPublicAppBaseUrl,
  ingestVendorImage,
  isManagedUploadUrl,
  normalizeManagedUploadUrl,
  validateRemoteImageUrl,
};
