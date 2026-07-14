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

function referenceModelError(message) {
  const error = new Error(message);
  error.code = "reference_model_unsupported";
  return error;
}

async function assertReferenceModelSupported(provider, model) {
  const selection = normaliseImageProviderSelection(provider, model);
  const providerDefinition = getProviderDefinition(selection.provider);
  if (!providerDefinition || !providerDefinition.enabled) {
    throw referenceModelError("Selected image provider is not enabled");
  }

  const modelDefinition = getModelDefinition(selection.provider, selection.model);
  if (selection.provider === "openrouter") {
    let metadata;
    try {
      metadata = await openrouterProvider.getModelMetadata(selection.model);
    } catch (error) {
      const unsupported = referenceModelError("Selected OpenRouter model capability could not be verified");
      unsupported.cause = error;
      throw unsupported;
    }
    if (!metadata || metadata.supports_reference_image !== true) {
      throw referenceModelError("Selected OpenRouter model does not support product reference images");
    }
    return selection;
  }
  if (!modelDefinition || modelDefinition.supports_reference_image !== true) {
    throw referenceModelError("Selected image model does not support product reference images");
  }
  return selection;
}

async function generateImage({ provider, model, prompt, sourceImageBuffer, size, quality }) {
  if (!sourceImageBuffer?.length) {
    const error = new Error("A product reference image is required for campaign creative generation");
    error.code = "reference_image_required";
    throw error;
  }
  const selection = await assertReferenceModelSupported(provider, model);
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
  assertReferenceModelSupported,
  buildImageProviderRegistryResponse,
  generateImage,
  getDefaultModelId,
  getDefaultProviderKey,
  getModelDefinition,
  getProviderDefinition,
  normaliseImageProviderSelection,
};
