const crypto = require("crypto");
const fs = require("fs");
const mongoose = require("mongoose");

const MarketingAsset = require("../../models/MarketingAsset");
const SocialAsset = require("../../models/SocialAsset");
const SocialAuditLog = require("../../models/SocialAuditLog");
const SocialGenerationRun = require("../../models/SocialGenerationRun");
const SocialGenerationUsageLedger = require("../../models/SocialGenerationUsageLedger");
const SocialPaidCallUsageLedger = require("../../models/SocialPaidCallUsageLedger");
const SocialPaidOperation = require("../../models/SocialPaidOperation");
const SocialManualAction = require("../../models/SocialManualAction");
const SocialPostDraft = require("../../models/SocialPostDraft");
const SocialPublication = require("../../models/SocialPublication");
const SocialResearchSource = require("../../models/SocialResearchSource");
const SocialWeeklyPlan = require("../../models/SocialWeeklyPlan");
const {
  deleteCampaignAsset,
  getGeneratedCampaignAssetReference,
  listGeneratedCampaignAssets,
} = require("../campaignAssetStorage");

const CONFIRMATION_PHRASE = "DELETE ALL GENERATED CONTENT";
const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ORPHAN_FILE_MIN_AGE_MS = 60 * 60 * 1000;
const MIN_ORPHAN_FILE_AGE_MS = 5 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set(["PENDING", "RUNNING"]);
const ACTIVE_WEEKLY_PLAN_STATUSES = new Set(["QUEUED", "RESEARCHING", "PLANNING"]);
const ACTIVE_PUBLICATION_STATUSES = new Set([
  "QUEUED",
  "VALIDATING",
  "CONTAINER_CREATED",
  "PUBLISHING",
  "UNCERTAIN",
]);

function cleanupError(message, code, statusCode = 409, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function id(value) {
  const candidate = value?._id ?? value;
  return candidate == null ? "" : String(candidate);
}

function ids(values = []) {
  return (Array.isArray(values) ? values : []).map(id).filter(Boolean);
}

function add(set, value) {
  const normalized = id(value);
  if (!normalized || set.has(normalized)) return false;
  set.add(normalized);
  return true;
}

function plain(value) {
  return value?.toObject ? value.toObject() : value;
}

function applySession(query, session) {
  return session && query && typeof query.session === "function" ? query.session(session) : query;
}

async function findMany(Model, filter = {}, session = null) {
  return (await applySession(Model.find(filter), session) || []).map(plain);
}

async function findOne(Model, filter = {}, session = null) {
  return plain(await applySession(Model.findOne(filter), session));
}

async function countDocuments(Model, filter = {}, session = null) {
  return Number(await applySession(Model.countDocuments(filter), session) || 0);
}

async function deleteMany(Model, objectIds, session = null) {
  if (!objectIds.length) return 0;
  const result = await applySession(Model.deleteMany({ _id: { $in: objectIds } }), session);
  return Number(result?.deletedCount || 0);
}

async function createOne(Model, payload, session = null) {
  if (session) {
    const created = await Model.create([payload], { session });
    return Array.isArray(created) ? created[0] : created;
  }
  return Model.create(payload);
}

async function runTransaction(dependencies, work) {
  const startSession = dependencies.startSession
    || (mongoose.connection?.readyState === 1 && typeof mongoose.startSession === "function"
      ? () => mongoose.startSession()
      : null);
  if (!startSession) return work(null);
  const session = await startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

function models(dependencies = {}) {
  return {
    MarketingAsset: dependencies.MarketingAsset || MarketingAsset,
    SocialAsset: dependencies.SocialAsset || SocialAsset,
    SocialAuditLog: dependencies.SocialAuditLog || SocialAuditLog,
    SocialGenerationRun: dependencies.SocialGenerationRun || SocialGenerationRun,
    SocialGenerationUsageLedger: dependencies.SocialGenerationUsageLedger || SocialGenerationUsageLedger,
    SocialPaidCallUsageLedger: dependencies.SocialPaidCallUsageLedger || SocialPaidCallUsageLedger,
    SocialPaidOperation: dependencies.SocialPaidOperation || SocialPaidOperation,
    SocialManualAction: dependencies.SocialManualAction || SocialManualAction,
    SocialPostDraft: dependencies.SocialPostDraft || SocialPostDraft,
    SocialPublication: dependencies.SocialPublication || SocialPublication,
    SocialResearchSource: dependencies.SocialResearchSource || SocialResearchSource,
    SocialWeeklyPlan: dependencies.SocialWeeklyPlan || SocialWeeklyPlan,
  };
}

function storageKeyFromReference(value, dependencies = {}) {
  const resolver = dependencies.getGeneratedCampaignAssetReference || getGeneratedCampaignAssetReference;
  try {
    return resolver(String(value || ""))?.storageKey || "";
  } catch (_error) {
    return "";
  }
}

function assetFileReferences(asset, dependencies = {}) {
  const provenance = asset.provenance || {};
  const baseImage = provenance.base_image || {};
  const references = [
    { storage_key: asset.storage_key, file_size_bytes: asset.file_size_bytes },
    { storage_key: asset.original_visual?.storage_key, file_size_bytes: asset.original_visual?.file_size_bytes },
    { storage_key: asset.provider_original?.storage_key, file_size_bytes: asset.provider_original?.file_size_bytes },
    { storage_key: asset.normalization?.output_storage_key },
    { storage_key: provenance.provider_original?.storage_key, file_size_bytes: provenance.provider_original?.file_size_bytes },
    { storage_key: provenance.normalization?.output_storage_key },
    { storage_key: provenance.ai_background?.storage_key, file_size_bytes: provenance.ai_background?.file_size_bytes },
    { storage_key: provenance.authentic_product_reference?.storage_key, file_size_bytes: provenance.authentic_product_reference?.file_size_bytes },
    { storage_key: baseImage.storage_key, file_size_bytes: baseImage.file_size_bytes },
    { storage_key: baseImage.provider_original?.storage_key, file_size_bytes: baseImage.provider_original?.file_size_bytes },
    { storage_key: baseImage.normalization?.output_storage_key },
    { storage_key: baseImage.ai_background?.storage_key, file_size_bytes: baseImage.ai_background?.file_size_bytes },
    { storage_key: baseImage.authentic_product_reference?.storage_key, file_size_bytes: baseImage.authentic_product_reference?.file_size_bytes },
    ...(Array.isArray(asset.reference_assets) ? asset.reference_assets.map((reference) => ({
      storage_key: reference?.storage_key,
      file_size_bytes: reference?.file_size_bytes,
    })) : []),
  ];
  return references
    .map((reference) => ({
      storage_key: storageKeyFromReference(reference.storage_key, dependencies),
      file_size_bytes: Number(reference.file_size_bytes || 0),
    }))
    .filter((reference) => reference.storage_key);
}

function runFileReferences(run, dependencies = {}) {
  return (Array.isArray(run.image_generation_attempts) ? run.image_generation_attempts : [])
    .map((attempt) => ({
      storage_key: storageKeyFromReference(attempt?.original_storage_key || attempt?.original_asset_url, dependencies),
      file_size_bytes: Number(attempt?.original_file_size_bytes || 0),
    }))
    .filter((reference) => reference.storage_key);
}

function marketingFileReferences(asset, dependencies = {}) {
  return [asset.storage_key, asset.url, asset.source_url]
    .map((value) => storageKeyFromReference(value, dependencies))
    .filter(Boolean);
}

const USAGE_FIELDS = [
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "input_image_tokens",
  "output_image_tokens",
  "estimated_cost",
];

function nonnegativeNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Math.max(numeric, 0) : 0;
}

function roundedUsd(value) {
  return Number(nonnegativeNumber(value).toFixed(6));
}

function normalizedUsage(value = {}) {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, nonnegativeNumber(value?.[field])]));
}

