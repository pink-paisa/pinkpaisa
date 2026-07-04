const AgentTask = require("../models/AgentTask");
const DailyBatchRun = require("../models/DailyBatchRun");
const MarketingCampaignRun = require("../models/MarketingCampaignRun");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const { getCampaignSettings } = require("../utils/campaignSettings");
const logger = require("../utils/logger");
const {
  runCaptionAgent,
  runComplianceAgent,
  runCreativeAgent,
  runIntakeAgent,
  runPublishPreparationAgent,
  runStrategyAgent,
  runTrackingAgent,
} = require("./marketingAgents");
const { publishInstagramDraft } = require("./instagramPublishService");

const AUTO_SEQUENCE = ["intake", "strategy", "creative", "caption", "compliance", "tracking"];
const ALL_SEQUENCE = [...AUTO_SEQUENCE, "publish"];
const WORKER_INTERVAL_MS = Math.max(parseInt(process.env.MARKETING_AGENT_POLL_MS || "5000", 10), 1000);
const STALE_TASK_THRESHOLD_MS = Math.max(parseInt(process.env.MARKETING_STALE_TASK_MS || String(30 * 60 * 1000), 10), 60 * 1000);
const MIN_SCHEDULE_DELAY_MS = Math.max(parseInt(process.env.MARKETING_MIN_SCHEDULE_DELAY_MS || String(5 * 60 * 1000), 10), 60 * 1000);
const CAMPAIGN_OPEN_STATUSES = ["queued", "batch_running", "waiting_review", "approved_for_publish", "scheduled", "publishing"];
const PUBLIC_PRODUCT_CAMPAIGN_FIELDS = "title slug status is_visible category subcategory featured_image images is_affiliate affiliate_url affiliate_external_id affiliate_source_platform brand_name source_type";

let workerStarted = false;
let processing = false;

function describeExecutionError(error) {
  if (!error) return "Agent execution failed";
  if (typeof error === "string") return error;

  const responseData = error.response?.data;
  const graphError = responseData?.error;

  if (graphError?.message) {
    const parts = [graphError.message];
    if (graphError.type) parts.push(`type: ${graphError.type}`);
    if (graphError.code != null) parts.push(`code: ${graphError.code}`);
    if (graphError.error_subcode != null) parts.push(`subcode: ${graphError.error_subcode}`);
    return parts.join(" | ");
  }

  if (responseData?.message) return String(responseData.message);
  if (error.message) return String(error.message);
  return "Agent execution failed";
}

function buildCampaignId(vendorProductId) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = String(vendorProductId || "").slice(-6) || Math.random().toString(36).slice(2, 8);
  return `cmp-${datePart}-${suffix}-${Math.random().toString(36).slice(2, 6)}`;
}

function isUncategorizedValue(value) {
  return !value || String(value).trim().toLowerCase() === "uncategorized";
}

function validateAffiliateProductForCampaign(product = {}) {
  if (!product || !product._id) throw new Error("Affiliate product not found for campaign enqueue");
  if ((product.source_type || "admin") !== "admin") throw new Error("Only admin affiliate products can use this campaign queue");
  if (!product.is_affiliate) throw new Error("Product must be an affiliate product before campaign enqueue");
  if (!product.affiliate_url) throw new Error("Affiliate product must have an affiliate URL before campaign enqueue");
  if (product.status !== "active" || product.is_visible !== true) throw new Error("Only active visible affiliate products can create campaigns");
  if (isUncategorizedValue(product.category) || isUncategorizedValue(product.subcategory)) {
    throw new Error("Affiliate product must be assigned to a category before campaign enqueue");
  }
  return true;
}

function getSequence(agentName) {
  return ALL_SEQUENCE.indexOf(agentName) + 1;
}

function getNextAutoAgent(agentName) {
  const index = AUTO_SEQUENCE.indexOf(agentName);
  return index >= 0 ? AUTO_SEQUENCE[index + 1] || null : null;
}

function getIstParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Calcutta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return values;
}

function buildBatchKey(date = new Date()) {
  const parts = getIstParts(date);
  return `instagram-${parts.year}-${parts.month}-${parts.day}`;
}

function buildStaleTaskMessage(task, recoveredAt = new Date(), customMessage = "") {
  if (customMessage) return customMessage;
  const referenceTime = task.started_at || task.updated_at || recoveredAt;
  const elapsedMinutes = Math.max(Math.round((recoveredAt.getTime() - new Date(referenceTime).getTime()) / 60000), 1);
  return `${task.agent_name} task was reset after ${elapsedMinutes} minute(s) without a heartbeat.`;
}

function serialiseTask(task) {
  return {
    id: String(task._id),
    campaign_run_id: String(task.campaign_run_id),
    campaign_id: task.campaign_id,
    agent_name: task.agent_name,
    sequence: task.sequence,
    status: task.status,
    input_json: task.input_json || null,
    output_json: task.output_json || null,
    error_message: task.error_message || null,
    attempt_count: Number(task.attempt_count || 0),
    started_at: task.started_at || null,
    finished_at: task.finished_at || null,
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
  };
}

