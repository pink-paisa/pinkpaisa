const axios = require("axios");
const { getModelDefinition } = require("./registry");

const OPENAI_IMAGE_API_BASE = String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const DEFAULT_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1088x1360";
const DEFAULT_IMAGE_FORMAT = "jpeg";
const DEFAULT_IMAGE_COMPRESSION = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_COMPRESSION || 86), 40), 100);
const DEFAULT_IMAGE_INPUT_FIDELITY = String(process.env.OPENAI_IMAGE_INPUT_FIDELITY || "high").trim();
const DEFAULT_IMAGE_TIMEOUT_MS = Math.max(Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 180000), 30000);

function trimText(value) {
  return String(value || "").trim();
}

function supportsInputFidelity(model) {
  return getModelDefinition("openai", trimText(model))?.capabilities?.input_fidelity === true;
}

function resolveSourceImageMime(buffer) {
  if (!buffer || buffer.length < 4) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x52
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x46
    && buffer[8] === 0x57
    && buffer[9] === 0x45
    && buffer[10] === 0x42
    && buffer[11] === 0x50
  ) return "image/webp";
  return "image/jpeg";
}

function buildEditRequestParameters({ model, prompt, size, quality }) {
  const parameters = {
    model: trimText(model),
    prompt,
    size: trimText(size || DEFAULT_IMAGE_SIZE),
    quality: quality || "medium",
    output_format: DEFAULT_IMAGE_FORMAT,
    output_compression: String(DEFAULT_IMAGE_COMPRESSION),
  };
  if (DEFAULT_IMAGE_INPUT_FIDELITY && supportsInputFidelity(parameters.model)) {
    parameters.input_fidelity = DEFAULT_IMAGE_INPUT_FIDELITY;
  }
  return parameters;
}

function buildEditForm({ model, prompt, sourceImageBuffer, size, quality }) {
  const sourceMime = resolveSourceImageMime(sourceImageBuffer);
  const extension = sourceMime.split("/")[1] || "jpg";
  const form = new FormData();
  const requestParameters = buildEditRequestParameters({ model, prompt, size, quality });
  Object.entries(requestParameters).forEach(([key, value]) => form.append(key, String(value)));
  form.append("image", new Blob([sourceImageBuffer], { type: sourceMime }), `product-reference.${extension}`);
  return form;
}

async function parseGeneratedImageBuffer(responseJson) {
  const first = Array.isArray(responseJson?.data) ? responseJson.data[0] : null;
  if (!first) throw new Error("OpenAI Image API did not return an image result");

  if (first.b64_json) {
    return Buffer.from(first.b64_json, "base64");
  }

  if (first.url) {
    const response = await axios.get(first.url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 30 * 1024 * 1024,
    });
    return Buffer.from(response.data);
  }

  throw new Error("OpenAI Image API response did not include image data");
}

async function generateImage({ model, prompt, sourceImageBuffer, size, quality }) {
  const apiKey = trimText(process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI image generation");

  const resolvedModel = trimText(model);
  if (!resolvedModel) throw new Error("An OpenAI image model must be selected");

  if (!sourceImageBuffer?.length) {
    const error = new Error("A product reference image is required for OpenAI campaign image editing");
    error.code = "reference_image_required";
    throw error;
  }

  const form = buildEditForm({ model: resolvedModel, prompt, sourceImageBuffer, size, quality });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(`${OPENAI_IMAGE_API_BASE}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message || json?.message || "OpenAI image edit failed";
      throw new Error(message);
    }

    return parseGeneratedImageBuffer(json);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OpenAI image edit timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  generateImage,
  _private: {
    buildEditRequestParameters,
    buildEditForm,
    resolveSourceImageMime,
    supportsInputFidelity,
  },
};
