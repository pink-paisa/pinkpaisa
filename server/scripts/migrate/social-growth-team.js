const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

const mongoose = require("mongoose");
const AdminSettings = require("../../models/AdminSettings");
const SocialAsset = require("../../models/SocialAsset");
const SocialAudioTrack = require("../../models/SocialAudioTrack");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialCommunityItem = require("../../models/SocialCommunityItem");
const SocialConnectionHealth = require("../../models/SocialConnectionHealth");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialGrowthSnapshot = require("../../models/SocialGrowthSnapshot");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialMetricSnapshot = require("../../models/SocialMetricSnapshot");
const SocialOAuthState = require("../../models/SocialOAuthState");
const SocialOrchestrationReceipt = require("../../models/SocialOrchestrationReceipt");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPromptVersion = require("../../models/SocialPromptVersion");
const SocialResearchObservation = require("../../models/SocialResearchObservation");
const SocialResearchSource = require("../../models/SocialResearchSource");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");
const openAiSocialProvider = require("../../services/social/openAiSocialProvider");
const { _private: { ensurePromptVersions } } = require("../../services/social/socialManagerService");
const {
  SOCIAL_MANAGER_SETTINGS_KEY,
  getSocialManagerDefaults,
  socialManagerSettingsPersistence,
} = require("../../utils/socialManagerSettings");

const INDEX_MODELS = Object.freeze([
  AdminSettings,
  SocialWeeklyPlan,
  SocialConnectionHealth,
  SocialGrowthSnapshot,
  SocialCommunityItem,
  SocialManualAction,
  SocialMetricSnapshot,
  SocialOAuthState,
  SocialOrchestrationReceipt,
  SocialGenerationRun,
  SocialPostDraft,
  SocialPromptVersion,
  SocialResearchObservation,
  SocialResearchSource,
  SocialAsset,
  SocialAudioTrack,
  SocialAuditLog,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSettings(base, overrides) {
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides === undefined ? base : overrides;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key])
      ? mergeSettings(base[key], value)
      : value;
  }
  return result;
}

function buildSocialGrowthSettings(current = {}, deploymentDefaults = getSocialManagerDefaults()) {
  const merged = mergeSettings(deploymentDefaults, isPlainObject(current) ? current : {});
  return socialManagerSettingsPersistence({
    ...merged,
    settings_version: 3,
    generation: {
      ...merged.generation,
      full_ai_generation: true,
      allow_deterministic_content_fallback: false,
      allow_template_only_visual_fallback: false,
      fallback_mode: "DISABLED",
    },
    models: {
      ...merged.models,
      text_provider: "openai",
      image_provider: "openai",
      image_model: deploymentDefaults.models.image_model,
    },
    weekly_planning: {
      ...deploymentDefaults.weekly_planning,
      ...(isPlainObject(merged.weekly_planning) ? merged.weekly_planning : {}),
    },
    approval: {
      ...merged.approval,
      require_human_approval: true,
    },
    analytics: {
      ...deploymentDefaults.analytics,
      ...(isPlainObject(merged.analytics) ? merged.analytics : {}),
      aggregate_only_for_ai: true,
    },
    community: {
      ...deploymentDefaults.community,
      ...(isPlainObject(merged.community) ? merged.community : {}),
      require_human_approval: true,
      sensitive_requires_escalation: true,
      aggregate_only_for_planning: true,
    },
  });
}

async function seedSettings({ AdminSettingsModel = AdminSettings } = {}) {
  const deploymentDefaults = getSocialManagerDefaults();
  const existing = await AdminSettingsModel.findOne({ key: SOCIAL_MANAGER_SETTINGS_KEY })
    .select("_id social_manager_settings")
    .lean();
  const currentSettings = existing?.social_manager_settings || {};
  const upgradingToWeeklyV3 = Number(currentSettings.settings_version || 0) < 3;
  const migrationInput = upgradingToWeeklyV3
    ? {
      ...currentSettings,
      daily_generation: {
        ...(currentSettings.daily_generation || {}),
        enabled: false,
      },
    }
    : currentSettings;
  const migrated = buildSocialGrowthSettings(migrationInput, deploymentDefaults);

  if (!existing) {
    await AdminSettingsModel.create({
      key: SOCIAL_MANAGER_SETTINGS_KEY,
      social_manager_settings: migrated,
    });
    return "created_v3";
  }
  if (JSON.stringify(existing.social_manager_settings || null) === JSON.stringify(migrated)) {
    return "preserved_existing_v3";
  }
  await AdminSettingsModel.updateOne(
    { _id: existing._id },
    { $set: { social_manager_settings: migrated } }
  );
  return existing.social_manager_settings == null ? "initialized_v3" : "migrated_to_v3";
}