function serialiseRun(run, taskCounts = null) {
  const vendorProductImages = [
    run.vendor_product_id?.featured_image,
    ...(Array.isArray(run.vendor_product_id?.additional_images) ? run.vendor_product_id.additional_images : []),
  ].filter(Boolean);
  const publicProductImages = [
    run.public_product_id?.featured_image,
    ...(Array.isArray(run.public_product_id?.images) ? run.public_product_id.images : []),
  ].filter(Boolean);
  const productGalleryUrls = Array.from(new Set([...vendorProductImages, ...publicProductImages]));
  const publicProduct = run.public_product_id && typeof run.public_product_id === "object" ? run.public_product_id : {};
  const brief = run.brief_json || {};
  const briefAffiliate = brief.affiliate || {};
  const isAffiliate = Boolean(publicProduct.is_affiliate || brief.is_affiliate || run.source_event === "affiliate_product.published");

  return {
    id: String(run._id),
    campaign_id: run.campaign_id,
    source_event: run.source_event,
    source_event_key: run.source_event_key,
    vendor_product_id: run.vendor_product_id?._id?.toString?.() || run.vendor_product_id?.toString?.() || run.vendor_product_id || null,
    public_product_id: run.public_product_id?._id?.toString?.() || run.public_product_id?.toString?.() || run.public_product_id || null,
    vendor_id: run.vendor_id?._id?.toString?.() || run.vendor_id?.toString?.() || run.vendor_id || null,
    batch_run_id: run.batch_run_id?._id?.toString?.() || run.batch_run_id?.toString?.() || run.batch_run_id || null,
    batch_key: run.batch_key || null,
    product_title: run.product_title || null,
    product_slug: run.product_slug || null,
    vendor_shop_name: run.vendor_shop_name || null,
    is_affiliate: isAffiliate,
    affiliate_url: publicProduct.affiliate_url || brief.affiliate_url || briefAffiliate.url || null,
    affiliate_external_id: publicProduct.affiliate_external_id || brief.affiliate_external_id || briefAffiliate.external_id || null,
    affiliate_source_platform: publicProduct.affiliate_source_platform || brief.affiliate_source_platform || briefAffiliate.source_platform || null,
    status: run.status,
    current_stage: run.current_stage,
    review_stage: run.review_stage || null,
    review_notes: run.review_notes || null,
    review_status: run.review_status || null,
    content_type: run.content_type || null,
    cta_text: run.cta_text || null,
    asset_urls: run.asset_urls || [],
    product_image_url: productGalleryUrls[0] || null,
    product_gallery_urls: productGalleryUrls,
    creative_json: run.creative_json || null,
    approved_at: run.approved_at || null,
    last_error: run.last_error || null,
    brief_json: run.brief_json || null,
    strategy_json: run.strategy_json || null,
    caption_json: run.caption_json || null,
    compliance_json: run.compliance_json || null,
    tracking_json: run.tracking_json || null,
    publish_status: run.publish_status || null,
    scheduled_for: run.scheduled_for || null,
    publish_attempted_at: run.publish_attempted_at || null,
    published_at: run.published_at || null,
    instagram_creation_id: run.instagram_creation_id || null,
    instagram_media_id: run.instagram_media_id || null,
    instagram_permalink: run.instagram_permalink || null,
    created_at: run.created_at || null,
    updated_at: run.updated_at || null,
    task_counts: taskCounts || undefined,
  };
}

function serialiseBatchRun(batch) {
  if (!batch) return null;
  return {
    id: String(batch._id),
    batch_key: batch.batch_key,
    batch_date_ist: batch.batch_date_ist,
    trigger_type: batch.trigger_type,
    status: batch.status,
    started_at: batch.started_at || null,
    finished_at: batch.finished_at || null,
    total_runs: Number(batch.total_runs || 0),
    success_count: Number(batch.success_count || 0),
    failed_count: Number(batch.failed_count || 0),
    error_summary: batch.error_summary || null,
    created_at: batch.created_at || null,
    updated_at: batch.updated_at || null,
  };
}

function buildTaskInput(run, agentName) {
  if (agentName === "intake") {
    return {
      campaign_id: run.campaign_id,
      vendor_product_id: String(run.vendor_product_id),
      public_product_id: run.public_product_id ? String(run.public_product_id) : null,
    };
  }
  if (agentName === "strategy") return { brief_json: run.brief_json || null };
  if (agentName === "creative") return { brief_json: run.brief_json || null, strategy_json: run.strategy_json || null };
  if (agentName === "caption") return { brief_json: run.brief_json || null, strategy_json: run.strategy_json || null, creative_json: run.creative_json || null };
  if (agentName === "compliance") return { brief_json: run.brief_json || null, caption_json: run.caption_json || null, creative_json: run.creative_json || null };
  if (agentName === "tracking") return { brief_json: run.brief_json || null, strategy_json: run.strategy_json || null, caption_json: run.caption_json || null, compliance_json: run.compliance_json || null, creative_json: run.creative_json || null };
  if (agentName === "publish") return { tracking_json: run.tracking_json || null, creative_json: run.creative_json || null, caption_json: run.caption_json || null };
  return {};
}

function getRunPrimaryAssetUrl(run) {
  const publishAssets = run?.tracking_json?.publish_payload?.asset_urls;
  if (Array.isArray(publishAssets) && publishAssets.length) {
    return publishAssets.find(Boolean) || null;
  }

  if (Array.isArray(run?.asset_urls) && run.asset_urls.length) {
    return run.asset_urls.find(Boolean) || null;
  }

  return null;
}

function getRunTrackedUrl(run) {
  return run?.tracking_json?.links?.instagram_feed
    || run?.tracking_json?.publish_payload?.tracked_url
    || run?.brief_json?.product_url
    || null;
}

function buildBulkCarouselCaption(runs) {
  const intro = runs.length > 1
    ? "Featured wellness picks from Pink Paisa:"
    : "Featured pick from Pink Paisa:";

  const productLines = runs.map((run, index) => {
    const title = run.product_title || `Product ${index + 1}`;
    const trackedUrl = getRunTrackedUrl(run);
    return `${index + 1}. ${title}${trackedUrl ? `\n${trackedUrl}` : ""}`;
  });

  const hashtags = Array.from(new Set(
    runs.flatMap((run) => run.caption_json?.instagram?.hashtags || [])
  )).filter(Boolean).slice(0, 12);

  return [
    intro,
    ...productLines,
    "Shop more on Pink Paisa.",
    hashtags.join(" "),
  ].filter(Boolean).join("\n\n").trim();
}

async function markPublishTaskRunning(run, startedAt) {
  await AgentTask.findOneAndUpdate(
    { campaign_run_id: run._id, agent_name: "publish" },
    {
      $set: {
        campaign_id: run.campaign_id,
        campaign_run_id: run._id,
        agent_name: "publish",
        sequence: getSequence("publish"),
        status: "running",
        input_json: buildTaskInput(run, "publish"),
        output_json: null,
        error_message: null,
        started_at: startedAt,
        finished_at: null,
      },
      $inc: { attempt_count: 1 },
    },
    { new: true, upsert: true }
  );
}

async function markPublishTaskOutcome(run, {
  status,
  output = null,
  errorMessage = null,
  finishedAt = new Date(),
}) {
  await AgentTask.findOneAndUpdate(
    { campaign_run_id: run._id, agent_name: "publish" },
    {
      $set: {
        campaign_id: run.campaign_id,
        campaign_run_id: run._id,
        agent_name: "publish",
        sequence: getSequence("publish"),
        status,
        ...(status === "completed"
          ? { output_json: output, error_message: null }
          : { error_message: errorMessage || "Instagram publishing failed" }),
        finished_at: finishedAt,
      },
      $setOnInsert: { attempt_count: 1 },
    },
    { new: true, upsert: true }
  );
}