function usageFromStage(value = {}) {
  return normalizedUsage({
    input_tokens: value?.input_tokens,
    output_tokens: value?.output_tokens,
    total_tokens: value?.total_tokens,
    input_image_tokens: value?.input_image_tokens,
    output_image_tokens: value?.output_image_tokens,
    estimated_cost: value?.estimated_cost,
  });
}

function addUsage(...values) {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [
    field,
    values.reduce((total, value) => total + nonnegativeNumber(value?.[field]), 0),
  ]));
}

function maxUsage(...values) {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [
    field,
    Math.max(...values.map((value) => nonnegativeNumber(value?.[field])), 0),
  ]));
}

function sumUsage(values = [], getter = (value) => value) {
  return values.reduce((total, value) => addUsage(total, normalizedUsage(getter(value))), normalizedUsage());
}

function estimatedTextCost(usage, dependencies = {}) {
  const inputRate = nonnegativeNumber(
    dependencies.textInputUsdPerMillion ?? process.env.SOCIAL_MANAGER_OPENAI_INPUT_USD_PER_MILLION,
  );
  const outputRate = nonnegativeNumber(
    dependencies.textOutputUsdPerMillion ?? process.env.SOCIAL_MANAGER_OPENAI_OUTPUT_USD_PER_MILLION,
  );
  return roundedUsd(
    nonnegativeNumber(usage?.input_tokens) * inputRate / 1_000_000
      + nonnegativeNumber(usage?.output_tokens) * outputRate / 1_000_000,
  );
}

function billableImageAsset(asset = {}) {
  return ["ORIGINAL_AI_VISUAL", "GENERATED_FRAME"].includes(String(asset.asset_role || "").toUpperCase());
}

function usageAssetIdentity(asset = {}) {
  return String(
    asset.provider_response_id
      || asset.checksum_sha256
      || asset.storage_key
      || asset.url
      || asset._id
      || "",
  );
}

function uniqueUsageAssets(assets = []) {
  const rows = new Map();
  for (const asset of assets.filter(billableImageAsset)) {
    const identity = usageAssetIdentity(asset);
    if (!identity) continue;
    const prior = rows.get(identity);
    if (!prior || nonnegativeNumber(asset.image_estimated_cost) > nonnegativeNumber(prior.image_estimated_cost)) {
      rows.set(identity, asset);
    }
  }
  return Array.from(rows.values());
}

function terminalRunBoundary(run = {}) {
  const value = run.finished_at || run.completed_at || null;
  if (!value) return null;
  const boundary = new Date(value);
  return Number.isNaN(boundary.getTime()) ? null : boundary;
}

function splitRunAssets(run, assets = [], paidCallLedgers = []) {
  const boundary = terminalRunBoundary(run);
  const runAssets = uniqueUsageAssets(assets.filter((asset) => id(asset.generation_run_id) === id(run._id)));
  const paidCallIds = new Set(paidCallLedgers
    .filter((entry) => id(entry.generation_run_id) === id(run._id))
    .map((entry) => String(entry.evidence?.paid_call_id || "").trim())
    .filter(Boolean));
  return runAssets.reduce((result, asset) => {
    const createdAt = asset.created_at ? new Date(asset.created_at) : null;
    const paidRegeneration = paidCallIds.has(String(asset.provenance?.paid_call_id || "").trim());
    const postRun = boundary
      && createdAt
      && !Number.isNaN(createdAt.getTime())
      && createdAt.getTime() > boundary.getTime();
    result[paidRegeneration || postRun ? "regeneration" : "initial"].push(asset);
    return result;
  }, { initial: [], regeneration: [] });
}

function orphanFileMinAgeMs(dependencies = {}) {
  const configured = Number(
    dependencies.orphanFileMinAgeMs
      ?? process.env.SOCIAL_GENERATED_ORPHAN_MIN_AGE_MS
      ?? DEFAULT_ORPHAN_FILE_MIN_AGE_MS,
  );
  if (!Number.isFinite(configured)) return DEFAULT_ORPHAN_FILE_MIN_AGE_MS;
  return Math.max(configured, MIN_ORPHAN_FILE_AGE_MS);
}

function paidCallFileReferences(entry, dependencies = {}) {
  const references = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["storage_key", "output_storage_key"].includes(key) && typeof child === "string") {
        references.push({ storage_key: child, file_size_bytes: value.file_size_bytes });
      } else {
        visit(child, depth + 1);
      }
    }
  };
  visit(entry?.evidence?.completed_visuals);
  visit(entry?.evidence?.staged_files);
  visit(entry?.evidence?.failures);
  return references
    .map((reference) => ({
      storage_key: storageKeyFromReference(reference.storage_key, dependencies),
      file_size_bytes: Number(reference.file_size_bytes || 0),
    }))
    .filter((reference) => reference.storage_key);
}

function subtractUsageFloor(left = {}, right = {}) {
  const result = normalizedUsage();
  for (const field of USAGE_FIELDS) {
    result[field] = Math.max(nonnegativeNumber(left?.[field]) - nonnegativeNumber(right?.[field]), 0);
  }
  result.estimated_cost = roundedUsd(result.estimated_cost);
  return result;
}

function promptRevisionIdentity(revision = {}) {
  const value = revision.provider_response_id
    || revision.response_id
    || revision.output_fingerprint
    || revision.input_fingerprint
    || "";
  return String(value).trim();
}

function promptRevisionPositions({ assetIndex = null, slideNumber = null, attemptNumber = 1 } = {}) {
  const positions = [];
  const attempt = Math.max(Math.floor(nonnegativeNumber(attemptNumber || 1)), 1);
  if (assetIndex != null && Number.isFinite(Number(assetIndex))) {
    positions.push(`index:${Math.max(Math.floor(Number(assetIndex)), 0)}:attempt:${attempt}`);
  }
  if (slideNumber != null && Number.isFinite(Number(slideNumber))) {
    positions.push(`slide:${Math.max(Math.floor(Number(slideNumber)), 1)}:attempt:${attempt}`);
  }
  return positions;
}

function unrepresentedPromptRevisionFailures(run = {}, attempts = [], failures = []) {
  const representedIdentities = new Set();
  const representedPositions = new Set();
  for (const attempt of attempts) {
    if (!attempt?.prompt_revision) continue;
    const identity = promptRevisionIdentity(attempt.prompt_revision);
    if (identity) representedIdentities.add(identity);
    for (const position of promptRevisionPositions({
      assetIndex: attempt.asset_index,
      slideNumber: attempt.slide_number,
      attemptNumber: attempt.attempt_number,
    })) representedPositions.add(position);
  }

  const sequence = Math.max(Math.floor(nonnegativeNumber(
    run.last_error?.details?.image_generation?.sequence || 1,
  )), 1);
  return failures.filter((failure, index) => {
    const revision = failure?.prompt_revision;
    if (revision?.status !== "COMPLETED") return false;
    const identity = promptRevisionIdentity(revision);
    if (identity && representedIdentities.has(identity)) return false;
    const positions = promptRevisionPositions({
      assetIndex: sequence - 1,
      slideNumber: sequence,
      attemptNumber: failure.attempt || index + 1,
    });
    return !positions.some((position) => representedPositions.has(position));
  });
}