function configured(...names) {
  return names.every((name) => Boolean(String(process.env[name] || "").trim()));
}

function anyConfigured(...names) {
  return names.some((name) => Boolean(String(process.env[name] || "").trim()));
}

function connectionSeeds() {
  const openAiConfigured = configured("OPENAI_API_KEY");
  const instagramConfigured = configured("INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_REDIRECT_URI");
  const metaConfigured = anyConfigured("META_APP_ID", "INSTAGRAM_APP_ID")
    && anyConfigured("META_APP_SECRET", "INSTAGRAM_APP_SECRET")
    && anyConfigured("META_WEBHOOK_VERIFY_TOKEN", "INSTAGRAM_WEBHOOK_VERIFY_TOKEN");
  const googleCredentialConfigured = configured("GOOGLE_SERVICE_ACCOUNT_JSON")
    || configured("GOOGLE_APPLICATION_CREDENTIALS");
  const ga4Configured = configured("GA4_PROPERTY_ID") && googleCredentialConfigured;
  const searchConsoleConfigured = configured("GOOGLE_SEARCH_CONSOLE_SITE") && googleCredentialConfigured;
  const n8nConfigured = configured("N8N_SOCIAL_WEBHOOK_URL", "N8N_SOCIAL_WEBHOOK_SECRET");

  const seed = ({
    connectionKey,
    provider,
    displayName,
    isConfigured,
    capabilities,
    setupRequirements = [],
    accountSummary = null,
    configurationSource = null,
  }) => ({
    connection_key: connectionKey,
    provider,
    display_name: displayName,
    status: isConfigured ? "PENDING" : "NOT_CONFIGURED",
    configuration_source: isConfigured ? (configurationSource || "ENVIRONMENT") : "NONE",
    configured: isConfigured,
    capabilities,
    setup_requirements: isConfigured ? [] : setupRequirements,
    account_summary: accountSummary,
    limitations: [],
    connection_version: 1,
  });

  return [
    seed({
      connectionKey: "openai:primary",
      provider: "OPENAI",
      displayName: "OpenAI text and image generation",
      isConfigured: openAiConfigured,
      capabilities: ["AI_TEXT", "AI_STRUCTURED_OUTPUT", "AI_WEB_RESEARCH", "AI_IMAGE"],
      setupRequirements: ["Configure OPENAI_API_KEY"],
    }),
    seed({
      connectionKey: "instagram:publishing",
      provider: "INSTAGRAM",
      displayName: "Instagram publishing",
      isConfigured: instagramConfigured,
      capabilities: ["OAUTH", "MEDIA_PUBLISHING"],
      setupRequirements: ["Configure Instagram app ID, app secret, and redirect URI"],
    }),
    seed({
      connectionKey: "meta:webhooks",
      provider: "META",
      displayName: "Meta webhooks and community",
      isConfigured: metaConfigured,
      capabilities: ["WEBHOOKS", "COMMENTS", "MENTIONS", "MESSAGING"],
      setupRequirements: ["Configure Meta app credentials and webhook verification"],
    }),
    seed({
      connectionKey: "ga4:primary",
      provider: "GA4",
      displayName: "Google Analytics 4",
      isConfigured: ga4Configured,
      capabilities: ["SITE_ANALYTICS", "CONVERSION_ANALYTICS"],
      setupRequirements: ["Configure GA4 property and Google service-account credentials"],
      accountSummary: process.env.GA4_PROPERTY_ID
        ? { property_id: String(process.env.GA4_PROPERTY_ID).trim() }
        : null,
    }),
    seed({
      connectionKey: "search_console:primary",
      provider: "SEARCH_CONSOLE",
      displayName: "Google Search Console",
      isConfigured: searchConsoleConfigured,
      capabilities: ["SEARCH_ANALYTICS"],
      setupRequirements: ["Configure Search Console site and Google service-account credentials"],
      accountSummary: process.env.GOOGLE_SEARCH_CONSOLE_SITE
        ? { site_url: String(process.env.GOOGLE_SEARCH_CONSOLE_SITE).trim() }
        : null,
    }),
    seed({
      connectionKey: "n8n:social",
      provider: "N8N",
      displayName: "n8n social orchestration",
      isConfigured: n8nConfigured,
      capabilities: ["WORKFLOW_TRIGGER", "SIGNED_WEBHOOK"],
      setupRequirements: ["Configure n8n social webhook URL and signing secret"],
    }),
    seed({
      connectionKey: "research:primary",
      provider: "RESEARCH",
      displayName: "Approved research sources",
      isConfigured: true,
      capabilities: ["OPENAI_WEB_RESEARCH", "TRUSTED_RSS"],
      configurationSource: "ADMIN_CONFIG",
    }),
  ];
}