async function upsertTask(run, agentName, status = "queued") {
  const update = {
    $set: {
      campaign_id: run.campaign_id,
      campaign_run_id: run._id,
      agent_name: agentName,
      sequence: getSequence(agentName),
      status,
      input_json: buildTaskInput(run, agentName),
      error_message: null,
      started_at: status === "running" ? new Date() : null,
      finished_at: null,
      ...(status === "queued" ? { output_json: null } : {}),
    },
    $setOnInsert: {
      attempt_count: 0,
    },
  };
  return AgentTask.findOneAndUpdate(
    { campaign_run_id: run._id, agent_name: agentName },
    update,
    { new: true, upsert: true }
  );
}

function clearPublishState() {
  return {
    publish_status: "not_ready",
    scheduled_for: null,
    publish_attempted_at: null,
    published_at: null,
    instagram_creation_id: null,
    instagram_media_id: null,
    instagram_permalink: null,
    published_urls: [],
  };
}

function assignOutputToRunDoc(run, agentName, output) {
  if (agentName === "intake") {
    run.brief_json = output;
    run.product_title = output.title || run.product_title || null;
    run.product_slug = output.slug || run.product_slug || null;
    run.vendor_shop_name = output.vendor?.shop_name || run.vendor_shop_name || null;
  }
  if (agentName === "strategy") run.strategy_json = output;
  if (agentName === "creative") {
    run.creative_json = output;
    run.asset_urls = output.asset_urls || [];
    run.cta_text = output.cta_text || null;
    run.content_type = output.content_type || run.content_type || "single_image";
  }
  if (agentName === "caption") run.caption_json = output;
  if (agentName === "compliance") run.compliance_json = output;
  if (agentName === "tracking") {
    run.tracking_json = output;
    run.publish_status = "draft";
  }
  if (agentName === "publish") {
    run.publish_status = "published";
    run.status = "published";
    run.current_stage = "published";
    run.review_status = "approved";
    run.review_stage = null;
    run.review_notes = null;
    run.publish_attempted_at = new Date();
    run.published_at = new Date();
    run.instagram_creation_id = output.creation_id || null;
    run.instagram_media_id = output.media_id || null;
    run.instagram_permalink = output.permalink || null;
    run.published_urls = run.asset_urls || [];
  }
  run.last_error = null;
}

async function applyOutputToRun(run, agentName, output) {
  const updates = { last_error: null };
  if (agentName === "intake") {
    updates.brief_json = output;
    updates.product_title = output.title || run.product_title || null;
    updates.product_slug = output.slug || run.product_slug || null;
    updates.vendor_shop_name = output.vendor?.shop_name || run.vendor_shop_name || null;
  }
  if (agentName === "strategy") updates.strategy_json = output;
  if (agentName === "creative") {
    updates.creative_json = output;
    updates.asset_urls = output.asset_urls || [];
    updates.cta_text = output.cta_text || null;
    updates.content_type = output.content_type || run.content_type || "single_image";
  }
  if (agentName === "caption") updates.caption_json = output;
  if (agentName === "compliance") updates.compliance_json = output;
  if (agentName === "tracking") {
    updates.tracking_json = output;
    updates.publish_status = "draft";
  }
  if (agentName === "publish") {
    updates.publish_status = "published";
    updates.status = "published";
    updates.current_stage = "published";
    updates.review_status = "approved";
    updates.review_stage = null;
    updates.review_notes = null;
    updates.publish_attempted_at = new Date();
    updates.published_at = new Date();
    updates.instagram_creation_id = output.creation_id || null;
    updates.instagram_media_id = output.media_id || null;
    updates.instagram_permalink = output.permalink || null;
    updates.published_urls = run.asset_urls || [];
  }
  assignOutputToRunDoc(run, agentName, output);
  await MarketingCampaignRun.findByIdAndUpdate(run._id, { $set: updates });
}

async function runAgentForStage(run, agentName) {
  if (agentName === "intake") return runIntakeAgent(run);
  if (agentName === "strategy") return runStrategyAgent(run);
  if (agentName === "creative") return runCreativeAgent(run);
  if (agentName === "caption") return runCaptionAgent(run);
  if (agentName === "compliance") return runComplianceAgent(run);
  if (agentName === "tracking") return runTrackingAgent(run);
  return null;
}

async function ensureRunInputs(run, agentName) {
  const prerequisites = [
    { stage: "intake", needs: ["strategy", "creative", "caption", "compliance", "tracking", "publish"], missing: () => !run.brief_json },
    { stage: "strategy", needs: ["creative", "caption", "tracking", "publish"], missing: () => !run.strategy_json },
    { stage: "creative", needs: ["caption", "compliance", "tracking", "publish"], missing: () => !run.creative_json },
    { stage: "caption", needs: ["compliance", "tracking", "publish"], missing: () => !run.caption_json },
    { stage: "compliance", needs: ["tracking", "publish"], missing: () => !run.compliance_json },
    { stage: "tracking", needs: ["publish"], missing: () => !run.tracking_json?.publish_payload },
  ];

  for (const prerequisite of prerequisites) {
    if (!prerequisite.needs.includes(agentName) || !prerequisite.missing()) continue;
    const output = await runAgentForStage(run, prerequisite.stage);
    if (!output) throw new Error(`Missing handler while rebuilding ${prerequisite.stage} inputs`);
    await applyOutputToRun(run, prerequisite.stage, output);
  }
}