function imageAttemptEvidence(run, initialAssets, stageUsage, dependencies = {}) {
  const attempts = Array.isArray(run.image_generation_attempts) ? run.image_generation_attempts : [];
  const uniqueAttempts = new Map();
  const attemptMaxByAsset = new Map();
  const successByAsset = new Set();
  let explicitFailedAttempts = 0;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index] || {};
    const assetKey = String(attempt.asset_index ?? attempt.slide_number ?? "unknown");
    const attemptNumber = Math.max(Math.floor(nonnegativeNumber(attempt.attempt_number || 1)), 1);
    const identity = `${assetKey}:${attemptNumber}`;
    const prior = uniqueAttempts.get(identity);
    if (!prior) uniqueAttempts.set(identity, attempt);
    else if (nonnegativeNumber(attempt.usage?.estimated_cost) > nonnegativeNumber(prior.usage?.estimated_cost)) {
      uniqueAttempts.set(identity, attempt);
    }
    attemptMaxByAsset.set(assetKey, Math.max(attemptMaxByAsset.get(assetKey) || 0, attemptNumber));
    const status = String(attempt.status || "").toUpperCase();
    if (["GENERATED", "VALIDATED"].includes(status)) successByAsset.add(assetKey);
    if (status === "FAILED") explicitFailedAttempts += 1;
  }
  const inferredRowAttempts = Array.from(attemptMaxByAsset.values()).reduce((total, value) => total + value, 0);
  const inferredRowFailures = Array.from(attemptMaxByAsset.entries()).reduce((total, [assetKey, value]) => (
    total + Math.max(value - (successByAsset.has(assetKey) ? 1 : 0), 0)
  ), 0);
  const lastErrorFailures = Array.isArray(run.last_error?.details?.image_generation?.failures)
    ? run.last_error.details.image_generation.failures
    : [];
  const assetAttemptCount = initialAssets.reduce(
    (total, asset) => total + Math.max(Math.floor(nonnegativeNumber(asset.image_retry_number)) + 1, 1),
    0,
  );
  const assetFailedAttemptCount = initialAssets.reduce(
    (total, asset) => total + Math.floor(nonnegativeNumber(asset.image_retry_number)),
    0,
  );
  const successCount = Math.max(successByAsset.size, initialAssets.length);
  const failedAttemptCount = Math.max(
    explicitFailedAttempts,
    inferredRowFailures,
    lastErrorFailures.length,
    assetFailedAttemptCount,
  );
  const attemptCount = Math.max(
    uniqueAttempts.size,
    inferredRowAttempts,
    lastErrorFailures.length,
    assetAttemptCount,
    successCount + failedAttemptCount,
  );
  const attemptUsage = sumUsage(Array.from(uniqueAttempts.values()), (attempt) => attempt.usage || {});
  const initialAssetUsage = sumUsage(initialAssets, (asset) => asset.image_usage || {});
  // New runs persist prompt-revision usage in the corresponding attempt row as
  // well as in last_error evidence. Only add the latter when a legacy/incomplete
  // attempt row did not already account for that paid call.
  const failedPromptRevisionUsage = sumUsage(
    unrepresentedPromptRevisionFailures(run, attempts, lastErrorFailures),
    (failure) => failure.prompt_revision.usage || {},
  );
  failedPromptRevisionUsage.estimated_cost = Math.max(
    failedPromptRevisionUsage.estimated_cost,
    estimatedTextCost(failedPromptRevisionUsage, dependencies),
  );
  const recordedAttemptCost = roundedUsd(attemptUsage.estimated_cost);
  const initialAssetCost = roundedUsd(initialAssets.reduce(
    (total, asset) => total + nonnegativeNumber(asset.image_estimated_cost),
    0,
  ));
  const configuredUnitCost = nonnegativeNumber(
    dependencies.imageUnitCostUsd ?? process.env.SOCIAL_MANAGER_OPENAI_IMAGE_USD_PER_IMAGE,
  );
  const assetUnitCost = initialAssets.reduce(
    (maximum, asset) => Math.max(maximum, nonnegativeNumber(asset.image_estimated_cost)),
    0,
  );
  const runUsage = normalizedUsage(run.usage || {});
  const residualRunImageCost = (stageUsage.estimated_cost > 0 || (
    runUsage.input_tokens === 0 && runUsage.output_tokens === 0
  )) && successCount > 0
    ? Math.max(runUsage.estimated_cost - stageUsage.estimated_cost, 0) / successCount
    : 0;
  const inferredUnitCost = roundedUsd(Math.max(configuredUnitCost, assetUnitCost, residualRunImageCost));
  // The run total and persisted originals already include successful calls. Count the
  // strongest per-attempt evidence once so failed/retried calls cannot disappear.
  const estimatedAttemptCost = roundedUsd(Math.max(
    recordedAttemptCost,
    initialAssetCost,
    inferredUnitCost * attemptCount,
  ));
  return {
    attempt_count: attemptCount,
    failed_attempt_count: failedAttemptCount,
    inferred_unit_cost: inferredUnitCost,
    recorded_cost: recordedAttemptCost,
    estimated_cost: estimatedAttemptCost,
    usage: maxUsage(attemptUsage, initialAssetUsage),
    failed_prompt_revision_usage: failedPromptRevisionUsage,
  };
}

function regenerationEvidence(run, assets, audits, paidCallLedgers = []) {
  const { regeneration } = splitRunAssets(run, assets, paidCallLedgers);
  const assetGroups = new Map();
  for (const asset of regeneration) {
    const groupKey = String(asset.asset_group_id || usageAssetIdentity(asset));
    if (!assetGroups.has(groupKey)) assetGroups.set(groupKey, []);
    assetGroups.get(groupKey).push(asset);
  }
  const groupUsages = Array.from(assetGroups.values()).map((rows) => {
    const usage = sumUsage(rows, (asset) => asset.image_usage || {});
    usage.estimated_cost = roundedUsd(rows.reduce(
      (total, asset) => total + nonnegativeNumber(asset.image_estimated_cost),
      0,
    ));
    return usage;
  });
  const assetUsage = groupUsages.reduce((total, usage) => addUsage(total, usage), normalizedUsage());
  const regenerationAudits = audits.filter((audit) => (
    id(audit.generation_run_id) === id(run._id)
      && String(audit.action || "").toUpperCase() === "AI_IMAGE_REGENERATED"
      && String(audit.action_status || "SUCCEEDED").toUpperCase() === "SUCCEEDED"
  ));
  const uniqueAudits = new Map();
  for (const audit of regenerationAudits) {
    const identity = id(audit._id) || String(audit.event_id || audit.idempotency_key || "");
    if (identity && !uniqueAudits.has(identity)) uniqueAudits.set(identity, audit);
  }
  const auditCost = roundedUsd(Array.from(uniqueAudits.values()).reduce(
    (total, audit) => total + nonnegativeNumber(audit.metadata?.image_cost),
    0,
  ));
  const assetCost = roundedUsd(assetUsage.estimated_cost);
  return {
    usage: assetUsage,
    audit_cost: auditCost,
    asset_cost: assetCost,
    // A successful regeneration is normally represented by both an audit and its
    // original asset group, so the stronger total is retained instead of summing both.
    estimated_cost: roundedUsd(Math.max(auditCost, assetCost)),
    audit_count: uniqueAudits.size,
    asset_group_count: assetGroups.size,
  };
}

