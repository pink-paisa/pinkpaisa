function trimText(value) {
  return String(value || "").trim();
}

const IMAGE_PROVIDER_REGISTRY = [
  {
    key: "openai",
    label: "OpenAI",
    description: "Production-ready image generation for Pink Paisa campaigns.",
    enabled: true,
    coming_soon: false,
    models: [
      {
        id: "gpt-image-1-mini",
        label: "GPT Image 1 Mini",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "low",
      },
      {
        id: "gpt-image-1",
        label: "GPT Image 1",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "medium",
      },
      {
        id: "gpt-image-2",
        label: "GPT Image 2",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "high",
      },
    ],
  },
  {
    key: "google",
    label: "Google",
    description: "Gemini image generation for product-led campaign visuals.",
    enabled: true,
    coming_soon: false,
    models: [
      {
        id: "gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "low",
      },
      {
        id: "gemini-3.1-flash-image-preview",
        label: "Gemini 3.1 Flash Image Preview",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "medium",
      },
      {
        id: "gemini-3-pro-image-preview",
        label: "Gemini 3 Pro Image Preview",
        supports_reference_image: true,
        supports_text_to_image: true,
        cost_tier: "high",
      },
    ],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    description: "Dynamic image model discovery through OpenRouter.",
    enabled: true,
    coming_soon: false,
    models: [],
  },
];

function cloneProvider(provider) {
  return {
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  };
}

function getImageProviderRegistry() {
  return IMAGE_PROVIDER_REGISTRY.map(cloneProvider);
}

function getProviderDefinition(providerKey) {
  return IMAGE_PROVIDER_REGISTRY.find((provider) => provider.key === trimText(providerKey)) || null;
}

function getEnabledProviderDefinitions() {
  return IMAGE_PROVIDER_REGISTRY.filter((provider) => provider.enabled);
}

function getDefaultProviderKey() {
  return getEnabledProviderDefinitions()[0]?.key || "openai";
}

function getDefaultModelId(providerKey) {
  const provider = getProviderDefinition(providerKey) || getProviderDefinition(getDefaultProviderKey());
  if (!provider) return "";

  const envPreferredModel = provider.key === "openai"
    ? trimText(process.env.OPENAI_IMAGE_MODEL)
    : provider.key === "google"
      ? trimText(process.env.GEMINI_IMAGE_MODEL || process.env.GOOGLE_IMAGE_MODEL)
      : provider.key === "openrouter"
        ? trimText(process.env.OPENROUTER_IMAGE_MODEL)
      : "";
  if (envPreferredModel && provider.models.some((model) => model.id === envPreferredModel)) {
    return envPreferredModel;
  }

  if (provider.key === "openrouter" && envPreferredModel) {
    return envPreferredModel;
  }

  return provider.models[0]?.id || "";
}

function getModelDefinition(providerKey, modelId) {
  const provider = getProviderDefinition(providerKey);
  if (!provider) return null;
  return provider.models.find((model) => model.id === trimText(modelId)) || null;
}

function normaliseImageProviderSelection(rawProviderKey, rawModelId) {
  const requestedProvider = getProviderDefinition(rawProviderKey);
  const provider = requestedProvider?.enabled
    ? requestedProvider
    : getProviderDefinition(getDefaultProviderKey());

  const providerKey = provider?.key || getDefaultProviderKey();
  const requestedModel = getModelDefinition(providerKey, rawModelId);
  const rawModel = trimText(rawModelId);
  const modelKey = requestedModel
    ? requestedModel.id
    : providerKey === "openrouter" && rawModel
      ? rawModel
      : getDefaultModelId(providerKey);

  return {
    provider: providerKey,
    model: modelKey,
  };
}

async function buildImageProviderRegistryResponse() {
  const registry = getImageProviderRegistry();

  const openrouterProvider = registry.find((provider) => provider.key === "openrouter");
  if (openrouterProvider) {
    try {
      const { fetchImageModels } = require("./openrouterProvider");
      const models = await fetchImageModels();
      if (models.length) {
        openrouterProvider.models = models;
        openrouterProvider.enabled = true;
        openrouterProvider.coming_soon = false;
        openrouterProvider.description = "Live OpenRouter image model list discovered from the OpenRouter Models API.";
      } else {
        openrouterProvider.enabled = false;
        openrouterProvider.coming_soon = true;
        openrouterProvider.description = "Configure OPENROUTER_API_KEY to load live OpenRouter image models.";
      }
    } catch (error) {
      openrouterProvider.enabled = false;
      openrouterProvider.coming_soon = true;
      openrouterProvider.description = `OpenRouter model discovery unavailable: ${trimText(error?.message || "Unknown error")}`;
      openrouterProvider.models = [];
    }
  }

  const providers = registry.map((provider) => {
    const envPreferredModel = provider.key === "openrouter"
      ? trimText(process.env.OPENROUTER_IMAGE_MODEL)
      : "";
    const defaultModel = provider.enabled
      ? (
        envPreferredModel && provider.models.some((model) => model.id === envPreferredModel)
          ? envPreferredModel
          : provider.models[0]?.id || null
      )
      : null;

    return {
      ...provider,
      default_model: provider.key === "openrouter" && defaultModel == null && envPreferredModel
        ? envPreferredModel
        : defaultModel,
    };
  });

  return {
    providers,
    defaults: {
      provider: getDefaultProviderKey(),
      model: getDefaultModelId(getDefaultProviderKey()),
    },
  };
}

module.exports = {
  buildImageProviderRegistryResponse,
  getDefaultModelId,
  getDefaultProviderKey,
  getEnabledProviderDefinitions,
  getImageProviderRegistry,
  getModelDefinition,
  getProviderDefinition,
  normaliseImageProviderSelection,
};
