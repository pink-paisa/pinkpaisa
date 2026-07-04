const AdminSettings = require("../models/AdminSettings");
const {
  getDefaultModelId,
  getDefaultProviderKey,
  normaliseImageProviderSelection,
} = require("../services/imageProviders");

const CAMPAIGN_SETTINGS_KEY = "campaigns";

const DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE = [
  "Use the uploaded image of my product as the base.",
  "",
  "Create a high-quality Instagram marketing creative for this product.",
  "",
  "Product details:",
  "- Product name: [Your Product Name]",
  "- Category: [e.g., Skincare / Perfume / Serum]",
  "- Target audience: [e.g., Men 20-35 / Women / Luxury buyers]",
  "- Key benefits: [e.g., Hydration, Glow, Anti-aging]",
  "- Brand tone: [Luxury / Minimal / Bold / Natural / Premium]",
  "",
  "Design requirements:",
  "- Keep the original product intact and realistic",
  "- Enhance lighting to make it premium and eye-catching",
  "- Add a clean, aesthetic background (suggest options if needed)",
  "- Include subtle props that match the product vibe (e.g., flowers, stones, water, fabric)",
  "- Add soft shadows and reflections for depth",
  "- Maintain a modern Instagram ad style",
  "- Keep the product as the hero on the left or center-left",
  "- Leave elegant negative space in the composition for a balanced premium look",
  "",
  "Style references:",
  "- Cinematic lighting",
  "- Soft gradients or neutral tones",
  "- Instagram luxury brand aesthetic",
  "- High contrast but elegant",
  "",
  "Output:",
  "- Portrait-friendly composition suitable for Instagram marketing",
  "- Ultra high resolution",
  "- Clean, minimal, premium look",
  "- No typography, no price stickers, no CTA button rendered directly inside the AI image",
].join("\n");

const DEFAULT_CAMPAIGN_SETTINGS = {
  campaign_mode: "manual",
  campaign_batch_hour_ist: 9,
  campaign_batch_minute_ist: 0,
  campaign_creative_mode: "template",
  campaign_ai_provider: getDefaultProviderKey(),
  campaign_ai_model: getDefaultModelId(getDefaultProviderKey()),
  campaign_ai_image_quality: "medium",
  campaign_ai_prompt_template: DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
};

function normaliseCampaignSettings(settings = {}) {
  const rawCreativeMode = String(settings.campaign_creative_mode || "").trim();
  const normalisedCreativeMode = ["ai_assisted", "ai_full", "ai_generated"].includes(rawCreativeMode)
    ? "ai_generated"
    : DEFAULT_CAMPAIGN_SETTINGS.campaign_creative_mode;
  const selection = normaliseImageProviderSelection(
    settings.campaign_ai_provider || DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_provider,
    settings.campaign_ai_model || DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_model,
  );

  return {
    campaign_mode: settings.campaign_mode === "automatic" ? "automatic" : DEFAULT_CAMPAIGN_SETTINGS.campaign_mode,
    campaign_batch_hour_ist: Number.isFinite(Number(settings.campaign_batch_hour_ist))
      ? Math.min(Math.max(Number(settings.campaign_batch_hour_ist), 0), 23)
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_batch_hour_ist,
    campaign_batch_minute_ist: Number.isFinite(Number(settings.campaign_batch_minute_ist))
      ? Math.min(Math.max(Number(settings.campaign_batch_minute_ist), 0), 59)
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_batch_minute_ist,
    campaign_creative_mode: rawCreativeMode === "template"
      ? "template"
      : normalisedCreativeMode,
    campaign_ai_provider: selection.provider,
    campaign_ai_model: selection.model,
    campaign_ai_image_quality: ["low", "medium", "high"].includes(String(settings.campaign_ai_image_quality || "").trim())
      ? String(settings.campaign_ai_image_quality).trim()
      : DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_image_quality,
    campaign_ai_prompt_template: String(settings.campaign_ai_prompt_template || "").trim()
      || DEFAULT_CAMPAIGN_SETTINGS.campaign_ai_prompt_template,
  };
}

async function getCampaignSettings() {
  const settings = await AdminSettings.findOne({ key: CAMPAIGN_SETTINGS_KEY }).lean();
  return normaliseCampaignSettings(settings || {});
}

module.exports = {
  CAMPAIGN_SETTINGS_KEY,
  DEFAULT_CAMPAIGN_AI_PROMPT_TEMPLATE,
  DEFAULT_CAMPAIGN_SETTINGS,
  getCampaignSettings,
  normaliseCampaignSettings,
};