async function refreshBatchRun(batchRunId) {
  if (!batchRunId) return null;
  const runCounts = await MarketingCampaignRun.aggregate([
    { $match: { batch_run_id: batchRunId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const totals = { active: 0, success: 0, failed: 0, total: 0 };
  runCounts.forEach((row) => {
    totals.total += row.count;
    if (["queued", "running", "batch_running"].includes(row._id)) totals.active += row.count;
    if (["waiting_review", "approved_for_publish", "scheduled", "publishing", "published", "completed"].includes(row._id)) totals.success += row.count;
    if (["failed", "rejected"].includes(row._id)) totals.failed += row.count;
  });

  const updates = {
    success_count: totals.success,
    failed_count: totals.failed,
    total_runs: totals.total,
  };

  if (totals.active === 0) {
    updates.status = totals.failed > 0
      ? (totals.success > 0 ? "completed_with_errors" : "failed")
      : "completed";
    updates.finished_at = new Date();
    updates.error_summary = totals.failed > 0 ? `${totals.failed} campaign run(s) failed during draft generation.` : null;
  } else {
    updates.status = "running";
    updates.finished_at = null;
    updates.error_summary = null;
  }

  const batch = await DailyBatchRun.findByIdAndUpdate(batchRunId, { $set: updates }, { new: true });
  return batch;
}

async function markRunFailed(runId, agentName, errorMessage) {
  const updates = {
    status: "failed",
    current_stage: agentName,
    last_error: errorMessage,
    review_stage: null,
    publish_status: agentName === "publish" ? "failed" : "not_ready",
  };
  if (agentName === "publish") updates.publish_attempted_at = new Date();

  const run = await MarketingCampaignRun.findByIdAndUpdate(runId, { $set: updates }, { new: true });
  await refreshBatchRun(run?.batch_run_id);
}

async function recoverStaleRunningTasks({
  campaignRunId = null,
  force = false,
  olderThanMs = STALE_TASK_THRESHOLD_MS,
  errorMessage = "",
} = {}) {
  const query = { status: "running" };
  if (campaignRunId) query.campaign_run_id = campaignRunId;
  if (!force) {
    query.started_at = { $lte: new Date(Date.now() - olderThanMs) };
  }

  const staleTasks = await AgentTask.find(query).sort({ started_at: 1, created_at: 1 });
  if (!staleTasks.length) {
    return { recovered_count: 0, campaign_run_ids: [] };
  }

  const recoveredAt = new Date();
  const recoveredRunIds = new Set();

  for (const task of staleTasks) {
    const message = buildStaleTaskMessage(task, recoveredAt, errorMessage);
    await AgentTask.findByIdAndUpdate(task._id, {
      $set: {
        status: "failed",
        error_message: message,
        finished_at: recoveredAt,
      },
    });
    await markRunFailed(task.campaign_run_id, task.agent_name, message);
    recoveredRunIds.add(String(task.campaign_run_id));
  }

  return {
    recovered_count: staleTasks.length,
    campaign_run_ids: Array.from(recoveredRunIds),
  };
}

async function advanceRun(run, agentName, output) {
  if (agentName === "publish") return;

  const nextAgent = getNextAutoAgent(agentName);
  if (!nextAgent) {
    const campaignSettings = await getCampaignSettings();
    if (campaignSettings.campaign_mode === "automatic") {
      const autoApproved = await MarketingCampaignRun.findByIdAndUpdate(run._id, {
        $set: {
          status: "approved_for_publish",
          current_stage: "approved_for_publish",
          review_stage: null,
          review_status: "approved",
          review_notes: "Auto-approved in automatic campaign mode. Publish started after draft generation.",
          publish_status: "ready",
          last_error: null,
        },
      }, { new: true });

      void publishCampaignRunNow(autoApproved._id).catch((error) => {
        logger.error({ campaignId: autoApproved.campaign_id, err: error }, "automatic Instagram publish failed");
      });
      return;
    }

    const updated = await MarketingCampaignRun.findByIdAndUpdate(run._id, {
      $set: {
        status: "waiting_review",
        current_stage: "ready_for_review",
        review_stage: "draft",
        review_status: "pending",
        review_notes: output?.review_reason || run.compliance_json?.review_reason || "Draft ready. Review the creative and then click Post when you are satisfied.",
        publish_status: "draft",
        last_error: null,
      },
    }, { new: true });
    await refreshBatchRun(updated.batch_run_id);
    return;
  }

  const freshRun = await MarketingCampaignRun.findByIdAndUpdate(run._id, {
    $set: {
      status: "batch_running",
      current_stage: nextAgent,
      review_stage: null,
      review_notes: null,
      publish_status: "not_ready",
      last_error: null,
    },
  }, { new: true });
  await upsertTask(freshRun, nextAgent, "queued");
}

async function executeTask(task) {
  const run = await MarketingCampaignRun.findById(task.campaign_run_id);
  if (!run) {
    await AgentTask.findByIdAndUpdate(task._id, {
      $set: {
        status: "failed",
        finished_at: new Date(),
        error_message: "Campaign run not found",
      },
    });
    return;
  }

  try {
    await ensureRunInputs(run, task.agent_name);

    let output = null;
    if (["intake", "strategy", "creative", "caption", "compliance", "tracking"].includes(task.agent_name)) {
      output = await runAgentForStage(run, task.agent_name);
    }
    if (task.agent_name === "publish") {
      const publishPayload = await runPublishPreparationAgent(run);
      if (run.instagram_media_id || run.publish_status === "published" || run.status === "published") {
        output = {
          creation_id: run.instagram_creation_id || null,
          media_id: run.instagram_media_id || null,
          permalink: run.instagram_permalink || null,
          publish_payload: publishPayload,
          skipped_duplicate_publish: true,
        };
      } else {
        const publishResult = await publishInstagramDraft({
          contentType: publishPayload.content_type,
          assetUrls: publishPayload.asset_urls,
          caption: publishPayload.caption,
        });
        output = {
          ...publishResult,
          publish_payload: publishPayload,
        };
      }
    }
    if (!output) throw new Error(`No handler configured for agent ${task.agent_name}`);

    await AgentTask.findByIdAndUpdate(task._id, {
      $set: {
        status: "completed",
        output_json: output,
        finished_at: new Date(),
        error_message: null,
      },
    });

    await applyOutputToRun(run, task.agent_name, output);
    if (task.agent_name === "publish") {
      const latestRun = await MarketingCampaignRun.findById(run._id);
      await refreshBatchRun(latestRun?.batch_run_id);
      return;
    }
    const freshRun = await MarketingCampaignRun.findById(run._id);
    await advanceRun(freshRun, task.agent_name, output);
  } catch (error) {
    const message = describeExecutionError(error);
    await AgentTask.findByIdAndUpdate(task._id, {
      $set: {
        status: "failed",
        error_message: message,
        finished_at: new Date(),
      },
    });
    await markRunFailed(run._id, task.agent_name, message);
  }
}

async function processQueuedTasks(maxTasks = 5) {
  await recoverStaleRunningTasks().catch((error) => {
    logger.error({ err: error }, "failed to recover stale marketing tasks");
  });
  if (processing) return;
  processing = true;
  try {
    for (let index = 0; index < maxTasks; index += 1) {
      const task = await AgentTask.findOneAndUpdate(
        { status: "queued" },
        {
          $set: {
            status: "running",
            started_at: new Date(),
            finished_at: null,
            error_message: null,
          },
          $inc: { attempt_count: 1 },
        },
        { sort: { created_at: 1 }, new: true }
      );
      if (!task) break;
      await executeTask(task);
    }
  } finally {
    processing = false;
  }
}

async function queueAndRunTaskImmediately(runId, agentName) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");

  await upsertTask(run, agentName, "queued");
  const task = await AgentTask.findOneAndUpdate(
    { campaign_run_id: runId, agent_name: agentName },
    {
      $set: {
        status: "running",
        started_at: new Date(),
        finished_at: null,
        error_message: null,
        input_json: buildTaskInput(run, agentName),
      },
      $inc: { attempt_count: 1 },
    },
    { new: true }
  );

  await executeTask(task);
  const finalTask = await AgentTask.findById(task._id).lean();
  const detail = await getCampaignRunDetail(runId);

  if (finalTask?.status === "failed") {
    throw new Error(finalTask.error_message || detail.run?.last_error || `${agentName} task failed`);
  }

  return detail;
}

async function enqueueApprovedProductCampaign({ vendorProductId, publicProductId, approvedAt }) {
  const vendorProduct = await VendorProduct.findById(vendorProductId).lean();
  if (!vendorProduct) throw new Error("Vendor product not found for campaign enqueue");
  if (vendorProduct.approval_status !== "approved") throw new Error("Only approved products can create campaigns");

  const publicProduct = await Product.findById(publicProductId || vendorProduct.published_product_id).lean();
  if (!publicProduct) throw new Error("Public product not found for campaign enqueue");

  const vendor = await Vendor.findById(vendorProduct.vendor_id).lean();
  const approvedDate = approvedAt ? new Date(approvedAt) : new Date();
  const sourceEventKey = `product.approved:${String(vendorProduct._id)}:${approvedDate.getTime()}`;

  let run = await MarketingCampaignRun.findOne({ source_event_key: sourceEventKey });
  if (run) return serialiseRun(run);

  run = await MarketingCampaignRun.create({
    campaign_id: buildCampaignId(vendorProduct._id),
    source_event: "product.approved",
    source_event_key: sourceEventKey,
    vendor_product_id: vendorProduct._id,
    public_product_id: publicProduct._id,
    vendor_id: vendorProduct.vendor_id,
    product_title: vendorProduct.title,
    product_slug: publicProduct.slug || vendorProduct.slug,
    vendor_shop_name: vendor?.shop_name || vendor?.business_name || "Vendor",
    status: "queued",
    current_stage: "queued_for_daily_batch",
    review_status: "pending",
    publish_status: "not_ready",
    approved_at: approvedDate,
  });

  return serialiseRun(run);
}

async function enqueueAdminProductCampaign({ productId, queuedAt }) {
  const product = await Product.findById(productId).lean();
  if (!product) throw new Error("Admin product not found for campaign enqueue");
  if (product.source_type && product.source_type !== "admin") throw new Error("Only admin products can use this campaign queue");
  if (product.is_affiliate) throw new Error("Affiliate products cannot enter the Instagram campaign queue");
  if (product.status !== "active" || !product.is_visible) throw new Error("Only active visible admin products can create campaigns");

  const existingOpenRun = await MarketingCampaignRun.findOne({
    public_product_id: product._id,
    source_event: "admin_product.published",
    status: { $in: CAMPAIGN_OPEN_STATUSES },
  }).sort({ created_at: -1 });
  if (existingOpenRun) return serialiseRun(existingOpenRun);

  const queuedDate = queuedAt ? new Date(queuedAt) : new Date();
  const sourceEventKey = `admin_product.published:${String(product._id)}:${queuedDate.getTime()}`;

  let run = await MarketingCampaignRun.findOne({ source_event_key: sourceEventKey });
  if (run) return serialiseRun(run);

  run = await MarketingCampaignRun.create({
    campaign_id: buildCampaignId(product._id),
    source_event: "admin_product.published",
    source_event_key: sourceEventKey,
    vendor_product_id: null,
    public_product_id: product._id,
    vendor_id: null,
    product_title: product.title,
    product_slug: product.slug,
    vendor_shop_name: "Pink Paisa",
    status: "queued",
    current_stage: "queued_for_daily_batch",
    review_status: "pending",
    publish_status: "not_ready",
    approved_at: queuedDate,
  });

  return serialiseRun(run);
}

async function enqueueAffiliateProductCampaign({ productId, queuedAt }) {
  const product = await Product.findById(productId).lean();
  validateAffiliateProductForCampaign(product);

  const existingOpenRun = await MarketingCampaignRun.findOne({
    public_product_id: product._id,
    source_event: "affiliate_product.published",
    status: { $in: CAMPAIGN_OPEN_STATUSES },
  }).sort({ created_at: -1 });
  if (existingOpenRun) return serialiseRun({ ...existingOpenRun.toObject(), public_product_id: product });

  const queuedDate = queuedAt ? new Date(queuedAt) : new Date();
  const sourceEventKey = `affiliate_product.published:${String(product._id)}:${queuedDate.getTime()}`;

  let run = await MarketingCampaignRun.findOne({ source_event_key: sourceEventKey });
  if (run) return serialiseRun({ ...run.toObject(), public_product_id: product });

  run = await MarketingCampaignRun.create({
    campaign_id: buildCampaignId(product._id),
    source_event: "affiliate_product.published",
    source_event_key: sourceEventKey,
    vendor_product_id: null,
    public_product_id: product._id,
    vendor_id: null,
    product_title: product.title,
    product_slug: product.slug,
    vendor_shop_name: product.brand_name || product.affiliate_source_platform || "Affiliate Partner",
    status: "queued",
    current_stage: "queued_for_daily_batch",
    review_status: "pending",
    publish_status: "not_ready",
    approved_at: queuedDate,
  });

  return serialiseRun({ ...run.toObject(), public_product_id: product });
}

async function runDailyBatch({ triggerType = "manual", date = new Date() } = {}) {
  const parts = getIstParts(date);
  const batchDateIst = `${parts.year}-${parts.month}-${parts.day}`;
  const batchKey = buildBatchKey(date);
  let batch = await DailyBatchRun.findOne({ batch_key: batchKey });
  if (!batch) {
    try {
      batch = await DailyBatchRun.create({
        batch_key: batchKey,
        batch_date_ist: batchDateIst,
        trigger_type: triggerType,
        status: "running",
        started_at: new Date(),
      });
    } catch (error) {
      if (error?.code === 11000) {
        batch = await DailyBatchRun.findOne({ batch_key: batchKey });
      } else {
        throw error;
      }
    }
  }

  if (batch?.status === "running") {
    return serialiseBatchRun(batch);
  }

  const queuedRuns = await MarketingCampaignRun.find({
    status: "queued",
    $or: [
      { batch_key: null },
      { batch_key: { $exists: false } },
      { batch_key: "" },
    ],
  }).sort({ approved_at: 1, created_at: 1 });

  if (!queuedRuns.length) {
    const completedBatch = await DailyBatchRun.findByIdAndUpdate(batch._id, {
      $set: {
        status: "completed",
        finished_at: new Date(),
        total_runs: 0,
        success_count: 0,
        failed_count: 0,
        error_summary: null,
      },
    }, { new: true });
    return serialiseBatchRun(completedBatch);
  }

  const runIds = queuedRuns.map((run) => run._id);
  await MarketingCampaignRun.updateMany(
    { _id: { $in: runIds } },
    {
      $set: {
        status: "batch_running",
        current_stage: "intake",
        batch_key: batchKey,
        batch_run_id: batch._id,
        review_status: "pending",
        review_stage: null,
        review_notes: null,
        ...clearPublishState(),
      },
    }
  );

  const freshRuns = await MarketingCampaignRun.find({ _id: { $in: runIds } });
  for (const run of freshRuns) {
    await upsertTask(run, "intake", "queued");
  }

  batch = await DailyBatchRun.findByIdAndUpdate(batch._id, {
    $set: {
      status: "running",
      total_runs: runIds.length,
      run_ids: runIds,
      started_at: batch.started_at || new Date(),
      finished_at: null,
      error_summary: null,
    },
  }, { new: true });

  void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  return serialiseBatchRun(batch);
}

async function getLatestDailyBatchRun() {
  const batch = await DailyBatchRun.findOne().sort({ created_at: -1 }).lean();
  return serialiseBatchRun(batch);
}

async function reviewCampaignRun(runId, action, notes = "") {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.status !== "waiting_review" || !run.review_stage) throw new Error("Campaign run is not waiting for review");

  if (action === "reject") {
    run.status = "rejected";
    run.current_stage = "review_rejected";
    run.last_error = notes || "Campaign draft rejected during review";
    run.review_notes = notes || run.review_notes;
    run.review_status = "rejected";
    run.review_stage = null;
    run.publish_status = "failed";
    await run.save();
    await refreshBatchRun(run.batch_run_id);
    return serialiseRun(run);
  }

  if (action !== "approve") throw new Error("Unsupported review action");

  run.status = "approved_for_publish";
  run.current_stage = "approved_for_publish";
  run.review_notes = notes || null;
  run.review_status = "approved";
  run.review_stage = null;
  run.last_error = null;
  run.publish_status = "ready";
  await run.save();
  await refreshBatchRun(run.batch_run_id);
  return serialiseRun(run);
}

async function retryCampaignRun(runId) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  const failedTask = await AgentTask.findOne({ campaign_run_id: runId, status: "failed" }).sort({ updated_at: -1 });
  if (!failedTask) throw new Error("No failed task found for this campaign");

  run.status = failedTask.agent_name === "publish" ? "publishing" : "batch_running";
  run.current_stage = failedTask.agent_name;
  run.review_stage = null;
  run.last_error = null;
  run.publish_status = failedTask.agent_name === "publish" ? "publishing" : "not_ready";
  await run.save();

  if (failedTask.agent_name === "publish") {
    return queueAndRunTaskImmediately(runId, "publish");
  }

  await upsertTask(run, failedTask.agent_name, "queued");
  void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  return serialiseRun(run);
}

async function resetStuckCampaignRun(runId) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");

  const recovery = await recoverStaleRunningTasks({
    campaignRunId: runId,
    force: true,
    errorMessage: "Task was manually reset by an admin after appearing stuck.",
  });

  if (!recovery.recovered_count) {
    throw new Error("No running task found for this campaign");
  }

  return getCampaignRunDetail(runId);
}