function conservativeUsageForRun(run, {
  assets = [],
  audits = [],
  paidCallLedgers = [],
  dependencies = {},
} = {}) {
  const runUsage = normalizedUsage(run.usage || {});
  const stageUsage = sumUsage(Array.isArray(run.stage_executions) ? run.stage_executions : [], usageFromStage);
  const revisionUsage = sumUsage(
    Array.isArray(run.content_revision_attempts) ? run.content_revision_attempts : [],
    (attempt) => attempt.usage || {},
  );
  const textUsage = maxUsage(stageUsage, revisionUsage);
  const paidRegenerationRows = paidCallLedgers.filter((entry) => (
    id(entry.generation_run_id) === id(run._id)
      && String(entry.operation || "").toUpperCase() === "VISUAL_REGENERATION"
  ));
  const splitAssets = splitRunAssets(run, assets, paidRegenerationRows);
  const imageEvidence = imageAttemptEvidence(run, splitAssets.initial, stageUsage, dependencies);
  const evidenceUsage = addUsage(textUsage, imageEvidence.usage, imageEvidence.failed_prompt_revision_usage);
  const baseUsage = maxUsage(runUsage, evidenceUsage);
  // The run total overlaps its stage/asset evidence. Taking the maximum preserves
  // missing failed-attempt cost without charging the successful generation twice.
  const baseCost = roundedUsd(Math.max(
    runUsage.estimated_cost,
    textUsage.estimated_cost
      + imageEvidence.estimated_cost
      + imageEvidence.failed_prompt_revision_usage.estimated_cost,
  ));
  const regeneration = regenerationEvidence(run, assets, audits, paidRegenerationRows);
  const paidRegenerationUsage = sumUsage(paidRegenerationRows, (entry) => entry.usage || {});
  const residualRegenerationUsage = subtractUsageFloor(regeneration.usage, paidRegenerationUsage);
  const paidRegenerationCost = roundedUsd(paidRegenerationRows.reduce(
    (total, entry) => total + nonnegativeNumber(entry.usage?.estimated_cost),
    0,
  ));
  const residualRegenerationCost = roundedUsd(Math.max(
    regeneration.estimated_cost - paidRegenerationCost,
    0,
  ));
  const totalUsage = addUsage(baseUsage, residualRegenerationUsage);
  totalUsage.estimated_cost = roundedUsd(baseCost + residualRegenerationCost);
  const coveredRegenerationCount = paidRegenerationRows.filter((entry) => (
    String(entry.status || "").toUpperCase() === "SUCCEEDED"
  )).length;
  return {
    usage: {
      ...totalUsage,
      cost_currency: String(run.usage?.cost_currency || "USD").toUpperCase(),
    },
    cost_breakdown: {
      method: "CONSERVATIVE_EVIDENCE_V1",
      run_reported_cost: roundedUsd(runUsage.estimated_cost),
      stage_reported_cost: roundedUsd(stageUsage.estimated_cost),
      content_revision_reported_cost: roundedUsd(revisionUsage.estimated_cost),
      image_attempt_reported_cost: roundedUsd(imageEvidence.recorded_cost),
      image_attempt_estimated_cost: roundedUsd(imageEvidence.estimated_cost),
      base_generation_cost: baseCost,
      // Paid visual calls are retained in SocialPaidCallUsageLedger. Only a
      // residual from legacy evidence belongs in this cleanup snapshot.
      visual_regeneration_audit_cost: Math.min(regeneration.audit_cost, residualRegenerationCost),
      visual_regeneration_asset_cost: Math.min(regeneration.asset_cost, residualRegenerationCost),
      visual_regeneration_cost: residualRegenerationCost,
      total_estimated_cost: totalUsage.estimated_cost,
      inferred_image_unit_cost: imageEvidence.inferred_unit_cost,
      image_attempt_count: imageEvidence.attempt_count,
      failed_image_attempt_count: imageEvidence.failed_attempt_count,
      visual_regeneration_event_count: Math.max(regeneration.audit_count - coveredRegenerationCount, 0),
      visual_regeneration_asset_group_count: Math.max(regeneration.asset_group_count - coveredRegenerationCount, 0),
    },
  };
}

async function createUsageLedgers(Model, runs, cleanupIdempotencyKey, now, session = null, context = {}) {
  if (!runs.length) return 0;
  const rows = runs.map((run) => {
    const retainedUsage = conservativeUsageForRun(run, context);
    return {
      generation_run_id: run._id,
      generation_date: run.generation_date,
      incurred_at: run.created_at || run.queued_at || now,
      usage: retainedUsage.usage,
      cost_breakdown: retainedUsage.cost_breakdown,
      cleanup_idempotency_key: cleanupIdempotencyKey.slice(0, 200),
      recorded_at: now,
    };
  });
  const options = session ? { session, ordered: true } : { ordered: true };
  const result = await Model.insertMany(rows, options);
  return Array.isArray(result) ? result.length : rows.length;
}

function cleanupSecret(dependencies = {}) {
  const value = String(
    dependencies.tokenSecret
      || process.env.JWT_SECRET
      || process.env.SOCIAL_ORCHESTRATION_SHARED_SECRET
      || "",
  ).trim();
  if (value) return `pink-paisa-generated-content-cleanup:v1:${value}`;
  if (process.env.NODE_ENV !== "production") return "pink-paisa-generated-content-cleanup:v1:local-development-only";
  throw cleanupError(
    "Generated-content cleanup is unavailable because its signing secret is not configured",
    "social_generated_content_cleanup_secret_missing",
    503,
  );
}

function signToken(payload, dependencies = {}) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", cleanupSecret(dependencies)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeToken(token, dependencies = {}) {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw cleanupError("Review the deletion scope again before confirming", "social_generated_content_cleanup_token_invalid", 400);
  }
  const expectedSignature = crypto.createHmac("sha256", cleanupSecret(dependencies)).update(encoded).digest();
  let actualSignature;
  try {
    actualSignature = Buffer.from(suppliedSignature, "base64url");
  } catch (_error) {
    actualSignature = Buffer.alloc(0);
  }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    throw cleanupError("Review the deletion scope again before confirming", "social_generated_content_cleanup_token_invalid", 400);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (_error) {
    throw cleanupError("Review the deletion scope again before confirming", "social_generated_content_cleanup_token_invalid", 400);
  }
  if (payload?.v !== TOKEN_VERSION || !payload?.fingerprint || !Number.isFinite(Number(payload?.expires_at))) {
    throw cleanupError("Review the deletion scope again before confirming", "social_generated_content_cleanup_token_invalid", 400);
  }
  return payload;
}

