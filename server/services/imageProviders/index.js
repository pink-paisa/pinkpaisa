const openaiProvider = require("./openaiProvider");
const googleProvider = require("./googleProvider");
const openrouterProvider = require("./openrouterProvider");

const {
  buildImageProviderRegistryResponse,
  getDefaultModelId,
  getDefaultProviderKey,
  getModelDefinition,
  getProviderDefinition,
  normaliseImageProviderSelection,
} = require("./registry");

const PROVIDER_ADAPTERS = {
  openai: openaiProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
};

async function generateImage({ provider, model, prompt, sourceImageBuffer, size, quality }) {
  const selection = normaliseImageProviderSelection(provider, model);
  const providerDefinition = getProviderDefinition(selection.provider);
  if (!providerDefinition || !providerDefinition.enabled) {
    throw new Error("Selected image provider is not enabled");
  }

  const modelDefinition = getModelDefinition(selection.provider, selection.model);
  if (!modelDefinition && selection.provider !== "openrouter") {
    throw new Error("Selected image model is not available for this provider");
  }

  const adapter = PROVIDER_ADAPTERS[selection.provider];
  if (!adapter || typeof adapter.generateImage !== "function") {
    throw new Error(`Image provider adapter missing for ${selection.provider}`);
  }

  return adapter.generateImage({
    model: selection.model,
    prompt,
    sourceImageBuffer,
    size,
    quality,
  });
}

module.exports = {
  buildImageProviderRegistryResponse,
  generateImage,
  getDefaultModelId,
  getDefaultProviderKey,
  getModelDefinition,
  getProviderDefinition,
  normaliseImageProviderSelection,
};