async function regenerateCampaignRun(runId, stage = "creative") {
  const validStages = ["strategy", "creative", "caption", "compliance", "tracking"];
  if (!validStages.includes(stage)) throw new Error("Unsupported regenerate stage");

  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (["publishing", "published"].includes(run.status)) throw new Error("Cannot regenerate a campaign that is already publishing or published");

  const reset = {
    last_error: null,
    review_stage: null,
    review_notes: null,
    review_status: "pending",
    status: "batch_running",
    current_stage: stage,
    ...clearPublishState(),
  };

  if (["strategy"].includes(stage)) reset.strategy_json = null;
  if (["strategy", "creative"].includes(stage)) {
    reset.creative_json = null;
    reset.asset_urls = [];
    reset.cta_text = null;
    reset.content_type = "single_image";
  }
  if (["strategy", "creative", "caption"].includes(stage)) reset.caption_json = null;
  if (["strategy", "creative", "caption", "compliance"].includes(stage)) reset.compliance_json = null;
  if (["strategy", "creative", "caption", "compliance", "tracking"].includes(stage)) reset.tracking_json = null;

  Object.assign(run, reset);
  await run.save();

  const affectedAgents = ALL_SEQUENCE.slice(ALL_SEQUENCE.indexOf(stage));
  await AgentTask.deleteMany({
    campaign_run_id: run._id,
    agent_name: { $in: affectedAgents.filter((agent) => agent !== stage) },
  });
  await upsertTask(run, stage, "queued");

  void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  return getCampaignRunDetail(runId);
}