function fingerprintScope(scope) {
  const ordered = {
    drafts: [...scope.deletable.drafts].sort(),
    assets: [...scope.deletable.assets].sort(),
    generation_runs: [...scope.deletable.generation_runs].sort(),
    weekly_plans: [...scope.deletable.weekly_plans].sort(),
    research_sources: [...scope.deletable.research_sources].sort(),
    manual_actions: [...scope.deletable.manual_actions].sort(),
    local_file_keys: scope.local_file_targets.map((target) => target.storage_key).sort(),
    blockers: scope.blockers.map((blocker) => `${blocker.code}:${blocker.count}`).sort(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(ordered), "utf8").digest("hex");
}

async function buildCleanupScope({ session = null, dependencies = {}, now = new Date() } = {}) {
  const db = models(dependencies);
  const [
    drafts,
    assets,
    runs,
    plans,
    publications,
    sources,
    actions,
    marketingAssets,
    auditCount,
    usageLedgerCount,
    paidCallUsageLedgers,
    paidOperations,
  ] = await Promise.all([
    findMany(db.SocialPostDraft, {}, session),
    findMany(db.SocialAsset, {}, session),
    findMany(db.SocialGenerationRun, {}, session),
    findMany(db.SocialWeeklyPlan, {}, session),
    findMany(db.SocialPublication, {}, session),
    findMany(db.SocialResearchSource, {}, session),
    findMany(db.SocialManualAction, {}, session),
    findMany(db.MarketingAsset, {}, session),
    countDocuments(db.SocialAuditLog, {}, session),
    countDocuments(db.SocialGenerationUsageLedger, {}, session),
    findMany(db.SocialPaidCallUsageLedger, {}, session),
    findMany(db.SocialPaidOperation, {}, session),
  ]);
  const enumerateGeneratedAssets = dependencies.listGeneratedCampaignAssets || listGeneratedCampaignAssets;
  const orphanCutoff = new Date(now.getTime() - orphanFileMinAgeMs(dependencies));
  const storedCampaignAssets = await enumerateGeneratedAssets({ olderThan: orphanCutoff });

  const protectedDrafts = new Set();
  const protectedRuns = new Set();
  const protectedPlans = new Set();
  const protectedAssets = new Set();
  const protectedSources = new Set();
  const publicationIds = new Set(publications.map((publication) => id(publication._id)));

  // Dismissing a failure hides it from the operator queue; it does not waive
  // the paid-call, prompt, validation, source, or audit evidence attached to
  // that run. Seed archived failures into the protected graph so cleanup can
  // never make the archive audit's retention promise untrue.
  for (const run of runs) {
    if (run.recovery_archived_at) add(protectedRuns, run._id);
  }

  for (const publication of publications) {
    add(protectedDrafts, publication.draft_id);
    add(protectedRuns, publication.generation_run_id);
    ids(publication.asset_ids).forEach((assetId) => add(protectedAssets, assetId));
  }

  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const plan of plans) {
      const selected = Array.isArray(plan.selected_posts) ? plan.selected_posts : [];
      const planIsProtected = protectedPlans.has(id(plan._id)) || selected.some((item) => (
        publicationIds.has(id(item.publication_id))
        || protectedDrafts.has(id(item.draft_id))
        || protectedRuns.has(id(item.generation_run_id))
      ));
      if (!planIsProtected) continue;
      changed = add(protectedPlans, plan._id) || changed;
      changed = add(protectedRuns, plan.generation_run_id) || changed;
      ids(plan.research_source_ids).forEach((sourceId) => { changed = add(protectedSources, sourceId) || changed; });
      for (const item of selected) {
        changed = add(protectedDrafts, item.draft_id) || changed;
        changed = add(protectedRuns, item.generation_run_id) || changed;
      }
    }
    for (const draft of drafts) {
      if (!protectedDrafts.has(id(draft._id))
        && !protectedPlans.has(id(draft.weekly_plan_id))
        && !protectedRuns.has(id(draft.generation_run_id))) continue;
      changed = add(protectedDrafts, draft._id) || changed;
      changed = add(protectedRuns, draft.generation_run_id) || changed;
      changed = add(protectedPlans, draft.weekly_plan_id) || changed;
      ids(draft.asset_ids).forEach((assetId) => { changed = add(protectedAssets, assetId) || changed; });
      ids(draft.research_source_ids).forEach((sourceId) => { changed = add(protectedSources, sourceId) || changed; });
    }
    for (const run of runs) {
      if (!protectedRuns.has(id(run._id)) && !protectedPlans.has(id(run.weekly_plan_id))) continue;
      changed = add(protectedRuns, run._id) || changed;
      changed = add(protectedPlans, run.weekly_plan_id) || changed;
      changed = add(protectedDrafts, run.selected_draft_id) || changed;
      changed = add(protectedDrafts, run.failed_draft_id) || changed;
      ids(run.source_ids).forEach((sourceId) => { changed = add(protectedSources, sourceId) || changed; });
    }
    if (!changed) break;
  }

  for (const asset of assets) {
    if (protectedAssets.has(id(asset._id))
      || protectedDrafts.has(id(asset.draft_id))
      || protectedRuns.has(id(asset.generation_run_id))) {
      add(protectedAssets, asset._id);
    }
  }
  for (const source of sources) {
    if (protectedSources.has(id(source._id))
      || protectedDrafts.has(id(source.draft_id))
      || protectedRuns.has(id(source.generation_run_id))
      || protectedPlans.has(id(source.weekly_plan_id))) {
      add(protectedSources, source._id);
    }
  }

  const deletable = {
    drafts: drafts.map((item) => id(item._id)).filter((itemId) => !protectedDrafts.has(itemId)),
    assets: assets.map((item) => id(item._id)).filter((itemId) => !protectedAssets.has(itemId)),
    generation_runs: runs.map((item) => id(item._id)).filter((itemId) => !protectedRuns.has(itemId)),
    weekly_plans: plans.map((item) => id(item._id)).filter((itemId) => !protectedPlans.has(itemId)),
    research_sources: sources.map((item) => id(item._id)).filter((itemId) => !protectedSources.has(itemId)),
    manual_actions: [],
  };
  const deletableDraftSet = new Set(deletable.drafts);
  const deletableRunSet = new Set(deletable.generation_runs);
  const deletablePlanSet = new Set(deletable.weekly_plans);
  deletable.manual_actions = actions.filter((action) => {
    const linkedToDeletion = deletableDraftSet.has(id(action.draft_id))
      || deletableRunSet.has(id(action.generation_run_id))
      || deletablePlanSet.has(id(action.weekly_plan_id));
    const hasPreservedOwner = Boolean(action.publication_id || action.community_item_id || action.connection_health_id)
      || protectedDrafts.has(id(action.draft_id))
      || protectedRuns.has(id(action.generation_run_id))
      || protectedPlans.has(id(action.weekly_plan_id));
    return linkedToDeletion && !hasPreservedOwner;
  }).map((action) => id(action._id));

  const protectedStorageKeys = new Set();
  assets
    .filter((asset) => protectedAssets.has(id(asset._id)))
    .flatMap((asset) => assetFileReferences(asset, dependencies))
    .forEach((reference) => protectedStorageKeys.add(reference.storage_key));
  runs
    .filter((run) => protectedRuns.has(id(run._id)))
    .flatMap((run) => runFileReferences(run, dependencies))
    .forEach((reference) => protectedStorageKeys.add(reference.storage_key));
  paidCallUsageLedgers
    .filter((entry) => protectedRuns.has(id(entry.generation_run_id)))
    .flatMap((entry) => paidCallFileReferences(entry, dependencies))
    .forEach((reference) => protectedStorageKeys.add(reference.storage_key));
  publications
    .flatMap((publication) => Array.isArray(publication.asset_urls) ? publication.asset_urls : [])
    .map((value) => storageKeyFromReference(value, dependencies))
    .filter(Boolean)
    .forEach((storageKey) => protectedStorageKeys.add(storageKey));
  marketingAssets
    .flatMap((asset) => marketingFileReferences(asset, dependencies))
    .forEach((storageKey) => protectedStorageKeys.add(storageKey));
  const allReferencedStorageKeys = new Set();
  assets
    .flatMap((asset) => assetFileReferences(asset, dependencies))
    .forEach((reference) => allReferencedStorageKeys.add(reference.storage_key));
  runs
    .flatMap((run) => runFileReferences(run, dependencies))
    .forEach((reference) => allReferencedStorageKeys.add(reference.storage_key));
  paidCallUsageLedgers
    .flatMap((entry) => paidCallFileReferences(entry, dependencies))
    .forEach((reference) => allReferencedStorageKeys.add(reference.storage_key));
  publications
    .flatMap((publication) => Array.isArray(publication.asset_urls) ? publication.asset_urls : [])
    .map((value) => storageKeyFromReference(value, dependencies))
    .filter(Boolean)
    .forEach((storageKey) => allReferencedStorageKeys.add(storageKey));
  marketingAssets
    .flatMap((asset) => marketingFileReferences(asset, dependencies))
    .forEach((storageKey) => allReferencedStorageKeys.add(storageKey));
  const fileTargetMap = new Map();
  for (const asset of assets) {
    if (!deletable.assets.includes(id(asset._id))) continue;
    for (const reference of assetFileReferences(asset, dependencies)) {
      if (protectedStorageKeys.has(reference.storage_key) || fileTargetMap.has(reference.storage_key)) continue;
      fileTargetMap.set(reference.storage_key, { storage_provider: "local", ...reference });
    }
  }
  for (const run of runs) {
    if (!deletable.generation_runs.includes(id(run._id))) continue;
    for (const reference of runFileReferences(run, dependencies)) {
      if (protectedStorageKeys.has(reference.storage_key) || fileTargetMap.has(reference.storage_key)) continue;
      fileTargetMap.set(reference.storage_key, { storage_provider: "local", ...reference });
    }
  }
  for (const entry of paidCallUsageLedgers) {
    if (!deletable.generation_runs.includes(id(entry.generation_run_id))) continue;
    for (const reference of paidCallFileReferences(entry, dependencies)) {
      if (protectedStorageKeys.has(reference.storage_key) || fileTargetMap.has(reference.storage_key)) continue;
      fileTargetMap.set(reference.storage_key, { storage_provider: "local", ...reference });
    }
  }
  for (const storedAsset of Array.isArray(storedCampaignAssets) ? storedCampaignAssets : []) {
    const storageKey = storageKeyFromReference(storedAsset?.storage_key, dependencies);
    if (!storageKey || allReferencedStorageKeys.has(storageKey) || fileTargetMap.has(storageKey)) continue;
    fileTargetMap.set(storageKey, {
      storage_provider: "local",
      storage_key: storageKey,
      file_size_bytes: Number(storedAsset?.file_size_bytes || 0),
      modified_at: storedAsset?.modified_at || null,
      orphaned_unreferenced: true,
    });
  }

  const blockers = [];
  const activeRuns = runs.filter((run) => ACTIVE_RUN_STATUSES.has(String(run.status || "").toUpperCase()));
  if (activeRuns.length) blockers.push({
    code: "generation_in_progress",
    count: activeRuns.length,
    message: `${activeRuns.length} generation job${activeRuns.length === 1 ? " is" : "s are"} still running. Wait for completion before deleting generated content.`,
  });
  const activePlans = plans.filter((plan) => ACTIVE_WEEKLY_PLAN_STATUSES.has(String(plan.status || "").toUpperCase()));
  if (activePlans.length) blockers.push({
    code: "weekly_plan_in_progress",
    count: activePlans.length,
    message: `${activePlans.length} weekly plan${activePlans.length === 1 ? " is" : "s are"} still being researched or planned. Wait for completion before deleting generated content.`,
  });
  const activePublications = publications.filter((publication) => ACTIVE_PUBLICATION_STATUSES.has(String(publication.status || "").toUpperCase()));
  if (activePublications.length) blockers.push({
    code: "publication_in_progress",
    count: activePublications.length,
    message: `${activePublications.length} publication outcome${activePublications.length === 1 ? " is" : "s are"} still active or uncertain. Resolve it before cleanup.`,
  });
  const activePaidOperations = paidOperations.filter((operation) => (
    String(operation.status || "").toUpperCase() === "RUNNING"
      && new Date(operation.lease_expires_at || 0).getTime() > now.getTime()
  ));
  if (activePaidOperations.length) blockers.push({
    code: "paid_operation_in_progress",
    count: activePaidOperations.length,
    message: `${activePaidOperations.length} paid creative operation${activePaidOperations.length === 1 ? " is" : "s are"} still active. Wait for completion before deleting generated content.`,
  });
  const publishingDrafts = drafts.filter((draft) => String(draft.status || "").toUpperCase() === "PUBLISHING");
  if (publishingDrafts.length) blockers.push({
    code: "draft_publishing",
    count: publishingDrafts.length,
    message: `${publishingDrafts.length} draft${publishingDrafts.length === 1 ? " is" : "s are"} currently publishing.`,
  });
  const scheduledDrafts = drafts.filter((draft) => String(draft.status || "").toUpperCase() === "SCHEDULED");
  if (scheduledDrafts.length) blockers.push({
    code: "draft_scheduled",
    count: scheduledDrafts.length,
    message: `${scheduledDrafts.length} draft${scheduledDrafts.length === 1 ? " is" : "s are"} scheduled for automatic publishing. Unschedule or publish before deleting generated content.`,
  });

  const counts = Object.fromEntries(Object.entries(deletable).map(([key, value]) => [key, value.length]));
  const localFileTargets = Array.from(fileTargetMap.values()).sort((left, right) => left.storage_key.localeCompare(right.storage_key));
  const orphanLocalFileCount = localFileTargets.filter((target) => target.orphaned_unreferenced).length;
  const databaseTotalCount = Object.values(counts).reduce((total, value) => total + value, 0);
  const scope = {
    deletable,
    counts,
    total_count: databaseTotalCount + orphanLocalFileCount,
    local_file_targets: localFileTargets,
    local_files: {
      count: localFileTargets.length,
      bytes: localFileTargets.reduce((total, target) => total + target.file_size_bytes, 0),
      orphan_count: orphanLocalFileCount,
    },
    blockers,
    preserved: {
      publications: publications.length,
      drafts: protectedDrafts.size,
      assets: protectedAssets.size,
      generation_runs: protectedRuns.size,
      weekly_plans: protectedPlans.size,
      research_sources: protectedSources.size,
      audit_events: auditCount,
      generation_usage_ledgers: usageLedgerCount,
      paid_call_usage_ledgers: paidCallUsageLedgers.length,
      paid_operations: paidOperations.length,
    },
    exclusions: [
      "Published and in-flight Instagram publication records and their exact supporting drafts/assets",
      "Immutable audit history and performance evidence",
      "Archived generation failures and their retained paid-call evidence",
      "Append-only AI cost usage needed for the monthly budget control",
      "Social Manager settings, prompt versions, connection health and credentials",
      "Catalog products, affiliate products, orders, customers and users",
      "Community inbox events and the rights-cleared audio library",
      "Media already published on Instagram or stored by an external provider",
      `Unreferenced local files newer than ${Math.round(orphanFileMinAgeMs(dependencies) / 60000)} minutes, so in-flight storage writes remain untouched`,
    ],
  };
  scope.fingerprint = fingerprintScope(scope);
  return scope;
}

