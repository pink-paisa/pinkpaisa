const OPENROUTER_API_BASE = String(process.env.OPENROUTER_API_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const OPENROUTER_MODELS_CACHE_TTL_MS = Math.max(Number(process.env.OPENROUTER_MODELS_CACHE_TTL_MS || 15 * 60 * 1000), 30 * 1000);

const modelCache = {
  expiresAt: 0,
  items: [],
};

function trimText(value) {
  return String(value || "").trim();
}

function resolveApiKey() {
  return trimText(process.env.OPENROUTER_API_KEY);
}

function resolveHeaders() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter image generation");
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const referer = trimText(process.env.OPENROUTER_SITE_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.SERVER_URL);
  if (referer) headers["HTTP-Referer"] = referer;

  const title = trimText(process.env.OPENROUTER_APP_NAME || "Pink Paisa");
  if (title) headers["X-Title"] = title;

  return headers;
}

function mimeTypeFromBuffer(buffer) {
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

function aspectRatioFromSize(size) {
  const raw = trimText(size);
  if (!raw) return "4:5";

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return "4:5";

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "4:5";

  if (Math.abs((width / height) - 1) < 0.08) return "1:1";
  if (Math.abs((width / height) - (4 / 5)) < 0.08) return "4:5";
  if (Math.abs((width / height) - (3 / 4)) < 0.08) return "3:4";
  if (Math.abs((width / height) - (2 / 3)) < 0.08) return "2:3";
  if (Math.abs((width / height) - (16 / 9)) < 0.08) return "16:9";
  if (Math.abs((width / height) - (9 / 16)) < 0.08) return "9:16";

  return "4:5";
}

function imageSizeFromQuality(quality) {
  if (quality === "high") return "1536x1024";
  if (quality === "low") return "1024x1024";
  return "1024x1536";
}

function parseUsd(value) {
  const numeric = Number(trimText(value));
  return Number.isFinite(numeric) ? numeric : 0;
}

function deriveCostTier(model) {
  const imagePrice = parseUsd(model?.pricing?.image);
  const requestPrice = parseUsd(model?.pricing?.request);
  const reference = imagePrice > 0 ? imagePrice : requestPrice;

  if (reference <= 0.02) return "low";
  if (reference <= 0.08) return "medium";
  return "high";
}

function supportsReferenceImage(model) {
  const inputModalities = Array.isArray(model?.architecture?.input_modalities) ? model.architecture.input_modalities : [];
  return inputModalities.includes("image");
}

function supportsTextToImage(model) {
  const inputModalities = Array.isArray(model?.architecture?.input_modalities) ? model.architecture.input_modalities : [];
  return inputModalities.includes("text");
}

function normalizeModelDefinition(model) {
  return {
    id: trimText(model?.id),
    label: trimText(model?.name || model?.id),
    supports_reference_image: supportsReferenceImage(model),
    supports_text_to_image: supportsTextToImage(model),
    cost_tier: deriveCostTier(model),
    output_modalities: Array.isArray(model?.architecture?.output_modalities) ? model.architecture.output_modalities : [],
    supported_parameters: Array.isArray(model?.supported_parameters) ? model.supported_parameters : [],
  };
}

async function fetchOpenRouterModelsRaw({ force = false } = {}) {
  const now = Date.now();
  if (!force && modelCache.expiresAt > now && Array.isArray(modelCache.items) && modelCache.items.length) {
    return modelCache.items;
  }

  const headers = resolveHeaders();
  const response = await fetch(`${OPENROUTER_API_BASE}/models?output_modalities=image`, {
    method: "GET",
    headers,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.error?.message || json?.message || "OpenRouter model discovery failed";
    throw new Error(message);
  }

  const models = Array.isArray(json?.data) ? json.data : [];
  modelCache.items = models;
  modelCache.expiresAt = now + OPENROUTER_MODELS_CACHE_TTL_MS;
  return models;
}

async function fetchImageModels(options = {}) {
  const models = await fetchOpenRouterModelsRaw(options);
  return models
    .map(normalizeModelDefinition)
    .filter((model) => model.id)
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function getModelMetadata(modelId) {
  const resolvedId = trimText(modelId);
  if (!resolvedId) return null;

  const models = await fetchImageModels();
  return models.find((model) => model.id === resolvedId) || null;
}

function buildImageConfig(modelMetadata, size, quality) {
  const supportedParameters = Array.isArray(modelMetadata?.supported_parameters) ? modelMetadata.supported_parameters : [];
  const supportsImageConfig = supportedParameters.some((parameter) => /^image_config/i.test(parameter));
  if (!supportsImageConfig) return null;

  const imageConfig = {};
  const supportsAspectRatio = supportedParameters.some((parameter) => /aspect_ratio/i.test(parameter)) || supportsImageConfig;
  if (supportsAspectRatio) {
    imageConfig.aspect_ratio = aspectRatioFromSize(size);
  }

  const supportsImageSize = supportedParameters.some((parameter) => /image_size/i.test(parameter));
  if (supportsImageSize) {
    imageConfig.image_size = imageSizeFromQuality(quality);
  }

  return Object.keys(imageConfig).length ? imageConfig : null;
}

function buildMessages({ prompt, sourceImageBuffer }) {
  if (!sourceImageBuffer) {
    return [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
        ],
      },
    ];
  }

  return [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeTypeFromBuffer(sourceImageBuffer)};base64,${sourceImageBuffer.toString("base64")}`,
          },
        },
      ],
    },
  ];
}

function decodeDataUrl(url) {
  const raw = trimText(url);
  const match = raw.match(/^data:.*?;base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

function extractImageBuffer(json) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  for (const choice of choices) {
    const message = choice?.message || {};
    const images = Array.isArray(message?.images) ? message.images : [];
    for (const image of images) {
      const url = trimText(image?.image_url?.url || image?.imageUrl?.url || image?.url);
      const decoded = decodeDataUrl(url);
      if (decoded) return decoded;
    }
  }

  throw new Error("OpenRouter did not return an image result");
}

async function generateImage({ model, prompt, sourceImageBuffer, size, quality }) {
  const resolvedModel = trimText(model);
  if (!resolvedModel) throw new Error("An OpenRouter image model must be selected");

  const headers = resolveHeaders();
  const modelMetadata = await getModelMetadata(resolvedModel);

  const modalities = Array.isArray(modelMetadata?.output_modalities) && modelMetadata.output_modalities.includes("text")
    ? ["image", "text"]
    : ["image"];

  const body = {
    model: resolvedModel,
    messages: buildMessages({ prompt, sourceImageBuffer }),
    modalities,
  };

  const imageConfig = buildImageConfig(modelMetadata, size, quality);
  if (imageConfig) {
    body.image_config = imageConfig;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const message = json?.error?.message || json?.message || "OpenRouter image generation failed";
      throw new Error(message);
    }

    return extractImageBuffer(json);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OpenRouter image generation timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchImageModels,
  generateImage,
  getModelMetadata,
};