function buildDraftCaption(longCaption, hashtags, trackedUrl) {
  return `${String(longCaption || "").trim()}\n\n${String(trackedUrl || "").trim()}\n\n${(hashtags || []).join(" ")}`.trim();
}

async function updateCampaignDraft(runId, payload = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (["publishing", "published"].includes(run.status)) throw new Error("Published campaigns cannot be edited");

  const nextCaption = { ...(run.caption_json || {}) };
  const instagram = { ...(nextCaption.instagram || {}) };
  if (payload.long_caption != null) instagram.long_caption = String(payload.long_caption).trim();
  if (payload.short_caption != null) instagram.short_caption = String(payload.short_caption).trim();
  if (payload.cta_text != null) instagram.cta = String(payload.cta_text).trim();
  if (Array.isArray(payload.hashtags)) instagram.hashtags = payload.hashtags.map((item) => String(item).trim()).filter(Boolean);
  nextCaption.instagram = instagram;

  const trackedUrl = run.tracking_json?.links?.instagram_feed || run.tracking_json?.publish_payload?.tracked_url || "";
  const nextTracking = {
    ...(run.tracking_json || {}),
    publish_payload: {
      ...(run.tracking_json?.publish_payload || {}),
      content_type: payload.content_type || run.content_type || run.tracking_json?.publish_payload?.content_type || "single_image",
      asset_urls: run.asset_urls || [],
      tracked_url: trackedUrl,
      cta: payload.cta_text != null ? String(payload.cta_text).trim() : (instagram.cta || run.cta_text || ""),
      caption: buildDraftCaption(instagram.long_caption || instagram.short_caption || "", instagram.hashtags || [], trackedUrl),
    },
  };

  run.caption_json = nextCaption;
  run.cta_text = payload.cta_text != null ? String(payload.cta_text).trim() : (run.cta_text || instagram.cta || null);
  run.tracking_json = nextTracking;
  if (payload.content_type === "single_image" || payload.content_type === "carousel") {
    run.content_type = payload.content_type;
    if (run.creative_json) run.creative_json.content_type = payload.content_type;
    if (run.tracking_json?.publish_payload) run.tracking_json.publish_payload.content_type = payload.content_type;
  }
  await run.save();
  return getCampaignRunDetail(runId);
}