function publicPreview(scope, now, dependencies = {}) {
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  return {
    confirmation_phrase: CONFIRMATION_PHRASE,
    purge_token: signToken({
      v: TOKEN_VERSION,
      fingerprint: scope.fingerprint,
      issued_at: now.getTime(),
      expires_at: expiresAt.getTime(),
    }, dependencies),
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    counts: scope.counts,
    total_count: scope.total_count,
    local_files: scope.local_files,
    blockers: scope.blockers,
    preserved: scope.preserved,
    exclusions: scope.exclusions,
  };
}

async function previewGeneratedContentCleanup({ now = new Date(), dependencies = {} } = {}) {
  const scope = await buildCleanupScope({ dependencies, now });
  return publicPreview(scope, now, dependencies);
}

async function cleanupFiles(targets, dependencies = {}) {
  const removeAsset = dependencies.deleteCampaignAsset || deleteCampaignAsset;
  const resolveAsset = dependencies.getGeneratedCampaignAssetReference || getGeneratedCampaignAssetReference;
  const access = dependencies.accessFile || ((filePath) => fs.promises.access(filePath));
  const result = { requested: targets.length, deleted: 0, missing: 0, failed: 0, failures: [] };
  for (const target of targets) {
    try {
      const reference = resolveAsset(target.storage_key);
      if (!reference) throw new Error("The stored asset is outside the generated campaign directory");
      try {
        await access(reference.filePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          result.missing += 1;
          continue;
        }
        throw error;
      }
      await removeAsset(target);
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({ storage_key: target.storage_key, message: String(error?.message || "File cleanup failed").slice(0, 500) });
    }
  }
  return result;
}