async function seedConnectionHealth({ ConnectionModel = SocialConnectionHealth } = {}) {
  const results = [];
  for (const connection of connectionSeeds()) {
    const result = await ConnectionModel.updateOne(
      { provider: connection.provider },
      { $setOnInsert: connection },
      { upsert: true, runValidators: true }
    );
    results.push({
      connection_key: connection.connection_key,
      action: result.upsertedCount ? "created" : "preserved",
    });
  }
  return results;
}

async function backfillLegacySocialAssets({ AssetModel = SocialAsset } = {}) {
  const mediaKind = await AssetModel.updateMany(
    { media_kind: { $exists: false } },
    { $set: { media_kind: "IMAGE" } }
  );
  const reelCovers = await AssetModel.updateMany(
    { publication_role: { $exists: false }, asset_type: "reel_cover" },
    { $set: { publication_role: "COVER" } }
  );
  const primaryImages = await AssetModel.updateMany(
    { publication_role: { $exists: false } },
    { $set: { publication_role: "PRIMARY_MEDIA" } }
  );
  return {
    image_media_kind: mediaKind.modifiedCount || 0,
    reel_covers: reelCovers.modifiedCount || 0,
    primary_images: primaryImages.modifiedCount || 0,
  };
}

async function ensureIndexes(models = INDEX_MODELS) {
  const results = [];
  for (const Model of models) {
    await Model.createIndexes();
    results.push(Model.modelName);
  }
  return results;
}

async function validateResearchSourceOwnership({ ResearchSourceModel = SocialResearchSource } = {}) {
  const invalidCount = await ResearchSourceModel.countDocuments({
    $or: [
      { generation_run_id: null, weekly_plan_id: null },
      { generation_run_id: { $ne: null }, weekly_plan_id: { $ne: null } },
    ],
  });
  if (invalidCount > 0) {
    throw new Error(
      `Cannot migrate social research ownership: ${invalidCount} rows do not have exactly one generation_run_id or weekly_plan_id`
    );
  }
  return { invalid_rows: 0 };
}

async function seedGrowthPromptVersions({ ensure = ensurePromptVersions } = {}) {
  const stages = [
    "weekly_research",
    "audience_intelligence",
    "weekly_candidates",
    "weekly_plan",
    "supervisor",
    "growth_analytics",
    "community_reply",
  ];
  const promptRuns = stages.map((stage) => ({
    stage,
    provider: "openai",
    model: process.env.OPENAI_SOCIAL_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
    prompt_version: openAiSocialProvider.SOCIAL_PROMPTS[stage].version,
    usage: {},
  }));
  const rows = await ensure({ promptRuns, actor: null, dependencies: { SocialPromptVersion } });
  if (rows.length !== stages.length) {
    throw new Error(`Expected ${stages.length} growth prompt versions but persisted ${rows.length}`);
  }
  return rows.map((row) => ({
    stage: row.document.stage,
    version_key: row.document.version_key,
    runtime_prompt_version: row.document.runtime_prompt_version,
  }));
}

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/pinkpaisa";
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });

  const researchOwnership = await validateResearchSourceOwnership();
  const assetBackfill = await backfillLegacySocialAssets();
  const indexes = await ensureIndexes();
  const settings = await seedSettings();
  const promptVersions = await seedGrowthPromptVersions();
  const connections = await seedConnectionHealth();
  const summary = {
    migration: "social-growth-team-v3",
    settings_version: 3,
    indexes_created_or_verified: indexes,
    research_source_ownership: researchOwnership,
    asset_backfill: assetBackfill,
    settings,
    prompt_versions: promptVersions,
    connections,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  INDEX_MODELS,
  backfillLegacySocialAssets,
  buildSocialGrowthSettings,
  connectionSeeds,
  ensureIndexes,
  main,
  mergeSettings,
  seedConnectionHealth,
  seedGrowthPromptVersions,
  seedSettings,
  validateResearchSourceOwnership,
};