async function scheduleCampaignRun(runId, scheduledFor) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.review_status !== "approved" || !["ready", "failed", "draft", "scheduled"].includes(run.publish_status)) {
    throw new Error("Campaign must be review-approved before scheduling");
  }

  const scheduleDate = new Date(scheduledFor);
  if (Number.isNaN(scheduleDate.getTime())) throw new Error("Invalid schedule time");
  if (scheduleDate.getTime() <= Date.now() + MIN_SCHEDULE_DELAY_MS) {
    throw new Error(`Schedule time must be at least ${Math.round(MIN_SCHEDULE_DELAY_MS / 60000)} minutes in the future`);
  }

  run.status = "scheduled";
  run.current_stage = "scheduled_for_publish";
  run.publish_status = "scheduled";
  run.scheduled_for = scheduleDate;
  run.last_error = null;
  await run.save();
  return serialiseRun(run);
}

async function publishCampaignRunNow(runId) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.instagram_media_id || run.publish_status === "published" || run.status === "published") {
    if (run.publish_status !== "published" || run.status !== "published") {
      run.status = "published";
      run.current_stage = "published";
      run.publish_status = "published";
      run.review_status = "approved";
      run.review_stage = null;
      run.last_error = null;
      run.published_at = run.published_at || new Date();
      await run.save();
      await refreshBatchRun(run.batch_run_id);
    }
    return getCampaignRunDetail(runId);
  }
  if (run.publish_status === "publishing" || run.status === "publishing") {
    throw new Error("Campaign is already publishing");
  }
  if (run.review_status !== "approved") throw new Error("Review approval is required before publishing");
  if (!run.tracking_json?.publish_payload?.asset_urls?.length && !(run.asset_urls || []).length) {
    throw new Error("No publish-ready Instagram assets are available");
  }

  run.status = "publishing";
  run.current_stage = "publish";
  run.publish_status = "publishing";
  run.scheduled_for = null;
  run.last_error = null;
  run.publish_attempted_at = new Date();
  await run.save();

  return queueAndRunTaskImmediately(runId, "publish");
}

async function publishCampaignRunsAsCarousel(runIds = []) {
  const uniqueRunIds = Array.from(new Set(
    (Array.isArray(runIds) ? runIds : []).map((id) => String(id || "").trim()).filter(Boolean)
  ));

  if (uniqueRunIds.length < 2) {
    throw new Error("Select at least 2 review-approved campaign drafts to publish one carousel");
  }

  if (uniqueRunIds.length > 10) {
    throw new Error("Instagram carousel posting supports up to 10 selected products at a time");
  }

  const runs = await MarketingCampaignRun.find({ _id: { $in: uniqueRunIds } });
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  const orderedRuns = uniqueRunIds.map((id) => runMap.get(id)).filter(Boolean);

  if (orderedRuns.length !== uniqueRunIds.length) {
    const missingIds = uniqueRunIds.filter((id) => !runMap.has(id));
    throw new Error(`Some selected campaign runs were not found: ${missingIds.join(", ")}`);
  }

  for (const run of orderedRuns) {
    if (run.review_status !== "approved") {
      throw new Error(`${run.product_title || run.campaign_id} must be review approved before carousel posting`);
    }
    if (run.instagram_media_id || run.publish_status === "published" || run.status === "published") {
      throw new Error(`${run.product_title || run.campaign_id} has already been published`);
    }
    if (run.publish_status === "publishing" || run.status === "publishing") {
      throw new Error(`${run.product_title || run.campaign_id} is already publishing`);
    }
    if (!getRunPrimaryAssetUrl(run)) {
      throw new Error(`${run.product_title || run.campaign_id} does not have a publish-ready image yet`);
    }
  }

  const startedAt = new Date();
  const assetUrls = orderedRuns.map((run) => getRunPrimaryAssetUrl(run));
  const caption = buildBulkCarouselCaption(orderedRuns);

  for (const run of orderedRuns) {
    run.status = "publishing";
    run.current_stage = "publish";
    run.publish_status = "publishing";
    run.scheduled_for = null;
    run.last_error = null;
    run.publish_attempted_at = startedAt;
    await run.save();
    await markPublishTaskRunning(run, startedAt);
  }

  try {
    const publishResult = await publishInstagramDraft({
      contentType: "carousel",
      assetUrls,
      caption,
    });

    const finishedAt = new Date();
    const sharedPublishNote = `Published in grouped carousel post with ${orderedRuns.length} products.`;

    for (let index = 0; index < orderedRuns.length; index += 1) {
      const run = orderedRuns[index];
      run.status = "published";
      run.current_stage = "published";
      run.review_status = "approved";
      run.review_stage = null;
      run.review_notes = sharedPublishNote;
      run.publish_status = "published";
      run.scheduled_for = null;
      run.last_error = null;
      run.publish_attempted_at = startedAt;
      run.published_at = finishedAt;
      run.instagram_creation_id = publishResult.creation_id || null;
      run.instagram_media_id = publishResult.media_id || null;
      run.instagram_permalink = publishResult.permalink || null;
      run.published_urls = assetUrls;
      run.content_type = "carousel";
      await run.save();

      await markPublishTaskOutcome(run, {
        status: "completed",
        finishedAt,
        output: {
          ...publishResult,
          grouped_publish: true,
          total_items: orderedRuns.length,
          position: index + 1,
          source_asset_url: assetUrls[index],
          tracked_url: getRunTrackedUrl(run),
          selected_run_ids: uniqueRunIds,
          publish_payload: {
            channel: "instagram",
            content_type: "carousel",
            asset_urls: assetUrls,
            caption,
          },
        },
      });

      await refreshBatchRun(run.batch_run_id);
    }

    return {
      publish_result: publishResult,
      caption,
      runs: orderedRuns.map((run) => serialiseRun(run)),
    };
  } catch (error) {
    const message = describeExecutionError(error);
    const finishedAt = new Date();

    for (const run of orderedRuns) {
      run.status = "failed";
      run.current_stage = "publish";
      run.publish_status = "failed";
      run.last_error = message;
      run.publish_attempted_at = startedAt;
      await run.save();
      await markPublishTaskOutcome(run, {
        status: "failed",
        finishedAt,
        errorMessage: message,
      });
      await refreshBatchRun(run.batch_run_id);
    }

    throw new Error(message);
  }
}