async function sweepOrphanedGeneratedFiles({ now = new Date(), dependencies = {} } = {}) {
  const scope = await buildCleanupScope({ dependencies, now });
  const unsafeBlockers = scope.blockers.filter((blocker) => (
    blocker.code === "generation_in_progress" || blocker.code === "paid_operation_in_progress"
  ));
  if (unsafeBlockers.length) {
    return {
      skipped: "creative_work_in_progress",
      blockers: unsafeBlockers,
      orphan_files: 0,
      file_cleanup: { requested: 0, deleted: 0, missing: 0, failed: 0, failures: [] },
    };
  }

  const targets = scope.local_file_targets.filter((target) => target.orphaned_unreferenced);
  if (!targets.length) {
    return {
      skipped: "no_aged_orphans",
      blockers: [],
      orphan_files: 0,
      file_cleanup: { requested: 0, deleted: 0, missing: 0, failed: 0, failures: [] },
    };
  }

  const fileCleanup = await cleanupFiles(targets, dependencies);
  const db = models(dependencies);
  const audit = await createOne(db.SocialAuditLog, {
    entity_type: "CONTENT_CLEANUP",
    entity_id: new mongoose.Types.ObjectId(),
    action: "ORPHANED_GENERATED_FILES_CLEANED",
    action_status: fileCleanup.failed ? "FAILED" : "SUCCEEDED",
    actor_type: "WORKER",
    summary: fileCleanup.failed
      ? "The maintenance sweep found aged unreferenced generated files, but one or more files require attention."
      : `The maintenance sweep removed ${fileCleanup.deleted} aged local file${fileCleanup.deleted === 1 ? "" : "s"} with no database or paid-ledger reference.`,
    metadata: {
      cutoff_age_minutes: Math.round(orphanFileMinAgeMs(dependencies) / 60000),
      file_targets: targets,
      file_cleanup: fileCleanup,
      completed_at: now.toISOString(),
    },
  });
  return {
    skipped: null,
    blockers: [],
    orphan_files: targets.length,
    file_cleanup: fileCleanup,
    audit_event_id: id(audit?._id),
  };
}

function actorId(actor) {
  return actor?._id || actor?.id || null;
}

function cleanupAuditKey(requestKey, purgeToken) {
  const source = String(requestKey || purgeToken || "").trim();
  return `social-generated-content-cleanup:${crypto.createHash("sha256").update(source, "utf8").digest("hex")}`;
}

async function returnOrFinishReusedCleanup(existingAudit, db, dependencies, now) {
  const metadata = plain(existingAudit)?.metadata || {};
  const filesAuditKey = `${existingAudit.idempotency_key}:files`;
  const relatedFilesAudits = (await findMany(db.SocialAuditLog, {
    entity_type: "CONTENT_CLEANUP",
    entity_id: existingAudit.entity_id,
    action: "GENERATED_CONTENT_FILES_CLEANED",
  })).filter((audit) => {
    const key = String(audit?.idempotency_key || "");
    return key === filesAuditKey || key.startsWith(`${filesAuditKey}:retry:`);
  }).sort((left, right) => {
    const timeDifference = new Date(left?.created_at || 0).getTime() - new Date(right?.created_at || 0).getTime();
    return timeDifference || String(left?.idempotency_key || "").localeCompare(String(right?.idempotency_key || ""));
  });
  const existingFilesAudit = relatedFilesAudits.at(-1) || null;
  if (existingFilesAudit && String(existingFilesAudit.action_status || "").toUpperCase() !== "FAILED") {
    return {
      reused: true,
      deleted: metadata.deleted || {},
      total_deleted: Number(metadata.total_deleted || 0),
      usage_ledgers_created: Number(metadata.usage_ledgers_created || 0),
      file_cleanup: plain(existingFilesAudit)?.metadata?.file_cleanup || { requested: 0, deleted: 0, missing: 0, failed: 0, failures: [] },
      retained_audit_event_id: id(existingAudit._id),
      file_cleanup_audit_event_id: id(existingFilesAudit._id),
      completed_at: plain(existingFilesAudit)?.metadata?.completed_at || existingFilesAudit.created_at || now.toISOString(),
      exclusions: metadata.exclusions || [],
    };
  }
  const fileCleanup = await cleanupFiles(Array.isArray(metadata.file_targets) ? metadata.file_targets : [], dependencies);
  const nextFilesAuditKey = existingFilesAudit
    ? `${filesAuditKey}:retry:${relatedFilesAudits.length}`
    : filesAuditKey;
  const filesAudit = await createOne(db.SocialAuditLog, {
    idempotency_key: nextFilesAuditKey,
    entity_type: "CONTENT_CLEANUP",
    entity_id: existingAudit.entity_id,
    action: "GENERATED_CONTENT_FILES_CLEANED",
    action_status: fileCleanup.failed ? "FAILED" : "SUCCEEDED",
    actor_type: "ADMIN",
    actor_admin_id: existingAudit.actor_admin_id || null,
    summary: fileCleanup.failed
      ? "Generated-content database cleanup completed, but one or more local files require attention."
      : "Local files belonging only to deleted generated Social Manager content were removed.",
    metadata: { file_cleanup: fileCleanup, completed_at: now.toISOString() },
  });
  return {
    reused: true,
    deleted: metadata.deleted || {},
    total_deleted: Number(metadata.total_deleted || 0),
    usage_ledgers_created: Number(metadata.usage_ledgers_created || 0),
    file_cleanup: fileCleanup,
    retained_audit_event_id: id(existingAudit._id),
    file_cleanup_audit_event_id: id(filesAudit?._id),
    completed_at: now.toISOString(),
    exclusions: metadata.exclusions || [],
  };
}

