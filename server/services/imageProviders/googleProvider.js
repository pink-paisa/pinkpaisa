const GEMINI_API_BASE = String(
  process.env.GEMINI_API_BASE_URL
  || process.env.GOOGLE_GEMINI_API_BASE_URL
  || "https://generativelanguage.googleapis.com/v1beta"
).replace(/\/+$/, "");

const DEFAULT_ASPECT_RATIO = trimText(process.env.GEMINI_IMAGE_ASPECT_RATIO || process.env.GOOGLE_IMAGE_ASPECT_RATIO || "4:5");
const DEFAULT_FLASH_IMAGE_SIZE = trimText(process.env.GEMINI_IMAGE_SIZE || process.env.GOOGLE_IMAGE_SIZE || "2K");

function trimText(value) {
  return String(value || "").trim();
}

function resolveApiKey() {
  return trimText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

function resolveMimeType(buffer) {
  if (!buffer || buffer.length < 4) return "image/jpeg";

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }

  return "image/jpeg";
}

function aspectRatioFromSize(size) {
  const raw = trimText(size);
  if (!raw) return DEFAULT_ASPECT_RATIO;

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return DEFAULT_ASPECT_RATIO;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DEFAULT_ASPECT_RATIO;
  }

  if (Math.abs((width / height) - (1 / 1)) < 0.08) return "1:1";
  if (Math.abs((width / height) - (4 / 5)) < 0.08) return "4:5";
  if (Math.abs((width / height) - (3 / 4)) < 0.08) return "3:4";
  if (Math.abs((width / height) - (2 / 3)) < 0.08) return "2:3";
  if (Math.abs((width / height) - (16 / 9)) < 0.08) return "16:9";
  if (Math.abs((width / height) - (9 / 16)) < 0.08) return "9:16";

  return DEFAULT_ASPECT_RATIO;
}

function supportsImageSize(model) {
  return /^gemini-3\./i.test(trimText(model));
}

function resolveImageSize(model, quality) {
  if (!supportsImageSize(model)) return null;

  if (quality === "high") return "4K";
  if (quality === "low") return "1K";
  return DEFAULT_FLASH_IMAGE_SIZE || "2K";
}

function buildRequestBody({ model, prompt, sourceImageBuffer, size, quality }) {
  const parts = [];
  if (sourceImageBuffer) {
    parts.push({
      inlineData: {
        mimeType: resolveMimeType(sourceImageBuffer),
        data: sourceImageBuffer.toString("base64"),
      },
    });
  }

  parts.push({ text: prompt });

  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio: aspectRatioFromSize(size),
      },
    },
  };

  const imageSize = resolveImageSize(model, quality);
  if (imageSize) {
    body.generationConfig.imageConfig.imageSize = imageSize;
  }

  return body;
}

function extractImageBuffer(responseJson) {
  const candidates = Array.isArray(responseJson?.candidates) ? responseJson.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const imagePart = parts.find((part) => trimText(part?.inlineData?.data));
    if (imagePart?.inlineData?.data) {
      return Buffer.from(imagePart.inlineData.data, "base64");
    }
  }

  throw new Error("Google Gemini did not return an image result");
}

async function generateImage({ model, prompt, sourceImageBuffer, size, quality }) {
  if (!sourceImageBuffer?.length) {
    const error = new Error("A product reference image is required for Google campaign image editing");
    error.code = "reference_image_required";
    throw error;
  }
  const apiKey = resolveApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required for Google image generation");

  const resolvedModel = trimText(model);
  if (!resolvedModel) throw new Error("A Google image model must be selected");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(resolvedModel)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(buildRequestBody({
        model: resolvedModel,
        prompt,
        sourceImageBuffer,
        size,
        quality,
      })),
      signal: controller.signal,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message || json?.message || "Google image generation failed";
      throw new Error(message);
    }

    return extractImageBuffer(json);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Google image generation timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateImage,
  _private: {
    buildRequestBody,
    resolveMimeType,
  },
};