async function processDueScheduledPublishes(limit = 3) {
  const scheduledRuns = await MarketingCampaignRun.find({
    status: "scheduled",
    publish_status: "scheduled",
    scheduled_for: { $lte: new Date() },
  }).sort({ scheduled_for: 1 }).limit(limit);

  for (const run of scheduledRuns) {
    try {
      await publishCampaignRunNow(run._id);
    } catch (error) {
      await MarketingCampaignRun.findByIdAndUpdate(run._id, {
        $set: {
          status: "failed",
          current_stage: "publish",
          publish_status: "failed",
          last_error: error.message,
          publish_attempted_at: new Date(),
        },
      });
    }
  }
}

async function listCampaignRuns({ search = "", status = "all", page = 1, limit = 10 }) {
  const query = {};
  const trimmedSearch = String(search || "").trim();
  if (status !== "all") query.status = status;
  if (trimmedSearch) {
    query.$or = [
      { campaign_id: { $regex: trimmedSearch, $options: "i" } },
      { product_title: { $regex: trimmedSearch, $options: "i" } },
      { vendor_shop_name: { $regex: trimmedSearch, $options: "i" } },
    ];
  }

  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 10), 1), 50);
  const [items, total, groupedCounts, latestBatch] = await Promise.all([
    MarketingCampaignRun.find(query)
      .sort({ updated_at: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("vendor_product_id", "featured_image additional_images")
      .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
      .lean(),
    MarketingCampaignRun.countDocuments(query),
    MarketingCampaignRun.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    DailyBatchRun.findOne().sort({ created_at: -1 }).lean(),
  ]);

  const runIds = items.map((item) => item._id);
  const taskCountRows = runIds.length
    ? await AgentTask.aggregate([
      { $match: { campaign_run_id: { $in: runIds } } },
      { $group: { _id: { campaign_run_id: "$campaign_run_id", status: "$status" }, count: { $sum: 1 } } },
    ])
    : [];

  const taskCountMap = new Map();
  taskCountRows.forEach((row) => {
    const runId = String(row._id.campaign_run_id);
    const existing = taskCountMap.get(runId) || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    existing[row._id.status] = row.count;
    taskCountMap.set(runId, existing);
  });

  const counts = {
    queued: 0,
    batch_running: 0,
    waiting_review: 0,
    approved_for_publish: 0,
    scheduled: 0,
    publishing: 0,
    published: 0,
    failed: 0,
    rejected: 0,
  };
  groupedCounts.forEach((row) => {
    if (counts[row._id] != null) counts[row._id] = row.count;
  });

  return {
    items: items.map((item) => serialiseRun(item, taskCountMap.get(String(item._id)) || undefined)),
    counts,
    latest_batch: serialiseBatchRun(latestBatch),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

async function getCampaignRunDetail(runId) {
  const run = await MarketingCampaignRun.findById(runId)
    .populate("vendor_product_id", "title slug price sale_price stock_quantity category subcategory featured_image short_description full_description approval_status published_product_id")
    .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
    .populate("vendor_id", "shop_name business_name email status")
    .populate("batch_run_id")
    .lean();
  if (!run) throw new Error("Campaign run not found");

  const tasks = await AgentTask.find({ campaign_run_id: runId }).sort({ sequence: 1, created_at: 1 }).lean();
  return {
    run: serialiseRun(run),
    batch: serialiseBatchRun(run.batch_run_id),
    tasks: tasks.map(serialiseTask),
  };
}

function startMarketingAgentWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  }, WORKER_INTERVAL_MS);
  void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  logger.info({ pollMs: WORKER_INTERVAL_MS }, "marketing agent worker started");
}

module.exports = {
  enqueueAdminProductCampaign,
  enqueueAffiliateProductCampaign,
  enqueueApprovedProductCampaign,
  getCampaignSettings,
  getCampaignRunDetail,
  getLatestDailyBatchRun,
  listCampaignRuns,
  processDueScheduledPublishes,
  processQueuedTasks,
  publishCampaignRunsAsCarousel,
  publishCampaignRunNow,
  recoverStaleRunningTasks,
  regenerateCampaignRun,
  resetStuckCampaignRun,
  reviewCampaignRun,
  retryCampaignRun,
  runDailyBatch,
  scheduleCampaignRun,
  serialiseBatchRun,
  serialiseRun,
  startMarketingAgentWorker,
  updateCampaignDraft,
  validateAffiliateProductForCampaign,
};