async function deleteGeneratedContent({
  confirmation,
  purgeToken,
  actor = null,
  requestId = null,
  requestKey = null,
  now = new Date(),
  dependencies = {},
} = {}) {
  if (confirmation !== CONFIRMATION_PHRASE) {
    throw cleanupError(`Type ${CONFIRMATION_PHRASE} exactly to continue`, "social_generated_content_confirmation_invalid", 400);
  }
  const tokenPayload = decodeToken(purgeToken, dependencies);
  const db = models(dependencies);
  const auditKey = cleanupAuditKey(requestKey, purgeToken);
  const existingAudit = await findOne(db.SocialAuditLog, { idempotency_key: auditKey });
  if (existingAudit) return returnOrFinishReusedCleanup(existingAudit, db, dependencies, now);
  if (Number(tokenPayload.expires_at) < now.getTime()) {
    throw cleanupError("The cleanup review expired. Review the current deletion counts again.", "social_generated_content_cleanup_token_expired", 409);
  }

  const transactionResult = await runTransaction(dependencies, async (session) => {
    const scope = await buildCleanupScope({ session, dependencies, now });
    if (scope.fingerprint !== tokenPayload.fingerprint) {
      throw cleanupError("Generated content changed after the review. Review the deletion counts again.", "social_generated_content_cleanup_scope_changed", 409);
    }
    if (scope.blockers.length) {
      throw cleanupError("Generated content cannot be deleted while work is active", "social_generated_content_cleanup_blocked", 409, scope.blockers);
    }
    if (!scope.total_count) {
      throw cleanupError("There is no unpublished generated Social Manager content to delete", "social_generated_content_cleanup_empty", 409);
    }

    const runsForUsageLedger = await findMany(
      db.SocialGenerationRun,
      { _id: { $in: scope.deletable.generation_runs } },
      session,
    );
    const usageRunIds = runsForUsageLedger.map((run) => run._id);
    const [assetsForUsageLedger, auditsForUsageLedger, paidCallsForUsageLedger] = await Promise.all([
      usageRunIds.length
        ? findMany(db.SocialAsset, { generation_run_id: { $in: usageRunIds } }, session)
        : [],
      usageRunIds.length
        ? findMany(db.SocialAuditLog, { generation_run_id: { $in: usageRunIds } }, session)
        : [],
      usageRunIds.length
        ? findMany(db.SocialPaidCallUsageLedger, { generation_run_id: { $in: usageRunIds } }, session)
        : [],
    ]);
    const usageLedgersCreated = await createUsageLedgers(
      db.SocialGenerationUsageLedger,
      runsForUsageLedger,
      auditKey,
      now,
      session,
      {
        assets: assetsForUsageLedger,
        audits: auditsForUsageLedger,
        paidCallLedgers: paidCallsForUsageLedger,
        dependencies,
      },
    );
    const deleted = {
      manual_actions: await deleteMany(db.SocialManualAction, scope.deletable.manual_actions, session),
      research_sources: await deleteMany(db.SocialResearchSource, scope.deletable.research_sources, session),
      assets: await deleteMany(db.SocialAsset, scope.deletable.assets, session),
      drafts: await deleteMany(db.SocialPostDraft, scope.deletable.drafts, session),
      generation_runs: await deleteMany(db.SocialGenerationRun, scope.deletable.generation_runs, session),
      weekly_plans: await deleteMany(db.SocialWeeklyPlan, scope.deletable.weekly_plans, session),
    };
    const totalDeleted = Object.values(deleted).reduce((total, value) => total + Number(value || 0), 0);
    const cleanupEntityId = new mongoose.Types.ObjectId();
    const audit = await createOne(db.SocialAuditLog, {
      idempotency_key: auditKey,
      entity_type: "CONTENT_CLEANUP",
      entity_id: cleanupEntityId,
      action: "GENERATED_CONTENT_DELETED",
      action_status: "SUCCEEDED",
      actor_type: "ADMIN",
      actor_admin_id: actorId(actor),
      summary: `Deleted ${totalDeleted} unpublished generated Social Manager records after an administrator reviewed the exact scope.`,
      request_id: requestId,
      metadata: {
        deleted,
        total_deleted: totalDeleted,
        file_targets: scope.local_file_targets,
        exclusions: scope.exclusions,
        preserved: scope.preserved,
        usage_ledgers_created: usageLedgersCreated,
        preview_fingerprint: scope.fingerprint,
      },
    }, session);
    return { audit: plain(audit), deleted, totalDeleted, scope, usageLedgersCreated };
  });

  const fileCleanup = await cleanupFiles(transactionResult.scope.local_file_targets, dependencies);
  const filesAudit = await createOne(db.SocialAuditLog, {
    idempotency_key: `${auditKey}:files`,
    entity_type: "CONTENT_CLEANUP",
    entity_id: transactionResult.audit.entity_id,
    action: "GENERATED_CONTENT_FILES_CLEANED",
    action_status: fileCleanup.failed ? "FAILED" : "SUCCEEDED",
    actor_type: "ADMIN",
    actor_admin_id: actorId(actor),
    summary: fileCleanup.failed
      ? "Generated-content database cleanup completed, but one or more local files require attention."
      : "Local files belonging only to deleted generated Social Manager content were removed.",
    request_id: requestId,
    metadata: { file_cleanup: fileCleanup, completed_at: now.toISOString() },
  });

  return {
    reused: false,
    deleted: transactionResult.deleted,
    total_deleted: transactionResult.totalDeleted,
    usage_ledgers_created: transactionResult.usageLedgersCreated,
    file_cleanup: fileCleanup,
    retained_audit_event_id: id(transactionResult.audit._id),
    file_cleanup_audit_event_id: id(filesAudit?._id),
    completed_at: now.toISOString(),
    exclusions: transactionResult.scope.exclusions,
  };
}

module.exports = {
  CONFIRMATION_PHRASE,
  deleteGeneratedContent,
  previewGeneratedContentCleanup,
  sweepOrphanedGeneratedFiles,
  _private: {
    buildCleanupScope,
    cleanupFiles,
    conservativeUsageForRun,
    decodeToken,
    fingerprintScope,
    orphanFileMinAgeMs,
    signToken,
  },
};
