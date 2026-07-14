const axios = require("axios");

const OPENAI_IMAGE_API_BASE = String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const DEFAULT_IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE || "1024x1536";
const DEFAULT_IMAGE_FORMAT = "jpeg";
const DEFAULT_IMAGE_COMPRESSION = Math.min(Math.max(Number(process.env.OPENAI_IMAGE_COMPRESSION || 86), 40), 100);
const DEFAULT_IMAGE_INPUT_FIDELITY = String(process.env.OPENAI_IMAGE_INPUT_FIDELITY || "high").trim();
const DEFAULT_SOURCE_IMAGE_MIME = "image/jpeg";

function trimText(value) {
  return String(value || "").trim();
}

function supportsInputFidelity(model) {
  return /^gpt-image-1$/i.test(trimText(model));
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

  if (sourceImageBuffer) {
    const form = new FormData();
    form.append("model", resolvedModel);
    form.append("prompt", prompt);
    form.append("size", trimText(size || DEFAULT_IMAGE_SIZE));
    form.append("quality", quality || "medium");
    form.append("output_format", DEFAULT_IMAGE_FORMAT);
    form.append("output_compression", String(DEFAULT_IMAGE_COMPRESSION));
    if (DEFAULT_IMAGE_INPUT_FIDELITY && supportsInputFidelity(resolvedModel)) {
      form.append("input_fidelity", DEFAULT_IMAGE_INPUT_FIDELITY);
    }
    form.append("image", new Blob([sourceImageBuffer], { type: DEFAULT_SOURCE_IMAGE_MIME }), "product-reference.jpg");

    const response = await fetch(`${OPENAI_IMAGE_API_BASE}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message || json?.message || "OpenAI image edit failed";
      throw new Error(message);
    }

    return parseGeneratedImageBuffer(json);
  }

  const response = await fetch(`${OPENAI_IMAGE_API_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolvedModel,
      prompt,
      size: trimText(size || DEFAULT_IMAGE_SIZE),
      quality: quality || "medium",
      output_format: DEFAULT_IMAGE_FORMAT,
      output_compression: DEFAULT_IMAGE_COMPRESSION,
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message || json?.message || "OpenAI image generation failed";
    throw new Error(message);
  }

  return parseGeneratedImageBuffer(json);
}

module.exports = {
  generateImage,
  _private: {
    supportsInputFidelity,
  },
};
