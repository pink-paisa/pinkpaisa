const crypto = require("crypto");
const os = require("os");
const AgentTask = require("../models/AgentTask");
const DailyBatchRun = require("../models/DailyBatchRun");
const MarketingCampaignPublishEvent = require("../models/MarketingCampaignPublishEvent");
const MarketingCampaignRun = require("../models/MarketingCampaignRun");
const MarketingAsset = require("../models/MarketingAsset");
const MarketingPublishAttempt = require("../models/MarketingPublishAttempt");
const MarketingWorkerHeartbeat = require("../models/MarketingWorkerHeartbeat");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const { getCampaignSettings } = require("../utils/campaignSettings");
const logger = require("../utils/logger");
const {
  AFFILIATE_INSTAGRAM_DISCLOSURE,
  ensureAffiliateInstagramDisclosure,
  hasAffiliateInstagramDisclosure,
  isAffiliateDisclosureHashtag,
  runCaptionAgent,
  runComplianceAgent,
  runCreativeAgent,
  runIntakeAgent,
  runPublishPreparationAgent,
  runStrategyAgent,
  runTrackingAgent,
  stripAffiliateInstagramDisclosure,
} = require("./marketingAgents");
const { validateAmazonAffiliateUrl } = require("./amazonAffiliateCompliance");
const { isPublicMediaUrl, publishInstagramDraft } = require("./instagramPublishService");
const { deleteCampaignAsset } = require("./campaignAssetStorage");
const {
  readAndNormalizeReferenceImage,
  resolveProductReferenceImage,
  resolveVendorReferenceImage,
} = require("./campaignReferenceImage");
const { assertReferenceModelSupported } = require("./imageProviders");
const {
  DEFAULT_AFFILIATE_CAROUSEL_CAPTION,
  buildAffiliateCarouselCaption,
  carouselError,
} = require("./affiliateCarouselCaption");

const AUTO_SEQUENCE = ["intake", "creative", "caption", "compliance", "tracking"];
const LEGACY_SEQUENCE = ["intake", "strategy", "creative", "caption", "compliance", "tracking"];
const ALL_SEQUENCE = [...LEGACY_SEQUENCE, "publish"];
const WORKER_INTERVAL_MS = Math.max(parseInt(process.env.MARKETING_AGENT_POLL_MS || "5000", 10), 1000);
const STALE_TASK_THRESHOLD_MS = Math.max(parseInt(process.env.MARKETING_STALE_TASK_MS || String(30 * 60 * 1000), 10), 60 * 1000);
const TASK_LEASE_MS = Math.max(parseInt(process.env.MARKETING_TASK_LEASE_MS || String(5 * 60 * 1000), 10), 60 * 1000);
const CAROUSEL_COMPOSITION_LEASE_MS = Math.max(parseInt(process.env.MARKETING_CAROUSEL_COMPOSITION_LEASE_MS || String(2 * 60 * 1000), 10), 30 * 1000);
const MAX_TASK_ATTEMPTS = Math.max(parseInt(process.env.MARKETING_MAX_TASK_ATTEMPTS || "3", 10), 1);
const MIN_SCHEDULE_DELAY_MS = Math.max(parseInt(process.env.MARKETING_MIN_SCHEDULE_DELAY_MS || String(5 * 60 * 1000), 10), 60 * 1000);
const MAX_BULK_CAMPAIGN_ACTIONS = 100;
const MAX_BULK_REVIEW_ACTIONS = 25;
const MAX_CAROUSEL_ITEMS = 10;
const CAMPAIGN_OPEN_STATUSES = ["queued", "batch_running", "waiting_review", "approved_for_publish", "scheduled", "publishing"];
const PUBLIC_PRODUCT_CAMPAIGN_FIELDS = [
  "title slug status is_visible category subcategory category_id subcategory_id featured_image images",
  "is_affiliate affiliate_url affiliate_external_id affiliate_source_platform affiliate_source_mode brand_name source_type",
  "affiliate_asin affiliate_marketplace affiliate_tag affiliate_compliance_status affiliate_compliance_flags",
  "affiliate_link_check_status affiliate_link_failure_reason",
  "price price_status affiliate_data_source affiliate_data_expires_at archived_at",
  "affiliate_campaign_asset_url affiliate_campaign_usage_rights affiliate_image_provenance",
  "brand_name buying_intent pros cons short_description full_description tags campaign_label",
].join(" ");

let workerStarted = false;
const laneProcessing = new Set();
const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const TASK_LANES = {
  fast: { agents: ["intake", "strategy", "caption", "compliance", "tracking"], concurrency: Math.max(parseInt(process.env.MARKETING_FAST_CONCURRENCY || "3", 10), 1) },
  creative: { agents: ["creative"], concurrency: Math.max(parseInt(process.env.MARKETING_CREATIVE_CONCURRENCY || "1", 10), 1) },
  publish: { agents: ["publish", "carousel"], concurrency: Math.max(parseInt(process.env.MARKETING_PUBLISH_CONCURRENCY || "1", 10), 1) },
};

function getQueueLane(agentName) {
  if (agentName === "creative") return "creative";
  if (agentName === "publish" || agentName === "carousel") return "publish";
  return "fast";
}

function getTaskPriority(agentName) {
  if (["tracking", "compliance"].includes(agentName)) return 90;
  if (agentName === "publish" || agentName === "carousel") return 100;
  if (agentName === "creative") return 30;
  return 50;
}

function getActiveLeaseFilter(task) {
  return {
    _id: task._id,
    status: "running",
    lease_owner: workerId,
    attempt_count: Number(task.attempt_count || 0),
  };
}

function ownsActiveLease(task, latestTask) {
  return Boolean(
    latestTask
    && latestTask.status === "running"
    && String(latestTask.lease_owner || "") === workerId
    && Number(latestTask.attempt_count || 0) === Number(task.attempt_count || 0)
  );
}

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
  if (error.message) return error.code ? `${error.code}: ${String(error.message)}` : String(error.message);
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

function readinessIssue(code, message) {
  return { code, message };
}

function isAffiliateCarouselEnabled() {
  if (process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED != null) {
    return String(process.env.MARKETING_AFFILIATE_CAROUSEL_ENABLED).toLowerCase() === "true";
  }
  return process.env.NODE_ENV !== "production";
}

function assertAffiliateCarouselEnabled() {
  if (isAffiliateCarouselEnabled()) return;
  throw carouselError("carousel_creation_disabled", "Affiliate carousel publishing is currently disabled.");
}

async function assertCampaignReferenceReady(referenceImageUrl) {
  const settings = await getCampaignSettings();
  await readAndNormalizeReferenceImage(referenceImageUrl);
  await assertReferenceModelSupported(settings.campaign_ai_provider, settings.campaign_ai_model);
  return true;
}

async function resolveCurrentRunReferenceImage(run = {}) {
  const productId = getObjectIdString(run.public_product_id);
  const vendorProductId = getObjectIdString(run.vendor_product_id);
  const publicProduct = productId ? await Product.findById(productId).lean() : null;
  if (vendorProductId) {
    const vendorProduct = await VendorProduct.findById(vendorProductId).lean();
    return resolveVendorReferenceImage(vendorProduct || {}, publicProduct || {})
      || run.brief_json?.reference_image_url
      || run.brief_json?.campaign_asset?.url
      || null;
  }
  return resolveProductReferenceImage(publicProduct || {})
    || run.brief_json?.reference_image_url
    || run.brief_json?.campaign_asset?.url
    || null;
}

function getObjectIdString(value) {
  return value?._id?.toString?.() || value?.toString?.() || (value ? String(value) : null);
}

function isPopulatedProductSnapshot(product) {
  return Boolean(product && typeof product === "object" && (product._id || product.title || product.slug));
}

function isAffiliateCampaignRun(run = {}, product = null) {
  return Boolean(
    product?.is_affiliate
    || run.brief_json?.is_affiliate
    || run.source_event === "affiliate_product.published"
  );
}

function getRunPublishAssetUrls(run = {}) {
  const publishAssets = run?.tracking_json?.publish_payload?.asset_urls;
  if (Array.isArray(publishAssets) && publishAssets.length) return publishAssets.filter(Boolean);
  if (Array.isArray(run?.asset_urls) && run.asset_urls.length) return run.asset_urls.filter(Boolean);
  return [];
}

function getRunPublishCaption(run = {}) {
  return run?.tracking_json?.publish_payload?.caption
    || run?.caption_json?.instagram?.caption
    || run?.caption_json?.instagram?.long_caption
    || run?.caption_json?.instagram?.short_caption
    || "";
}

function describeAmazonValidationFlag(flag) {
  const messages = {
    affiliate_url_invalid: "Amazon affiliate URL is invalid.",
    amazon_short_link_rejected: "Amazon short links are not allowed for campaign publishing.",
    amazon_marketplace_unsupported: "Amazon affiliate URL marketplace is not supported.",
    amazon_marketplace_mismatch: "Amazon affiliate URL marketplace does not match the product marketplace.",
    amazon_asin_missing: "Amazon affiliate URL is missing a valid ASIN.",
    amazon_affiliate_tag_missing: "Amazon affiliate URL is missing the Associate tag.",
    amazon_affiliate_tag_not_configured: "The Associate tag for this marketplace is not configured.",
    amazon_affiliate_tag_mismatch: "Amazon affiliate URL tag does not match the configured Associate tag.",
  };
  return messages[flag] || `Amazon affiliate URL failed validation: ${flag}.`;
}

function buildRunPublishReadinessSnapshot(run = {}, product = null, {
  productWasFetched = false,
  requireApproval = true,
  allowPublishingState = false,
  allowPublishedState = false,
  carouselTaskId = null,
} = {}) {
  const blockers = [];
  const warnings = [];
  const isProductSnapshot = isPopulatedProductSnapshot(product);
  const productId = getObjectIdString(run.public_product_id);
  const isAffiliate = isAffiliateCampaignRun(run, product);
  const assetUrls = getRunPublishAssetUrls(run);

  if (run.archived_at || run.status === "archived") {
    blockers.push(readinessIssue("campaign_archived", "This campaign is archived. Restore it before continuing."));
  }
  if (!allowPublishedState && (run.instagram_media_id || run.publish_status === "published" || run.status === "published")) {
    blockers.push(readinessIssue("already_published", "This campaign run is already published."));
  }
  if (!allowPublishingState && (run.publish_status === "publishing" || run.status === "publishing")) {
    blockers.push(readinessIssue("already_publishing", "This campaign run is already publishing."));
  }
  const activeCarouselTaskId = getObjectIdString(run.carousel_task_id);
  if (activeCarouselTaskId && activeCarouselTaskId !== getObjectIdString(carouselTaskId)) {
    blockers.push(readinessIssue("carousel_conflict", "This campaign already belongs to another carousel."));
  }
  if (requireApproval && run.review_status !== "approved") {
    blockers.push(readinessIssue("review_not_approved", "Admin review approval is required before Instagram publishing."));
  }
  if (!run.tracking_json?.publish_payload) {
    blockers.push(readinessIssue("pipeline_incomplete", "Campaign generation and tracking must finish before review or publishing."));
  }
  if (!run.compliance_json) {
    blockers.push(readinessIssue("compliance_pending", "Campaign compliance checks have not completed."));
  } else if (!["approved", "approved_with_warnings"].includes(run.compliance_json.status)) {
    blockers.push(readinessIssue("compliance_blocked", "Resolve all blocking compliance issues before approval or publishing."));
  }
  const referenceImageUrl = run.brief_json?.reference_image_url
    || run.brief_json?.campaign_asset?.url
    || resolveProductReferenceImage(product || {});
  if (!referenceImageUrl) {
    blockers.push(readinessIssue("reference_image_required", "Product image required."));
  }
  if (run.creative_json && !run.creative_json.source_image_url && !run.creative_json.creative_json?.source_image_url) {
    blockers.push(readinessIssue("reference_image_not_used", "The generated creative is not linked to its required product reference image."));
  }
  if (!assetUrls.length) {
    blockers.push(readinessIssue("missing_assets", "No publish-ready Instagram creative image is available."));
  } else {
    const invalidMediaUrls = assetUrls.filter((url) => !isPublicMediaUrl(url));
    if (invalidMediaUrls.length) {
      blockers.push(readinessIssue("non_https_media_url", "Instagram creative media must be public HTTPS URLs."));
    }
  }

  if (productWasFetched && productId && !isProductSnapshot) {
    blockers.push(readinessIssue("product_missing", "The source product no longer exists."));
  }

  if (isProductSnapshot) {
    if (product.archived_at) {
      blockers.push(readinessIssue("product_archived", "The source product is archived."));
    }
    if (product.status !== "active") {
      blockers.push(readinessIssue("product_inactive", "The source product is not active."));
    }
    if (product.is_visible !== true) {
      blockers.push(readinessIssue("product_hidden", "The source product is hidden from the public catalog."));
    }
    if (isUncategorizedValue(product.category) || isUncategorizedValue(product.subcategory)) {
      blockers.push(readinessIssue("product_uncategorized", "The source product must have a category and subcategory."));
    }
  }

  if (isAffiliate) {
    if (String(process.env.AMAZON_ASSOCIATE_STATUS || "approved").toLowerCase() !== "approved") {
      blockers.push(readinessIssue("associate_account_unapproved", "Amazon Associate approval must be confirmed before publishing affiliate campaigns."));
    }
    if (!isProductSnapshot && productWasFetched) {
      blockers.push(readinessIssue("affiliate_product_missing", "Affiliate source product could not be revalidated."));
    }
    if (isProductSnapshot) {
      if ((product.source_type || "admin") !== "admin" || !product.is_affiliate) {
        blockers.push(readinessIssue("affiliate_source_invalid", "Campaign source must be an admin Amazon affiliate product."));
      }
      if (product.affiliate_compliance_status === "paused") {
        blockers.push(readinessIssue("affiliate_paused", "Affiliate product is paused and cannot be posted."));
      } else if (product.affiliate_compliance_status !== "compliant") {
        blockers.push(readinessIssue("affiliate_not_compliant", "Affiliate product compliance status is not compliant."));
      }
      if ((product.affiliate_compliance_flags || []).includes("admin_paused")) {
        blockers.push(readinessIssue("affiliate_paused", "Affiliate product was manually paused by admin."));
      }

      const validation = validateAmazonAffiliateUrl(product.affiliate_url, {
        marketplace: product.affiliate_marketplace || null,
        requireConfiguredTag: true,
      });
      if (!validation.isValid) {
        validation.flags.forEach((flag) => blockers.push(readinessIssue(flag, describeAmazonValidationFlag(flag))));
      }
      if (!product.affiliate_tag) {
        blockers.push(readinessIssue("affiliate_tag_missing", "Affiliate product is missing the stored Amazon Associate tag."));
      } else if (validation.affiliateTag && product.affiliate_tag !== validation.affiliateTag) {
        blockers.push(readinessIssue("affiliate_tag_mismatch", "Stored affiliate tag does not match the Amazon URL tag."));
      }

      const linkStatus = String(product.affiliate_link_check_status || "unchecked").toLowerCase();
      if (linkStatus === "failed" || linkStatus === "paused") {
        blockers.push(readinessIssue("affiliate_link_failed", product.affiliate_link_failure_reason || "Affiliate product link check failed."));
      } else if (linkStatus === "unchecked") {
        warnings.push(readinessIssue("affiliate_link_unchecked", "Affiliate link has not been checked recently."));
      }
      if (!["admin_confirmed", "owned", "licensed", "api_permitted"].includes(String(product.affiliate_campaign_usage_rights || "unknown"))) {
        warnings.push(readinessIssue("reference_rights_unconfirmed", "Product image usage rights are unconfirmed. Review this before publishing."));
      }
    }

    if (!hasAffiliateInstagramDisclosure(getRunPublishCaption(run))) {
      blockers.push(readinessIssue("affiliate_disclosure_missing", "Affiliate notice is required before approval or publishing."));
    }
  }

  const uniqueBlockers = Array.from(new Map(blockers.map((item) => [item.code, item])).values());
  const uniqueWarnings = Array.from(new Map(warnings.map((item) => [item.code, item])).values());
  return {
    can_publish: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    checked_at: new Date().toISOString(),
  };
}

async function buildCurrentRunPublishReadiness(run, options = {}) {
  const productId = getObjectIdString(run.public_product_id);
  const product = productId ? await Product.findById(productId).lean() : null;
  return buildRunPublishReadinessSnapshot(run, product, {
    ...options,
    productWasFetched: Boolean(productId),
  });
}

function formatReadinessBlockers(readiness, fallback = "Campaign is not ready to publish") {
  const messages = (readiness?.blockers || []).map((item) => item.message).filter(Boolean);
  return messages.length ? messages.join(" ") : fallback;
}

function assertPublishReadiness(readiness, fallback) {
  if (readiness?.can_publish) return;
  throw new Error(formatReadinessBlockers(readiness, fallback));
}

function assertReviewApprovalReadiness(readiness) {
  const blockers = (readiness?.blockers || []).filter((blocker) => ![
    "review_not_approved",
    "non_https_media_url",
  ].includes(blocker.code));
  if (!blockers.length) return;
  throw new Error(blockers.map((blocker) => blocker.message).join(" "));
}

function buildCarouselReadinessBlockers(runs = [], productMap = new Map(), {
  allowPublishingState = false,
  allowPublishedState = false,
  allowScheduledState = false,
  carouselTaskId = null,
} = {}) {
  return runs.flatMap((run) => {
    const productId = getObjectIdString(run.public_product_id);
    const product = productId ? productMap.get(productId) || null : null;
    const readiness = buildRunPublishReadinessSnapshot(run, product, {
      productWasFetched: Boolean(productId),
      requireApproval: true,
      allowPublishingState,
      allowPublishedState,
      carouselTaskId,
    });
    const blockers = [...readiness.blockers];
    if (!allowScheduledState && (run.status === "scheduled" || run.publish_status === "scheduled")) {
      blockers.push(readinessIssue("already_scheduled", "This campaign is already scheduled as an individual post."));
    }
    const assetUrls = getRunPublishAssetUrls(run);
    if (assetUrls.length !== 1) {
      blockers.push(readinessIssue("single_image_required", "Each carousel campaign must have exactly one publish-ready image."));
    }
    return blockers.map((blocker) => ({
      run_id: String(run._id),
      product_title: run.product_title || run.campaign_id,
      ...blocker,
    }));
  });
}

function validateAffiliateProductForCampaign(product = {}) {
  if (!product || !product._id) throw new Error("Affiliate product not found for campaign enqueue");
  if ((product.source_type || "admin") !== "admin") throw new Error("Only admin affiliate products can use this campaign queue");
  if (!product.is_affiliate) throw new Error("Product must be an affiliate product before campaign enqueue");
  if (!product.affiliate_url) throw new Error("Affiliate product must have an affiliate URL before campaign enqueue");
  if (product.archived_at) throw new Error("Archived affiliate products cannot create campaigns");
  if (product.status !== "active" || product.is_visible !== true) throw new Error("Only active visible affiliate products can create campaigns");
  if (isUncategorizedValue(product.category) || isUncategorizedValue(product.subcategory)) {
    throw new Error("Affiliate product must be assigned to a category before campaign enqueue");
  }
  const referenceImageUrl = resolveProductReferenceImage(product);
  if (!referenceImageUrl) {
    const error = new Error("Product image required.");
    error.code = "reference_image_required";
    throw error;
  }
  const readiness = buildRunPublishReadinessSnapshot({
    source_event: "affiliate_product.published",
    public_product_id: product._id,
    review_status: "approved",
    publish_status: "ready",
    asset_urls: ["https://pinkpaisa.in/placeholder-campaign-readiness.jpg"],
    brief_json: { is_affiliate: true, reference_image_url: referenceImageUrl },
    creative_json: { source_image_url: referenceImageUrl },
    compliance_json: { status: "approved", issues: [] },
    tracking_json: {
      publish_payload: {
        asset_urls: ["https://pinkpaisa.in/placeholder-campaign-readiness.jpg"],
        caption: ensureAffiliateInstagramDisclosure("Campaign validation", true),
      },
    },
  }, product, { productWasFetched: true, requireApproval: true });
  const blockers = readiness.blockers.filter((blocker) => !["missing_assets", "non_https_media_url", "pipeline_incomplete"].includes(blocker.code));
  if (blockers.length) throw new Error(blockers.map((blocker) => blocker.message).join(" "));
  return true;
}

function getSequence(agentName) {
  if (agentName === "carousel") return ALL_SEQUENCE.length;
  return ALL_SEQUENCE.indexOf(agentName) + 1;
}

function getNextAutoAgent(agentName) {
  if (agentName === "strategy") return "creative";
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

function buildStaleTaskRecoveryFilter(task, {
  force = false,
  now = new Date(),
  olderThanMs = STALE_TASK_THRESHOLD_MS,
} = {}) {
  const filter = {
    _id: task._id,
    status: "running",
    attempt_count: Number(task.attempt_count || 0),
  };
  if (force) return filter;
  if (task.lease_expires_at) {
    filter.lease_expires_at = { $lte: now };
    return filter;
  }
  filter.$and = [
    { $or: [{ lease_expires_at: null }, { lease_expires_at: { $exists: false } }] },
    { started_at: { $lte: new Date(now.getTime() - olderThanMs) } },
  ];
  return filter;
}

function serialiseTask(task) {
  return {
    id: String(task._id),
    campaign_run_id: String(task.campaign_run_id),
    campaign_id: task.campaign_id,
    agent_name: task.agent_name,
    sequence: task.sequence,
    status: task.status,
    queue_lane: task.queue_lane || getQueueLane(task.agent_name),
    priority: Number(task.priority ?? getTaskPriority(task.agent_name)),
    available_at: task.available_at || null,
    lease_owner: task.lease_owner || null,
    lease_expires_at: task.lease_expires_at || null,
    heartbeat_at: task.heartbeat_at || null,
    cancellation_requested: Boolean(task.cancellation_requested),
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
  const captionJson = isAffiliate && run.caption_json?.instagram
    ? {
      ...run.caption_json,
      instagram: Object.fromEntries(Object.entries(run.caption_json.instagram).map(([key, value]) => [
        key,
        ["caption", "short_caption", "long_caption"].includes(key) && typeof value === "string" && value.trim()
          ? ensureAffiliateInstagramDisclosure(value, true)
          : value,
      ])),
    }
    : run.caption_json || null;
  const trackingJson = isAffiliate && run.tracking_json?.publish_payload
    ? {
      ...run.tracking_json,
      publish_payload: {
        ...run.tracking_json.publish_payload,
        caption: typeof run.tracking_json.publish_payload.caption === "string" && run.tracking_json.publish_payload.caption.trim()
          ? ensureAffiliateInstagramDisclosure(run.tracking_json.publish_payload.caption, true)
          : run.tracking_json.publish_payload.caption,
      },
    }
    : run.tracking_json || null;
  const referenceImageUrl = brief.reference_image_url
    || brief.campaign_asset?.url
    || resolveProductReferenceImage(publicProduct)
    || productGalleryUrls[0]
    || null;
  const usedReferenceUrl = run.creative_json?.source_image_url || run.creative_json?.creative_json?.source_image_url || null;
  const referenceImageStatus = usedReferenceUrl
    ? "used"
    : run.last_error?.includes?.("reference_image_unavailable")
      ? "unavailable"
      : referenceImageUrl
        ? "available"
        : "required";
  const publishReadiness = buildRunPublishReadinessSnapshot(run, publicProduct, {
    productWasFetched: isPopulatedProductSnapshot(publicProduct),
    requireApproval: true,
  });

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
    affiliate_source_mode: publicProduct.affiliate_source_mode || brief.affiliate_source_mode || briefAffiliate.source_mode || null,
    status: run.status,
    current_stage: run.current_stage,
    review_stage: run.review_stage || null,
    review_notes: run.review_notes || null,
    review_status: run.review_status || null,
    content_type: run.content_type || null,
    cta_text: run.cta_text || null,
    asset_urls: run.asset_urls || [],
    product_image_url: referenceImageUrl,
    product_gallery_urls: productGalleryUrls,
    reference_image_url: referenceImageUrl,
    reference_image_status: referenceImageStatus,
    creative_json: run.creative_json || null,
    approved_at: run.approved_at || null,
    last_error: run.last_error || null,
    brief_json: run.brief_json || null,
    strategy_json: run.strategy_json || null,
    caption_json: captionJson,
    compliance_json: run.compliance_json || null,
    tracking_json: trackingJson,
    publish_status: run.publish_status || null,
    scheduled_for: run.scheduled_for || null,
    publish_attempted_at: run.publish_attempted_at || null,
    published_at: run.published_at || null,
    instagram_creation_id: run.instagram_creation_id || null,
    instagram_media_id: run.instagram_media_id || null,
    instagram_permalink: run.instagram_permalink || null,
    carousel_task_id: getObjectIdString(run.carousel_task_id),
    carousel_position: Number(run.carousel_position || 0) || null,
    carousel_size: Number(run.carousel_size || 0) || null,
    archived_at: run.archived_at || null,
    archived_by: run.archived_by?.toString?.() || run.archived_by || null,
    archive_reason: run.archive_reason || null,
    created_at: run.created_at || null,
    updated_at: run.updated_at || null,
    publish_readiness: publishReadiness,
    next_action: getRunNextAction(run, publishReadiness),
    task_counts: taskCounts || undefined,
  };
}

function getRunNextAction(run = {}, readiness = null) {
  if (run.archived_at || run.status === "archived") return "restore_campaign";
  if (run.status === "published" || run.publish_status === "published") return "open_instagram";
  if (/automatic retry is blocked|may have accepted this publish request/i.test(String(run.last_error || ""))) {
    return "verify_instagram_publish";
  }
  if (run.status === "publishing" || run.publish_status === "publishing") return "wait_for_publish";
  if (["queued", "running", "batch_running"].includes(run.status)) return `wait_for_${run.current_stage || "worker"}`;
  if (run.status === "waiting_review") return "review_draft";
  if (run.review_status === "approved" && readiness?.can_publish) return "publish_or_schedule";
  if (run.status === "failed" || run.publish_status === "failed") return "retry_failed_task";
  if (readiness?.blockers?.length) return "resolve_blockers";
  return "wait_for_worker";
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

function serialisePublishEvent(event) {
  if (!event) return null;
  return {
    id: String(event._id),
    campaign_run_id: event.campaign_run_id?.toString?.() || event.campaign_run_id || null,
    campaign_id: event.campaign_id || null,
    batch_run_id: event.batch_run_id?.toString?.() || event.batch_run_id || null,
    action_type: event.action_type,
    status: event.status,
    actor_admin_id: event.actor_admin_id?.toString?.() || event.actor_admin_id || null,
    source_event: event.source_event || null,
    product_title: event.product_title || null,
    content_type: event.content_type || null,
    instagram_creation_id: event.instagram_creation_id || null,
    instagram_media_id: event.instagram_media_id || null,
    instagram_permalink: event.instagram_permalink || null,
    error_message: event.error_message || null,
    readiness_snapshot: event.readiness_snapshot || null,
    metadata_json: event.metadata_json || null,
    created_at: event.created_at || null,
    updated_at: event.updated_at || null,
  };
}

async function recordPublishEvent(run, {
  actionType,
  status,
  actorAdminId = null,
  readinessSnapshot = null,
  publishResult = null,
  errorMessage = null,
  metadata = null,
} = {}) {
  if (!run?._id || !actionType || !status) return null;
  try {
    const event = await MarketingCampaignPublishEvent.create({
      campaign_run_id: run._id,
      campaign_id: run.campaign_id || null,
      batch_run_id: getObjectIdString(run.batch_run_id),
      action_type: actionType,
      status,
      actor_admin_id: actorAdminId || null,
      source_event: run.source_event || null,
      product_title: run.product_title || null,
      content_type: run.content_type || publishResult?.publish_payload?.content_type || null,
      instagram_creation_id: publishResult?.creation_id || run.instagram_creation_id || null,
      instagram_media_id: publishResult?.media_id || run.instagram_media_id || null,
      instagram_permalink: publishResult?.permalink || run.instagram_permalink || null,
      error_message: errorMessage || null,
      readiness_snapshot: readinessSnapshot || null,
      metadata_json: metadata || null,
    });
    return event;
  } catch (error) {
    logger.error({ err: error, campaignId: run.campaign_id }, "failed to record marketing campaign publish event");
    return null;
  }
}

function getCatalogProductReadiness(product = {}) {
  const blockers = [];
  const warnings = [];
  const status = product.status || "active";

  if (status !== "active") blockers.push(readinessIssue("product_inactive", "Product is not active."));
  if (product.is_visible === false) blockers.push(readinessIssue("product_hidden", "Product is hidden from public pages."));
  if (isUncategorizedValue(product.category) || isUncategorizedValue(product.subcategory)) {
    blockers.push(readinessIssue("product_uncategorized", "Product category and subcategory are required."));
  }
  if (!resolveProductReferenceImage(product)) {
    blockers.push(readinessIssue("reference_image_required", "Product image required."));
  }

  if (product.is_affiliate) {
    if (product.affiliate_compliance_status !== "compliant") {
      blockers.push(readinessIssue("affiliate_non_compliant", "Affiliate product is not compliant yet."));
    }
    if (!product.affiliate_tag) blockers.push(readinessIssue("affiliate_tag_missing", "Amazon Associate tag is missing."));
    if (!product.affiliate_url) blockers.push(readinessIssue("affiliate_url_missing", "Amazon affiliate URL is missing."));
    if (["failed", "paused"].includes(product.affiliate_link_check_status)) {
      blockers.push(readinessIssue("affiliate_link_failed", "Amazon affiliate link check failed or is paused."));
    }
    if (product.affiliate_link_check_status === "unchecked") {
      warnings.push(readinessIssue("affiliate_link_unchecked", "Amazon affiliate link has not been checked yet."));
    }
  }

  return {
    can_queue: blockers.length === 0,
    status: blockers.length ? "blocked" : warnings.length ? "warning" : "ready",
    blockers,
    warnings,
  };
}

function serialiseCatalogProduct(product) {
  const readiness = getCatalogProductReadiness(product);
  const referenceImageUrl = resolveProductReferenceImage(product);
  return {
    id: String(product._id),
    title: product.title,
    slug: product.slug || null,
    source_type: product.source_type || "admin",
    status: product.status || "active",
    is_visible: product.is_visible !== false,
    is_affiliate: Boolean(product.is_affiliate),
    affiliate_is_instagram_pick: Boolean(product.affiliate_is_instagram_pick),
    affiliate_compliance_status: product.affiliate_compliance_status || null,
    affiliate_link_check_status: product.affiliate_link_check_status || null,
    featured_image: referenceImageUrl,
    reference_image_url: referenceImageUrl,
    reference_image_status: referenceImageUrl ? "available" : "required",
    price: product.is_affiliate ? null : product.price,
    sale_price: product.is_affiliate ? null : product.sale_price,
    category: product.category || null,
    subcategory: product.subcategory || null,
    readiness_status: readiness.status,
    readiness,
  };
}

function shouldReturnExistingRunningBatch(batch, createdBatch = false) {
  if (!batch || batch.status !== "running" || createdBatch) return false;
  const assignedRuns = Array.isArray(batch.run_ids) ? batch.run_ids.length : 0;
  return assignedRuns > 0 || Number(batch.total_runs || 0) > 0;
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
  if (agentName === "creative") return { brief_json: run.brief_json || null };
  if (agentName === "caption") return { brief_json: run.brief_json || null, creative_json: run.creative_json || null };
  if (agentName === "compliance") return { brief_json: run.brief_json || null, caption_json: run.caption_json || null, creative_json: run.creative_json || null };
  if (agentName === "tracking") return { brief_json: run.brief_json || null, caption_json: run.caption_json || null, compliance_json: run.compliance_json || null, creative_json: run.creative_json || null };
  if (agentName === "publish") return { tracking_json: run.tracking_json || null, creative_json: run.creative_json || null, caption_json: run.caption_json || null };
  if (agentName === "carousel") return { grouped_run_ids: [], actor_admin_id: null };
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

function buildCarouselTrackingUrl(run) {
  const baseUrl = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://www.pinkpaisa.in").replace(/\/+$/, "");
  return `${baseUrl}/api/c/${encodeURIComponent(String(run?.campaign_id || ""))}`;
}

function getDefaultCarouselHashtags(runs = []) {
  const seen = new Set();
  const values = [];
  for (const hashtag of runs.flatMap((run) => run.caption_json?.instagram?.hashtags || [])) {
    const normalized = String(hashtag || "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || isAffiliateDisclosureHashtag(normalized) || seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
    if (values.length === 8) break;
  }
  return values;
}

function buildBulkCarouselCaption(runs) {
  if (runs.length < 2) {
    return ensureAffiliateInstagramDisclosure("A curated partner pick from Pink Paisa.", runs.some((run) => isAffiliateCampaignRun(run)));
  }
  return buildAffiliateCarouselCaption({
    items: runs.map((run) => ({
      run_id: String(run._id),
      product_title: run.product_title || "Partner pick",
      tracked_url: buildCarouselTrackingUrl(run),
    })),
    hashtags: getDefaultCarouselHashtags(runs),
  }).final_caption;
}

async function upsertTask(run, agentName, status = "queued") {
  const now = new Date();
  const update = {
    $set: {
      campaign_id: run.campaign_id,
      campaign_run_id: run._id,
      agent_name: agentName,
      sequence: getSequence(agentName),
      status,
      queue_lane: getQueueLane(agentName),
      priority: getTaskPriority(agentName),
      available_at: now,
      idempotency_key: `${agentName}:${String(run._id)}`,
      lease_owner: null,
      lease_expires_at: null,
      heartbeat_at: null,
      cancellation_requested: false,
      input_json: buildTaskInput(run, agentName),
      error_message: null,
      started_at: status === "running" ? now : null,
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
    instagram_child_creation_ids: [],
    instagram_media_id: null,
    instagram_permalink: null,
    published_urls: [],
    carousel_task_id: null,
    carousel_position: null,
    carousel_size: null,
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
    run.instagram_child_creation_ids = output.child_creation_ids || [];
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
    updates.instagram_child_creation_ids = output.child_creation_ids || [];
    updates.instagram_media_id = output.media_id || null;
    updates.instagram_permalink = output.permalink || null;
    updates.published_urls = run.asset_urls || [];
  }
  const updatedRun = await MarketingCampaignRun.findOneAndUpdate(
    { _id: run._id, archived_at: null, status: { $ne: "archived" } },
    { $set: updates },
    { new: true }
  );
  if (!updatedRun) return null;
  assignOutputToRunDoc(run, agentName, output);
  return updatedRun;
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
  const isPublishAgent = agentName === "publish" || agentName === "carousel";
  const updates = {
    status: "failed",
    current_stage: agentName,
    last_error: errorMessage,
    review_stage: null,
    publish_status: isPublishAgent ? "failed" : "not_ready",
  };
  if (isPublishAgent) updates.publish_attempted_at = new Date();

  const run = await MarketingCampaignRun.findOneAndUpdate(
    {
      _id: runId,
      archived_at: null,
      status: { $nin: ["archived", "published"] },
      publish_status: { $ne: "published" },
      instagram_media_id: null,
    },
    { $set: updates },
    { new: true }
  );
  await refreshBatchRun(run?.batch_run_id);
}

function buildOrphanPublishRecoveryUpdates(run = {}, attempt = null, recoveredAt = new Date()) {
  const durableAttempt = mergeAttemptWithRunPublishState(attempt, run);
  if (hasDurablePublishedAttempt(durableAttempt)) {
    return {
      status: "published",
      current_stage: "published",
      publish_status: "published",
      review_status: "approved",
      review_stage: null,
      last_error: null,
      published_at: run.published_at || durableAttempt.finished_at || recoveredAt,
      instagram_creation_id: durableAttempt.creation_id || run.instagram_creation_id || null,
      instagram_child_creation_ids: durableAttempt.child_creation_ids || run.instagram_child_creation_ids || [],
      instagram_media_id: durableAttempt.media_id,
      instagram_permalink: durableAttempt.permalink || run.instagram_permalink || null,
    };
  }

  const approved = run.review_status === "approved";
  return {
    status: approved ? "approved_for_publish" : "waiting_review",
    current_stage: approved ? "approved_for_publish" : "ready_for_review",
    publish_status: approved ? "ready" : "draft",
    review_stage: approved ? null : (run.review_stage || "draft"),
    scheduled_for: null,
    last_error: "Recovered an interrupted publish request before Instagram accepted any media.",
  };
}

async function recoverOrphanedPublishingRuns({
  olderThanMs = STALE_TASK_THRESHOLD_MS,
  limit = 20,
} = {}) {
  const recoveredAt = new Date();
  const cutoff = new Date(recoveredAt.getTime() - Math.max(Number(olderThanMs || 0), 60 * 1000));
  const runs = await MarketingCampaignRun.find({
    instagram_media_id: null,
    archived_at: null,
    $or: [{ status: "publishing" }, { publish_status: "publishing" }],
    publish_attempted_at: { $lte: cutoff },
  }).sort({ publish_attempted_at: 1 }).limit(Math.max(Number(limit || 1), 1));

  const recoveredRunIds = [];
  for (const run of runs) {
    const activeTask = await AgentTask.exists({
      ...buildPublishTaskMembershipQuery(run._id),
      status: { $in: ["queued", "running"] },
    });
    if (activeTask) continue;

    const attempt = await MarketingPublishAttempt.findOne({
      $or: [{ campaign_run_id: run._id }, { group_run_ids: run._id }],
    }).sort({ updated_at: -1 });
    if (isUnresolvedPublishAttempt(attempt)) continue;

    const updates = buildOrphanPublishRecoveryUpdates(run, attempt, recoveredAt);
    const recovered = await MarketingCampaignRun.findOneAndUpdate(
      {
        _id: run._id,
        instagram_media_id: null,
        archived_at: null,
        $or: [{ status: "publishing" }, { publish_status: "publishing" }],
        publish_attempted_at: { $lte: cutoff },
      },
      { $set: updates },
      { new: true }
    );
    if (!recovered) continue;
    recoveredRunIds.push(String(recovered._id));
    await recordPublishEvent(recovered, {
      actionType: "reset",
      status: "success",
      metadata: { automatic_orphan_recovery: true },
    });
    await refreshBatchRun(recovered.batch_run_id);
  }

  if (recoveredRunIds.length) {
    logger.warn({ recoveredRunIds }, "recovered orphaned campaign publish states");
  }
  return { recovered_count: recoveredRunIds.length, campaign_run_ids: recoveredRunIds };
}

async function recoverStaleRunningTasks({
  campaignRunId = null,
  force = false,
  olderThanMs = STALE_TASK_THRESHOLD_MS,
  errorMessage = "",
} = {}) {
  const now = new Date();
  const query = { status: "running" };
  if (campaignRunId) query.campaign_run_id = campaignRunId;
  if (!force) {
    query.$or = [
      { lease_expires_at: { $lte: now } },
      {
        $and: [
          { $or: [{ lease_expires_at: null }, { lease_expires_at: { $exists: false } }] },
          { started_at: { $lte: new Date(Date.now() - olderThanMs) } },
        ],
      },
    ];
  }

  const staleTasks = await AgentTask.find(query).sort({ started_at: 1, created_at: 1 });
  if (!staleTasks.length) {
    return { recovered_count: 0, campaign_run_ids: [] };
  }

  const recoveredAt = new Date();
  const recoveredRunIds = new Set();
  let recoveredCount = 0;

  for (const task of staleTasks) {
    const staleMessage = buildStaleTaskMessage(task, recoveredAt, errorMessage);
    const run = await MarketingCampaignRun.findById(task.campaign_run_id);
    const groupedRunIds = task.agent_name === "carousel"
      ? normalizeRunIdList(task.input_json?.grouped_run_ids || [])
      : [];
    const publishAttempt = run && ["publish", "carousel"].includes(task.agent_name)
      ? await MarketingPublishAttempt.findOne({ campaign_run_id: run._id }).catch(() => null)
      : null;
    const effectivePublishAttempt = run ? mergeAttemptWithRunPublishState(publishAttempt, run) : publishAttempt;
    const publishLifecycle = getPublishAttemptLifecycleState(effectivePublishAttempt);
    const uncertainPublishOutcome = publishLifecycle.outcome_uncertain;
    let hasRecoverableCarouselPublish = false;
    if (groupedRunIds.length && run) {
      const frozenComposition = task.input_json?.carousel || null;
      const publishPayload = frozenComposition?.publish_payload || (frozenComposition ? {
        content_type: "carousel",
        asset_urls: (frozenComposition.items || []).map((item) => item.asset_url),
        caption: frozenComposition.final_caption,
      } : null);
      if (publishPayload) {
        hasRecoverableCarouselPublish = isMatchingDurableCarouselAttempt(effectivePublishAttempt, groupedRunIds, publishPayload);
      }
    }
    const shouldCancel = Boolean(run?.archived_at || run?.status === "archived" || task.cancellation_requested);
    const externalCancellationBlocked = shouldCancel && publishLifecycle.has_external_work;
    const message = uncertainPublishOutcome
      ? publishOutcomeUncertainError().message
      : externalCancellationBlocked
        ? "Publishing cancellation could not be completed because Instagram container creation had already started."
        : staleMessage;
    const attemptsExhausted = Number(task.attempt_count || 0) >= MAX_TASK_ATTEMPTS
      && !force
      && !hasRecoverableCarouselPublish;
    const nextStatus = uncertainPublishOutcome || externalCancellationBlocked
      ? "failed"
      : shouldCancel
        ? "cancelled"
        : attemptsExhausted ? "failed" : "queued";
    const recoveredTask = await AgentTask.findOneAndUpdate(buildStaleTaskRecoveryFilter(task, {
      force,
      now: recoveredAt,
      olderThanMs,
    }), {
      $set: {
        status: nextStatus,
        error_message: message,
        finished_at: nextStatus === "queued" ? null : recoveredAt,
        available_at: recoveredAt,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        cancellation_requested: nextStatus === "cancelled",
      },
    }, { new: true });
    if (!recoveredTask) continue;
    if (uncertainPublishOutcome && publishAttempt?._id) {
      await MarketingPublishAttempt.updateOne(
        { _id: publishAttempt._id, media_id: null, status: { $ne: "published" } },
        { $set: { status: "uncertain", last_error: message, finished_at: recoveredAt } }
      );
    }
    recoveredCount += 1;
    if (task.agent_name === "carousel" && groupedRunIds.length) {
      if (uncertainPublishOutcome || externalCancellationBlocked) {
        await MarketingCampaignRun.updateMany(
          {
            _id: { $in: groupedRunIds },
            archived_at: null,
            instagram_media_id: null,
            publish_status: { $ne: "published" },
          },
          {
            $set: {
              status: "failed",
              current_stage: "publish",
              publish_status: "failed",
              last_error: message,
              publish_attempted_at: recoveredAt,
            },
          }
        );
      } else if (shouldCancel) {
        await restoreQueuedCarouselMembers(recoveredTask, "Carousel publishing was cancelled during stale-task recovery.");
      } else if (attemptsExhausted) {
        await MarketingCampaignRun.updateMany(
          {
            _id: { $in: groupedRunIds },
            archived_at: null,
            instagram_media_id: null,
            publish_status: { $ne: "published" },
          },
          {
            $set: {
              status: "failed",
              current_stage: "publish",
              publish_status: "failed",
              last_error: message,
              publish_attempted_at: recoveredAt,
            },
          }
        );
      } else {
        await MarketingCampaignRun.updateMany(
          {
            _id: { $in: groupedRunIds },
            archived_at: null,
            instagram_media_id: null,
            publish_status: { $ne: "published" },
          },
          {
            $set: {
              status: "publishing",
              current_stage: "queued_for_carousel_publish",
              publish_status: "publishing",
              last_error: null,
            },
          }
        );
      }
      for (const groupedRunId of groupedRunIds) recoveredRunIds.add(groupedRunId);
      const groupedBatchIds = await MarketingCampaignRun.distinct("batch_run_id", { _id: { $in: groupedRunIds }, batch_run_id: { $ne: null } });
      await Promise.all(groupedBatchIds.map((batchId) => refreshBatchRun(batchId)));
    } else if (uncertainPublishOutcome || externalCancellationBlocked || attemptsExhausted) {
      await markRunFailed(task.campaign_run_id, task.agent_name, message);
    } else if (!shouldCancel && run) {
      run.status = task.agent_name === "publish" ? "publishing" : "batch_running";
      run.current_stage = task.agent_name;
      run.last_error = null;
      await run.save();
    }
    recoveredRunIds.add(String(task.campaign_run_id));
  }

  return {
    recovered_count: recoveredCount,
    campaign_run_ids: Array.from(recoveredRunIds),
  };
}

async function advanceRun(run, agentName, output) {
  if (agentName === "publish") return;

  const transitionFilter = {
    _id: run._id,
    archived_at: null,
    status: { $nin: ["archived", "published"] },
    current_stage: agentName,
  };
  const nextAgent = getNextAutoAgent(agentName);
  if (!nextAgent) {
    const updated = await MarketingCampaignRun.findOneAndUpdate(transitionFilter, {
      $set: {
        status: "waiting_review",
        current_stage: "ready_for_review",
        review_stage: "draft",
        review_status: "pending",
        review_notes: output?.review_reason || run.compliance_json?.review_reason || "Draft ready. Review the reference, generated image, and caption before approving.",
        publish_status: "draft",
        last_error: null,
      },
    }, { new: true });
    if (!updated) return;
    await refreshBatchRun(updated.batch_run_id);
    return;
  }

  const freshRun = await MarketingCampaignRun.findOneAndUpdate(transitionFilter, {
    $set: {
      status: "batch_running",
      current_stage: nextAgent,
      review_stage: null,
      review_notes: null,
      publish_status: "not_ready",
      last_error: null,
    },
  }, { new: true });
  if (!freshRun) return;
  await upsertTask(freshRun, nextAgent, "queued");
}

function normalizeRunIdList(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => getObjectIdString(value))
    .filter(Boolean)))
    .sort();
}

function normalizeBulkCampaignRunIds(values = []) {
  const runIds = normalizeRunIdList(values);
  if (!runIds.length) throw new Error("Select at least one campaign");
  if (runIds.length > MAX_BULK_CAMPAIGN_ACTIONS) {
    throw new Error(`Select no more than ${MAX_BULK_CAMPAIGN_ACTIONS} campaigns at once`);
  }
  return runIds;
}

function normalizeBulkReviewRunIds(values = []) {
  const runIds = normalizeRunIdList(values);
  if (!runIds.length) throw new Error("Select at least one campaign to approve");
  if (runIds.length > MAX_BULK_REVIEW_ACTIONS) {
    throw new Error(`Select no more than ${MAX_BULK_REVIEW_ACTIONS} campaigns to approve at once`);
  }
  return runIds;
}

async function collectBulkCampaignReviewResults(runIds, reviewOne) {
  const results = [];
  for (const runId of runIds) {
    try {
      const run = await reviewOne(runId);
      results.push({
        id: runId,
        campaign_id: run?.campaign_id || null,
        product_title: run?.product_title || null,
        review_status: run?.review_status || null,
        ok: true,
      });
    } catch (error) {
      results.push({
        id: runId,
        ok: false,
        code: error.code || "campaign_approval_failed",
        message: error.message || "Campaign could not be approved",
      });
    }
  }
  return {
    requested: runIds.length,
    approved: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

function sameRunIdSet(left = [], right = []) {
  const normalizedLeft = normalizeRunIdList(left);
  const normalizedRight = normalizeRunIdList(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function buildPublishPayloadIdentity(publishPayload = {}) {
  const contentType = publishPayload.content_type || "single_image";
  const assetUrls = Array.isArray(publishPayload.asset_urls) ? publishPayload.asset_urls.map(String) : [];
  const captionHash = crypto.createHash("sha256").update(String(publishPayload.caption || "")).digest("hex");
  const payloadFingerprint = crypto.createHash("sha256").update(JSON.stringify({
    content_type: contentType,
    asset_urls: assetUrls,
    caption_hash: captionHash,
  })).digest("hex");
  return { contentType, assetUrls, captionHash, payloadFingerprint };
}

function hasDurablePublishedAttempt(attempt) {
  return Boolean(attempt?.media_id);
}

function isUnresolvedPublishAttempt(attempt) {
  return Boolean(
    attempt
    && !attempt.media_id
    && ["container_created", "publishing", "uncertain"].includes(String(attempt.status || ""))
  );
}

function getPublishAttemptLifecycleState(attempt) {
  const status = String(attempt?.status || "");
  const hasCreationId = Boolean(attempt?.creation_id);
  const hasChildCreationIds = Array.isArray(attempt?.child_creation_ids) && attempt.child_creation_ids.length > 0;
  const hasMediaId = Boolean(attempt?.media_id);
  const outcomeUncertain = Boolean(
    !hasMediaId
    && (status === "uncertain" || (status === "publishing" && hasCreationId))
  );
  return {
    status,
    has_creation_id: hasCreationId,
    has_child_creation_ids: hasChildCreationIds,
    has_media_id: hasMediaId,
    has_external_work: hasMediaId || hasCreationId || hasChildCreationIds || isUnresolvedPublishAttempt(attempt),
    outcome_uncertain: outcomeUncertain,
  };
}

function publishOutcomeUncertainError() {
  const error = new Error(
    "Instagram may have accepted this publish request. Verify the Instagram account before any manual reconciliation; automatic retry is blocked to prevent a duplicate post."
  );
  error.code = "instagram_publish_outcome_uncertain";
  error.details = { instagram_outcome_uncertain: true };
  return error;
}

function buildPublishAttemptFailureUpdates(error, attempt, message, finishedAt = new Date()) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  const lifecycle = getPublishAttemptLifecycleState(attempt);
  const hasExplicitOutcome = Object.prototype.hasOwnProperty.call(details, "instagram_outcome_uncertain");
  const outcomeUncertain = hasExplicitOutcome
    ? Boolean(details.instagram_outcome_uncertain)
    : lifecycle.outcome_uncertain;
  const updates = {
    status: outcomeUncertain ? "uncertain" : "failed",
    last_error: message,
    finished_at: finishedAt,
  };

  if (outcomeUncertain) return updates;
  if (!details.container_failure_terminal) return updates;

  const stage = String(details.instagram_publish_stage || "");
  if (stage === "child_container") {
    const failedIndex = Number(details.failed_child_index);
    const childIds = Array.isArray(details.child_creation_ids)
      ? details.child_creation_ids
      : attempt?.child_creation_ids || [];
    updates.creation_id = null;
    updates.child_creation_ids = Number.isInteger(failedIndex) && failedIndex >= 0
      ? childIds.slice(0, failedIndex)
      : [];
  } else if (stage === "parent_container") {
    updates.creation_id = null;
    updates.child_creation_ids = Array.isArray(details.child_creation_ids)
      ? details.child_creation_ids
      : attempt?.child_creation_ids || [];
  } else if (stage === "single_container") {
    updates.creation_id = null;
    updates.child_creation_ids = [];
  }

  return updates;
}

async function markPublishAttemptFailure(runId, error, message, finishedAt = new Date()) {
  const attempt = await MarketingPublishAttempt.findOne({
    campaign_run_id: runId,
    media_id: null,
    status: { $ne: "published" },
  });
  if (!attempt) return null;
  const updates = buildPublishAttemptFailureUpdates(error, attempt, message, finishedAt);
  Object.assign(attempt, updates);
  await attempt.save();
  return attempt;
}

async function assertCarouselLifecycleMutable(task, action) {
  const attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: task.campaign_run_id }).lean();
  const lifecycle = getPublishAttemptLifecycleState(attempt);
  if (lifecycle.has_external_work) {
    throw carouselError(
      lifecycle.outcome_uncertain ? "carousel_publish_uncertain" : "carousel_conflict",
      lifecycle.outcome_uncertain
        ? publishOutcomeUncertainError().message
        : `Carousel cannot be ${action} after Instagram container creation has started.`
    );
  }
  return attempt;
}

async function assertPublishOutcomeResolved(runId) {
  const attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: runId }).lean();
  if (getPublishAttemptLifecycleState(attempt).outcome_uncertain) {
    throw publishOutcomeUncertainError();
  }
  return attempt;
}

function buildPublishResultFromAttempt(attempt, publishPayload = {}) {
  return {
    content_type: attempt?.content_type || publishPayload.content_type || "single_image",
    creation_id: attempt?.creation_id || null,
    child_creation_ids: attempt?.child_creation_ids || [],
    media_id: attempt?.media_id || null,
    permalink: attempt?.permalink || null,
    publish_payload: publishPayload,
    resumed: true,
    skipped_duplicate_publish: true,
  };
}

function mergeAttemptWithRunPublishState(attempt, run = {}) {
  if (hasDurablePublishedAttempt(attempt) || !run.instagram_media_id) return attempt;
  const attemptSnapshot = attempt?.toObject ? attempt.toObject() : { ...(attempt || {}) };
  return {
    ...attemptSnapshot,
    status: "published",
    creation_id: attemptSnapshot.creation_id || run.instagram_creation_id || null,
    child_creation_ids: attemptSnapshot.child_creation_ids?.length
      ? attemptSnapshot.child_creation_ids
      : run.instagram_child_creation_ids || [],
    media_id: run.instagram_media_id,
    permalink: attemptSnapshot.permalink || run.instagram_permalink || null,
    finished_at: attemptSnapshot.finished_at || run.published_at || null,
  };
}

async function getOrCreatePublishAttempt(run, publishPayload, { groupedRunIds = [] } = {}) {
  const { contentType, assetUrls, captionHash, payloadFingerprint } = buildPublishPayloadIdentity(publishPayload);
  const normalizedGroupRunIds = normalizeRunIdList(groupedRunIds);
  let attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: run._id });

  if (!attempt) {
    attempt = new MarketingPublishAttempt({
        campaign_run_id: run._id,
        campaign_id: run.campaign_id,
        idempotency_key: `instagram:${String(run._id)}:${payloadFingerprint}`,
        status: "queued",
        content_type: contentType,
        group_run_ids: normalizedGroupRunIds,
        asset_urls: assetUrls,
        caption_hash: captionHash,
        payload_fingerprint: payloadFingerprint,
        attempt_count: 0,
    });
  } else if (hasDurablePublishedAttempt(attempt)) {
    if (attempt.payload_fingerprint && attempt.payload_fingerprint !== payloadFingerprint) {
      throw new Error("Published Instagram attempt does not match the current campaign payload");
    }
    if (normalizedGroupRunIds.length && !sameRunIdSet(attempt.group_run_ids, normalizedGroupRunIds)) {
      throw new Error("Published Instagram carousel attempt does not match the selected campaigns");
    }
    return attempt;
  } else if (getPublishAttemptLifecycleState(attempt).outcome_uncertain) {
    throw publishOutcomeUncertainError();
  } else if (attempt.payload_fingerprint !== payloadFingerprint) {
    attempt.idempotency_key = `instagram:${String(run._id)}:${payloadFingerprint}`;
    attempt.status = "queued";
    attempt.content_type = contentType;
    attempt.group_run_ids = normalizedGroupRunIds;
    attempt.asset_urls = assetUrls;
    attempt.caption_hash = captionHash;
    attempt.payload_fingerprint = payloadFingerprint;
    attempt.creation_id = null;
    attempt.child_creation_ids = [];
    attempt.media_id = null;
    attempt.permalink = null;
    attempt.started_at = null;
    attempt.finished_at = null;
  } else {
    attempt.status = attempt.creation_id || attempt.child_creation_ids?.length ? "container_created" : "queued";
    attempt.group_run_ids = normalizedGroupRunIds;
  }

  attempt.last_error = null;
  attempt.attempt_count = Number(attempt.attempt_count || 0) + 1;
  await attempt.save();
  return attempt;
}

async function persistPublishProgress(run, attempt, progress = {}, { groupedRunIds = [] } = {}) {
  const normalizedGroupRunIds = normalizeRunIdList(groupedRunIds);
  const updates = {
    status: progress.status || attempt.status,
    creation_id: progress.creation_id || attempt.creation_id || null,
    child_creation_ids: progress.child_creation_ids || attempt.child_creation_ids || [],
    media_id: progress.media_id || attempt.media_id || null,
    permalink: progress.permalink || attempt.permalink || null,
    last_error: null,
  };
  if (["container_created", "publishing"].includes(updates.status)) updates.started_at = attempt.started_at || new Date();
  if (updates.status === "published") updates.finished_at = new Date();
  if (normalizedGroupRunIds.length) updates.group_run_ids = normalizedGroupRunIds;
  Object.assign(attempt, updates);
  await attempt.save();
  const targetRunIds = normalizedGroupRunIds.length ? normalizedGroupRunIds : [run._id];
  const runUpdates = {
    instagram_creation_id: updates.creation_id,
    instagram_child_creation_ids: updates.child_creation_ids,
    ...(updates.media_id ? { instagram_media_id: updates.media_id } : {}),
    ...(updates.permalink ? { instagram_permalink: updates.permalink } : {}),
  };
  if (updates.status === "published" && updates.media_id) {
    Object.assign(runUpdates, {
      status: "published",
      current_stage: "published",
      review_status: "approved",
      review_stage: null,
      publish_status: "published",
      scheduled_for: null,
      last_error: null,
      published_at: updates.finished_at,
    });
  }
  await MarketingCampaignRun.updateMany({ _id: { $in: targetRunIds } }, { $set: runUpdates });
}

async function reconcileDurablePublishedTask(task, run, errorMessage = "") {
  const attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: run._id });
  const latestRun = await MarketingCampaignRun.findById(run._id);
  const durableAttempt = mergeAttemptWithRunPublishState(attempt, latestRun || run);
  if (!hasDurablePublishedAttempt(durableAttempt)) return false;

  const publishPayload = task.output_json?.publish_payload
    || run.tracking_json?.publish_payload
    || {};
  const output = buildPublishResultFromAttempt(durableAttempt, publishPayload);

  try {
    const appliedRun = latestRun?.archived_at || latestRun?.status === "archived"
      ? latestRun
      : await applyOutputToRun(latestRun || run, "publish", output);
    if (attempt?._id) {
      await MarketingPublishAttempt.updateOne(
        { _id: attempt._id },
        {
          $set: {
            status: "published",
            creation_id: output.creation_id,
            child_creation_ids: output.child_creation_ids,
            media_id: output.media_id,
            permalink: output.permalink,
            last_error: null,
            finished_at: durableAttempt.finished_at || new Date(),
          },
        }
      );
    }
    await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
      $set: {
        status: "completed",
        output_json: output,
        error_message: null,
        finished_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
      },
    });
    await recordPublishEvent(appliedRun || latestRun || run, {
      actionType: "publish",
      status: "success",
      publishResult: output,
      metadata: {
        task_id: String(task._id),
        reconciled_after_error: true,
        bookkeeping_error: errorMessage || null,
      },
    });
    await refreshBatchRun((appliedRun || latestRun || run).batch_run_id);
  } catch (reconcileError) {
    logger.error({
      err: reconcileError,
      campaignId: run.campaign_id,
      taskId: task._id,
      instagramMediaId: durableAttempt.media_id,
    }, "Instagram publish succeeded but local finalization must be retried");
    await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
      $set: {
        status: "queued",
        available_at: new Date(Date.now() + 5000),
        error_message: "Instagram published successfully; retrying local finalization.",
        finished_at: null,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
      },
    }).catch(() => null);
  }
  return true;
}

async function executeTask(task) {
  const run = await MarketingCampaignRun.findById(task.campaign_run_id);
  if (!run) {
    await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
      $set: {
        status: "failed",
        finished_at: new Date(),
        error_message: "Campaign run not found",
      },
    });
    return;
  }

  const freshTask = await AgentTask.findById(task._id).lean();
  if (!ownsActiveLease(task, freshTask)) return;
  if (run.archived_at || run.status === "archived" || freshTask?.cancellation_requested) {
    await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
      $set: {
        status: "cancelled",
        error_message: "Task cancelled because the campaign was archived.",
        finished_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
      },
    });
    return;
  }

  try {
    await ensureRunInputs(run, task.agent_name);

    let output = task.output_json || null;
    if (!output && ["intake", "strategy", "creative", "caption", "compliance", "tracking"].includes(task.agent_name)) {
      output = await runAgentForStage(run, task.agent_name);
    }
    if (!output && task.agent_name === "publish") {
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
        const readiness = await buildCurrentRunPublishReadiness(run, { requireApproval: true, allowPublishingState: true });
        assertPublishReadiness(readiness, "Campaign is not ready for Instagram publishing");
        const attempt = await getOrCreatePublishAttempt(run, publishPayload);
        if (hasDurablePublishedAttempt(attempt)) {
          output = buildPublishResultFromAttempt(attempt, publishPayload);
        } else {
          const publishResult = await publishInstagramDraft({
            contentType: publishPayload.content_type,
            assetUrls: publishPayload.asset_urls,
            caption: publishPayload.caption,
            resumeState: {
              creation_id: attempt.creation_id || run.instagram_creation_id || null,
              child_creation_ids: attempt.child_creation_ids || run.instagram_child_creation_ids || [],
              media_id: attempt.media_id || run.instagram_media_id || null,
              permalink: attempt.permalink || run.instagram_permalink || null,
            },
            onProgress: (progress) => persistPublishProgress(run, attempt, progress),
          });
          output = {
            ...publishResult,
            publish_payload: publishPayload,
          };
        }
      }
    }
    if (!output && task.agent_name === "carousel") {
      output = await publishCampaignRunsAsCarousel(task.input_json?.grouped_run_ids || [], {
        actorAdminId: task.input_json?.actor_admin_id || null,
        executeNow: true,
        carouselTask: task,
      });
    }
    if (!output) throw new Error(`No handler configured for agent ${task.agent_name}`);

    const [latestTaskState, latestRunState] = await Promise.all([
      AgentTask.findById(task._id).select("cancellation_requested status lease_owner attempt_count").lean(),
      MarketingCampaignRun.findById(run._id).select("archived_at status").lean(),
    ]);
    if (!ownsActiveLease(task, latestTaskState)) return;
    if (latestTaskState?.cancellation_requested || latestRunState?.archived_at || latestRunState?.status === "archived") {
      await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
        $set: {
          status: "cancelled",
          error_message: "Task result discarded because the campaign was archived.",
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
        },
      });
      return;
    }

    const checkpointedTask = await AgentTask.findOneAndUpdate({
      ...getActiveLeaseFilter(task),
      cancellation_requested: { $ne: true },
    }, {
      $set: {
        output_json: output,
        heartbeat_at: new Date(),
        lease_expires_at: new Date(Date.now() + TASK_LEASE_MS),
      },
    }, { new: true });
    if (!checkpointedTask) return;

    const appliedRun = await applyOutputToRun(run, task.agent_name, output);
    if (!appliedRun) {
      await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
        $set: {
          status: "cancelled",
          error_message: "Task result discarded because the campaign was archived.",
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
        },
      });
      return;
    }

    if (task.agent_name === "publish" && output.media_id) {
      await MarketingPublishAttempt.updateOne(
        { campaign_run_id: run._id },
        {
          $set: {
            status: "published",
            creation_id: output.creation_id || null,
            child_creation_ids: output.child_creation_ids || [],
            media_id: output.media_id,
            permalink: output.permalink || null,
            last_error: null,
            finished_at: new Date(),
          },
        }
      );
    }

    if (!["carousel", "publish"].includes(task.agent_name)) {
      await advanceRun(appliedRun, task.agent_name, output);
    }

    if (task.agent_name === "publish") {
      await recordPublishEvent(appliedRun, {
        actionType: "publish",
        status: output?.skipped_duplicate_publish ? "skipped" : "success",
        publishResult: output,
        readinessSnapshot: await buildCurrentRunPublishReadiness(appliedRun, {
          requireApproval: true,
          allowPublishingState: true,
        }).catch(() => null),
        metadata: {
          task_id: String(task._id),
          automatic: task.input_json?.automatic || false,
        },
      }).catch((error) => {
        logger.error({ err: error, campaignId: run.campaign_id, taskId: task._id }, "failed to record successful Instagram publish event");
      });
    }

    const completedTask = await AgentTask.findOneAndUpdate({
      ...getActiveLeaseFilter(task),
      cancellation_requested: { $ne: true },
    }, {
      $set: {
        status: "completed",
        finished_at: new Date(),
        error_message: null,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
      },
    }, { new: true });
    if (!completedTask) return;

    if (task.agent_name === "carousel") return;
    if (task.agent_name === "publish") {
      await refreshBatchRun(appliedRun.batch_run_id);
      return;
    }
  } catch (error) {
    const message = describeExecutionError(error);
    if (task.agent_name === "publish") {
      const reconciled = await reconcileDurablePublishedTask(task, run, message).catch((reconcileError) => {
        logger.error({ err: reconcileError, campaignId: run.campaign_id, taskId: task._id }, "failed to inspect durable Instagram publish state");
        return false;
      });
      if (reconciled) return;
    }
    const failedTask = await AgentTask.findOneAndUpdate(getActiveLeaseFilter(task), {
      $set: {
        status: "failed",
        error_message: message,
        finished_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
      },
    }, { new: true });
    if (!failedTask) {
      logger.warn({ taskId: task._id, campaignId: run.campaign_id }, "discarded failure from a worker that no longer owns the task lease");
      return;
    }
    if (task.agent_name === "carousel") {
      if (!error.details?.carousel_runs_finalized) {
        const groupedRunIds = normalizeRunIdList(task.input_json?.grouped_run_ids || []);
        await MarketingCampaignRun.updateMany(
          { _id: { $in: groupedRunIds }, instagram_media_id: null },
          { $set: { status: "failed", current_stage: "publish", publish_status: "failed", last_error: message, publish_attempted_at: new Date() } }
        );
        const groupedRuns = await MarketingCampaignRun.find({ _id: { $in: groupedRunIds } });
        for (const groupedRun of groupedRuns) {
          await recordPublishEvent(groupedRun, {
            actionType: "carousel_publish",
            status: "failed",
            actorAdminId: task.input_json?.actor_admin_id || null,
            errorMessage: message,
            metadata: { task_id: String(task._id), selected_run_ids: groupedRunIds },
          });
        }
      }
    } else {
      await markRunFailed(run._id, task.agent_name, message);
    }
    if (task.agent_name === "publish") {
      await markPublishAttemptFailure(run._id, error, message).catch(() => null);
      const failedRun = await MarketingCampaignRun.findById(run._id);
      await recordPublishEvent(failedRun || run, {
        actionType: "failed_publish",
        status: "failed",
        errorMessage: message,
        readinessSnapshot: failedRun
          ? await buildCurrentRunPublishReadiness(failedRun, { requireApproval: true, allowPublishingState: true }).catch(() => null)
          : null,
        metadata: { task_id: String(task._id) },
      });
    }
  }
}

function buildLaneClaimQuery(lane, now = new Date()) {
  const laneConfig = TASK_LANES[lane];
  return {
    status: "queued",
    cancellation_requested: { $ne: true },
    $and: [
      { $or: [{ available_at: { $lte: now } }, { available_at: null }, { available_at: { $exists: false } }] },
      {
        $or: [
          { queue_lane: lane },
          { queue_lane: { $exists: false }, agent_name: { $in: laneConfig.agents } },
          { queue_lane: null, agent_name: { $in: laneConfig.agents } },
        ],
      },
    ],
  };
}

async function claimQueuedTask(lane) {
  const now = new Date();
  return AgentTask.findOneAndUpdate(
    buildLaneClaimQuery(lane, now),
    {
      $set: {
        status: "running",
        queue_lane: lane,
        lease_owner: workerId,
        lease_expires_at: new Date(now.getTime() + TASK_LEASE_MS),
        heartbeat_at: now,
        started_at: now,
        finished_at: null,
        error_message: null,
      },
      $inc: { attempt_count: 1 },
    },
    { sort: { priority: -1, created_at: 1 }, new: true }
  );
}

async function executeClaimedTask(task) {
  const executionStartedAt = Date.now();
  const baseLog = {
    campaignId: task.campaign_id,
    taskId: String(task._id),
    stage: task.agent_name,
    queueLane: task.queue_lane || getQueueLane(task.agent_name),
    queueAgeMs: task.created_at ? Math.max(executionStartedAt - new Date(task.created_at).getTime(), 0) : null,
    attempt: Number(task.attempt_count || 0),
    workerId,
  };
  logger.info(baseLog, "marketing task started");
  const heartbeat = setInterval(() => {
    const now = new Date();
    void AgentTask.updateOne(
      getActiveLeaseFilter(task),
      { $set: { heartbeat_at: now, lease_expires_at: new Date(now.getTime() + TASK_LEASE_MS) } }
    ).catch((error) => logger.error({ err: error, taskId: task._id }, "marketing task heartbeat failed"));
  }, Math.max(Math.floor(TASK_LEASE_MS / 3), 15000));
  heartbeat.unref?.();
  try {
    await executeTask(task);
  } finally {
    clearInterval(heartbeat);
    const finalTask = await AgentTask.findById(task._id)
      .select("status output_json error_message")
      .lean()
      .catch(() => null);
    const creativeMetadata = finalTask?.output_json?.creative_json || {};
    const logData = {
      ...baseLog,
      status: finalTask?.status || "unknown",
      durationMs: Date.now() - executionStartedAt,
      provider: creativeMetadata.provider || null,
      model: creativeMetadata.model || null,
      error: finalTask?.error_message || null,
    };
    if (finalTask?.status === "failed") logger.error(logData, "marketing task failed");
    else if (finalTask?.status === "cancelled") logger.warn(logData, "marketing task cancelled");
    else logger.info(logData, "marketing task finished");
  }
}

async function processQueueLane(lane, limit = TASK_LANES[lane]?.concurrency || 1) {
  if (!TASK_LANES[lane] || laneProcessing.has(lane)) return 0;
  laneProcessing.add(lane);
  try {
    const claimed = [];
    for (let index = 0; index < limit; index += 1) {
      const task = await claimQueuedTask(lane);
      if (!task) break;
      claimed.push(task);
    }
    await Promise.all(claimed.map(executeClaimedTask));
    return claimed.length;
  } finally {
    laneProcessing.delete(lane);
  }
}

async function processQueuedTasks(maxTasks = 5) {
  await recoverExpiredCarouselCompositions().catch((error) => {
    logger.error({ err: error }, "failed to recover expired carousel composition leases");
  });
  await recoverCancelledCarouselMemberships().catch((error) => {
    logger.error({ err: error }, "failed to recover cancelled carousel memberships");
  });
  await recoverStaleRunningTasks().catch((error) => {
    logger.error({ err: error }, "failed to recover stale marketing tasks");
  });
  await recoverOrphanedPublishingRuns().catch((error) => {
    logger.error({ err: error }, "failed to recover orphaned campaign publish states");
  });
  const lanes = Object.keys(TASK_LANES);
  const results = await Promise.all(lanes.map((lane) => processQueueLane(
    lane,
    Math.min(TASK_LANES[lane].concurrency, Math.max(Number(maxTasks || 1), 1))
  )));
  return results.reduce((sum, count) => sum + Number(count || 0), 0);
}

async function queueTask(runId, agentName) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");

  await upsertTask(run, agentName, "queued");
  return getCampaignRunDetail(runId);
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

  await assertCampaignReferenceReady(resolveVendorReferenceImage(vendorProduct, publicProduct));

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

  await assertCampaignReferenceReady(resolveProductReferenceImage(product));

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

  await assertCampaignReferenceReady(resolveProductReferenceImage(product));

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
  let createdBatch = false;
  if (!batch) {
    try {
      batch = await DailyBatchRun.create({
        batch_key: batchKey,
        batch_date_ist: batchDateIst,
        trigger_type: triggerType,
        status: "running",
        started_at: new Date(),
      });
      createdBatch = true;
    } catch (error) {
      if (error?.code === 11000) {
        batch = await DailyBatchRun.findOne({ batch_key: batchKey });
      } else {
        throw error;
      }
    }
  }

  if (shouldReturnExistingRunningBatch(batch, createdBatch)) {
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

  return serialiseBatchRun(batch);
}

async function getLatestDailyBatchRun() {
  const batch = await DailyBatchRun.findOne().sort({ created_at: -1 }).lean();
  return serialiseBatchRun(batch);
}

async function reviewCampaignRun(runId, action, notes = "", { actorAdminId = null, bulk = false } = {}) {
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
    await Promise.all([
      refreshBatchRun(run.batch_run_id),
      recordPublishEvent(run, {
        actionType: "review",
        status: "success",
        actorAdminId,
        metadata: { action: "reject", bulk: Boolean(bulk), notes: notes || null },
      }),
    ]);
    return serialiseRun(run);
  }

  if (action !== "approve") throw new Error("Unsupported review action");

  const readiness = await buildCurrentRunPublishReadiness(run, { requireApproval: false });
  assertReviewApprovalReadiness(readiness);

  run.status = "approved_for_publish";
  run.current_stage = "approved_for_publish";
  run.review_notes = notes || null;
  run.review_status = "approved";
  run.review_stage = null;
  run.last_error = null;
  run.publish_status = "ready";
  await run.save();
  await Promise.all([
    refreshBatchRun(run.batch_run_id),
    recordPublishEvent(run, {
      actionType: "review",
      status: "success",
      actorAdminId,
      readinessSnapshot: readiness,
      metadata: { action: "approve", bulk: Boolean(bulk), notes: notes || null },
    }),
  ]);
  return serialiseRun(run);
}

async function reviewCampaignRuns(runIds, { notes = "", actorAdminId = null } = {}) {
  const normalizedRunIds = normalizeBulkReviewRunIds(runIds);
  const reviewNotes = String(notes || "").trim().slice(0, 1000);
  return collectBulkCampaignReviewResults(
    normalizedRunIds,
    (runId) => reviewCampaignRun(runId, "approve", reviewNotes, { actorAdminId, bulk: true })
  );
}

async function retryCampaignRun(runId, { actorAdminId = null } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.carousel_task_id) throw carouselError("carousel_conflict", "Retry this campaign from its carousel controls.");
  const failedTask = await AgentTask.findOne({ campaign_run_id: runId, status: "failed" }).sort({ updated_at: -1 });
  if (!failedTask) throw new Error("No failed task found for this campaign");
  if (failedTask.agent_name === "publish") await assertPublishOutcomeResolved(run._id);

  run.status = failedTask.agent_name === "publish" ? "publishing" : "batch_running";
  run.current_stage = failedTask.agent_name;
  run.review_stage = null;
  run.last_error = null;
  run.publish_status = failedTask.agent_name === "publish" ? "publishing" : "not_ready";
  await run.save();
  await recordPublishEvent(run, {
    actionType: "retry",
    status: "started",
    actorAdminId,
    metadata: { agent_name: failedTask.agent_name },
  });

  if (failedTask.agent_name === "publish") {
    return queueTask(runId, "publish");
  }

  await upsertTask(run, failedTask.agent_name, "queued");
  return serialiseRun(run);
}

async function resetStuckCampaignRun(runId, { actorAdminId = null } = {}) {
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

  await recordPublishEvent(run, {
    actionType: "reset",
    status: "success",
    actorAdminId,
    metadata: recovery,
  });

  return getCampaignRunDetail(runId);
}

async function regenerateCampaignRun(runId, stage = "creative", { actorAdminId = null } = {}) {
  const validStages = ["intake", "strategy", "creative", "caption", "compliance", "tracking"];
  if (!validStages.includes(stage)) throw new Error("Unsupported regenerate stage");

  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.carousel_task_id) throw carouselError("carousel_conflict", "Cancel the active carousel before regenerating this campaign.");
  if (["publishing", "published"].includes(run.status)) throw new Error("Cannot regenerate a campaign that is already publishing or published");
  await assertPublishOutcomeResolved(run._id);
  if (["intake", "creative"].includes(stage)) {
    await assertCampaignReferenceReady(await resolveCurrentRunReferenceImage(run));
  }

  const reset = {
    last_error: null,
    review_stage: null,
    review_notes: null,
    review_status: "pending",
    status: "batch_running",
    current_stage: stage,
    ...clearPublishState(),
  };

  if (["intake"].includes(stage)) reset.brief_json = null;
  if (["intake", "strategy"].includes(stage)) reset.strategy_json = null;
  if (["intake", "strategy", "creative"].includes(stage)) {
    reset.creative_json = null;
    reset.asset_urls = [];
    reset.cta_text = null;
    reset.content_type = "single_image";
  }
  if (["intake", "strategy", "creative", "caption"].includes(stage)) reset.caption_json = null;
  if (["intake", "strategy", "creative", "caption", "compliance"].includes(stage)) reset.compliance_json = null;
  if (["intake", "strategy", "creative", "caption", "compliance", "tracking"].includes(stage)) reset.tracking_json = null;

  Object.assign(run, reset);
  await run.save();

  const affectedAgents = ALL_SEQUENCE.slice(ALL_SEQUENCE.indexOf(stage));
  await AgentTask.deleteMany({
    campaign_run_id: run._id,
    agent_name: { $in: affectedAgents.filter((agent) => agent !== stage) },
  });
  await upsertTask(run, stage, "queued");
  await recordPublishEvent(run, {
    actionType: "regenerate",
    status: "started",
    actorAdminId,
    metadata: { stage },
  });

  return getCampaignRunDetail(runId);
}

async function updateCampaignDraft(runId, payload = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.carousel_task_id) throw carouselError("carousel_conflict", "Cancel the active carousel before editing this campaign.");
  if (["publishing", "published"].includes(run.status)) throw new Error("Published campaigns cannot be edited");
  await assertPublishOutcomeResolved(run._id);

  const nextCaption = { ...(run.caption_json || {}) };
  const instagram = { ...(nextCaption.instagram || {}) };
  if (payload.caption != null) {
    instagram.caption = String(payload.caption).trim();
    delete instagram.long_caption;
    delete instagram.short_caption;
  }
  if (payload.long_caption != null) instagram.long_caption = String(payload.long_caption).trim();
  if (payload.short_caption != null) instagram.short_caption = String(payload.short_caption).trim();
  if (payload.cta_text != null) instagram.cta = String(payload.cta_text).trim();
  if (Array.isArray(payload.hashtags)) instagram.hashtags = payload.hashtags.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  const isAffiliate = isAffiliateCampaignRun(run);
  if (isAffiliate) {
    if (instagram.caption) instagram.caption = ensureAffiliateInstagramDisclosure(instagram.caption, true);
    if (instagram.long_caption) instagram.long_caption = ensureAffiliateInstagramDisclosure(instagram.long_caption, true);
    if (instagram.short_caption) instagram.short_caption = ensureAffiliateInstagramDisclosure(instagram.short_caption, true);
  }
  nextCaption.instagram = instagram;

  run.caption_json = nextCaption;
  run.cta_text = payload.cta_text != null ? String(payload.cta_text).trim() : (run.cta_text || instagram.cta || null);
  run.compliance_json = await runComplianceAgent(run);
  run.tracking_json = await runTrackingAgent(run, { overflowMode: "error" });
  run.status = "waiting_review";
  run.current_stage = "ready_for_review";
  run.review_stage = "draft";
  run.review_status = "pending";
  run.review_notes = "Caption changed. Review the updated post before publishing.";
  run.publish_status = "draft";
  run.scheduled_for = null;
  run.last_error = null;
  await run.save();
  return getCampaignRunDetail(runId);
}

async function scheduleCampaignRun(runId, scheduledFor, { actorAdminId = null } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.carousel_task_id) throw carouselError("carousel_conflict", "This campaign belongs to a carousel and cannot be scheduled individually.");
  await assertPublishOutcomeResolved(run._id);
  if (run.review_status !== "approved" || !["ready", "failed", "draft", "scheduled"].includes(run.publish_status)) {
    throw new Error("Campaign must be review-approved before scheduling");
  }

  const scheduleDate = new Date(scheduledFor);
  if (Number.isNaN(scheduleDate.getTime())) throw new Error("Invalid schedule time");
  if (scheduleDate.getTime() <= Date.now() + MIN_SCHEDULE_DELAY_MS) {
    throw new Error(`Schedule time must be at least ${Math.round(MIN_SCHEDULE_DELAY_MS / 60000)} minutes in the future`);
  }

  const readiness = await buildCurrentRunPublishReadiness(run, { requireApproval: true });
  assertPublishReadiness(readiness, "Campaign is not ready to schedule for Instagram publishing");

  run.status = "scheduled";
  run.current_stage = "scheduled_for_publish";
  run.publish_status = "scheduled";
  run.scheduled_for = scheduleDate;
  run.last_error = null;
  await run.save();
  await recordPublishEvent(run, {
    actionType: "schedule",
    status: "success",
    actorAdminId,
    readinessSnapshot: readiness,
    metadata: { scheduled_for: scheduleDate.toISOString() },
  });
  const detail = await getCampaignRunDetail(runId);
  return detail.run;
}

function buildPublishTaskMembershipQuery(runId) {
  return {
    agent_name: { $in: ["publish", "carousel"] },
    $or: [
      { campaign_run_id: runId },
      { "input_json.grouped_run_ids": getObjectIdString(runId) },
    ],
  };
}

async function cancelQueuedPublishTasksForRun(run, now = new Date()) {
  const queuedTasks = await AgentTask.find({
    ...buildPublishTaskMembershipQuery(run._id),
    status: "queued",
  }).select("_id input_json");
  const cancelledGroupRunIds = new Set();
  const cancelledGroupTaskIds = [];

  for (const task of queuedTasks) {
    const cancelled = await AgentTask.findOneAndUpdate(
      { _id: task._id, status: "queued" },
      {
        $set: {
          status: "cancelled",
          cancellation_requested: true,
          finished_at: now,
          error_message: "Campaign archived by admin before Instagram publishing started.",
        },
      }
    );
    if (!cancelled) continue;
    const groupedRunIds = normalizeRunIdList(task.input_json?.grouped_run_ids);
    groupedRunIds.forEach((id) => cancelledGroupRunIds.add(id));
    if (groupedRunIds.length) cancelledGroupTaskIds.push(String(task._id));
  }

  const otherGroupRunIds = Array.from(cancelledGroupRunIds).filter((id) => id !== String(run._id));
  if (otherGroupRunIds.length) {
    await MarketingCampaignRun.updateMany(
      {
        _id: { $in: otherGroupRunIds },
        status: { $in: ["publishing", "scheduled"] },
        publish_status: { $in: ["publishing", "scheduled"] },
        instagram_media_id: null,
        archived_at: null,
      },
      {
        $set: {
          status: "approved_for_publish",
          current_stage: "approved_for_publish",
          publish_status: "ready",
          scheduled_for: null,
          content_type: "single_image",
          carousel_task_id: null,
          carousel_position: null,
          carousel_size: null,
          last_error: "Queued carousel publishing was cancelled because one selected campaign was archived.",
          publish_attempted_at: null,
        },
      }
    );
  }
  if (cancelledGroupRunIds.size) {
    const affectedRuns = await MarketingCampaignRun.find({ _id: { $in: Array.from(cancelledGroupRunIds) } });
    for (const affectedRun of affectedRuns) {
      await recordPublishEvent(affectedRun, {
        actionType: "carousel_cancel",
        status: "success",
        metadata: {
          task_ids: cancelledGroupTaskIds,
          selected_run_ids: Array.from(cancelledGroupRunIds),
          cancelled_by_archive: String(affectedRun._id) === String(run._id),
        },
      });
    }
  }
  return queuedTasks.length;
}

async function archiveCampaignRun(runId, { actorAdminId = null, reason = "" } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.archived_at) return getCampaignRunDetail(runId);

  const now = new Date();
  const activePublishTask = await AgentTask.findOne({
    ...buildPublishTaskMembershipQuery(run._id),
    status: "running",
  }).select("_id agent_name lease_owner lease_expires_at");
  const publishAttempt = await MarketingPublishAttempt.findOne({
    $or: [
      { campaign_run_id: run._id },
      { group_run_ids: run._id },
    ],
  }).sort({ updated_at: -1 });
  const durableMediaId = publishAttempt?.media_id || run.instagram_media_id || null;
  if (!durableMediaId && (activePublishTask || getPublishAttemptLifecycleState(publishAttempt).has_external_work)) {
    throw new Error("Wait for the current Instagram publish attempt to finish before archiving");
  }

  if (run.carousel_task_id) {
    const carouselTask = await AgentTask.findOne({ _id: run.carousel_task_id, agent_name: "carousel" });
    if (carouselTask && ["failed", "cancelled"].includes(carouselTask.status)) {
      await AgentTask.updateOne(
        { _id: carouselTask._id, status: { $in: ["failed", "cancelled"] } },
        { $set: { status: "cancelled", cancellation_requested: true, finished_at: now } }
      );
      await restoreQueuedCarouselMembers(
        carouselTask,
        "Carousel membership was released because one selected campaign was archived."
      );
    }
  }
  await cancelQueuedPublishTasksForRun(run, now);
  if (hasDurablePublishedAttempt(publishAttempt)) {
    run.instagram_creation_id = publishAttempt.creation_id || run.instagram_creation_id || null;
    run.instagram_child_creation_ids = publishAttempt.child_creation_ids || run.instagram_child_creation_ids || [];
    run.instagram_media_id = publishAttempt.media_id;
    run.instagram_permalink = publishAttempt.permalink || run.instagram_permalink || null;
    run.publish_status = "published";
    run.published_at = run.published_at || publishAttempt.finished_at || now;
  }

  run.archived_from_status = run.publish_status === "published" ? "published" : run.status;
  run.archived_at = now;
  run.archived_by = actorAdminId || null;
  run.archive_reason = String(reason || "").trim() || null;
  run.status = "archived";
  run.current_stage = "archived";
  run.scheduled_for = null;
  if (run.publish_status !== "published") {
    run.publish_status = "draft";
    run.content_type = "single_image";
    run.carousel_task_id = null;
    run.carousel_position = null;
    run.carousel_size = null;
  }
  await run.save();

  await Promise.all([
    AgentTask.updateMany(
      { campaign_run_id: run._id, status: "queued" },
      { $set: { status: "cancelled", cancellation_requested: true, finished_at: now, error_message: "Campaign archived by admin." } }
    ),
    AgentTask.updateMany(
      { campaign_run_id: run._id, status: "running" },
      { $set: { cancellation_requested: true } }
    ),
  ]);
  await recordPublishEvent(run, {
    actionType: "archive",
    status: "success",
    actorAdminId,
    metadata: { reason: run.archive_reason, archived_from_status: run.archived_from_status },
  });
  return getCampaignRunDetail(runId);
}

async function archiveCampaignRuns(runIds, { actorAdminId = null, reason = "" } = {}) {
  const normalizedRunIds = normalizeBulkCampaignRunIds(runIds);
  const results = [];

  for (const runId of normalizedRunIds) {
    try {
      const detail = await archiveCampaignRun(runId, { actorAdminId, reason });
      results.push({
        id: runId,
        campaign_id: detail.run?.campaign_id || null,
        published: detail.run?.publish_status === "published" || Boolean(detail.run?.instagram_media_id),
        ok: true,
      });
    } catch (error) {
      results.push({ id: runId, ok: false, message: error.message });
    }
  }

  return {
    requested: normalizedRunIds.length,
    archived: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}

async function restoreCampaignRun(runId, { actorAdminId = null } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (!run.archived_at) throw new Error("Campaign is not archived");

  const priorStatus = run.archived_from_status || "queued";
  if (run.instagram_media_id || run.publish_status === "published") {
    run.status = "published";
    run.current_stage = "published";
    run.publish_status = "published";
  } else if (priorStatus === "waiting_review") {
    run.status = "waiting_review";
    run.current_stage = "ready_for_review";
    run.publish_status = "draft";
  } else if (["approved_for_publish", "scheduled"].includes(priorStatus)) {
    run.status = "approved_for_publish";
    run.current_stage = "approved_for_publish";
    run.publish_status = "ready";
    run.scheduled_for = null;
  } else if (["failed", "rejected"].includes(priorStatus)) {
    run.status = priorStatus;
    run.current_stage = priorStatus;
  } else {
    run.status = "queued";
    run.current_stage = "queued_for_daily_batch";
    run.batch_key = null;
    run.batch_run_id = null;
    run.review_status = "pending";
    run.review_stage = null;
    run.publish_status = "not_ready";
    await AgentTask.deleteMany({ campaign_run_id: run._id, status: { $ne: "completed" } });
  }
  run.archived_at = null;
  run.archived_by = null;
  run.archive_reason = null;
  run.archived_from_status = null;
  run.last_error = null;
  await run.save();
  await recordPublishEvent(run, {
    actionType: "restore",
    status: "success",
    actorAdminId,
    metadata: { restored_from_status: priorStatus },
  });
  return getCampaignRunDetail(runId);
}

function buildCampaignAssetReferenceQuery(assetUrl, excludedRunId) {
  return {
    _id: { $ne: excludedRunId },
    $or: [
      { asset_urls: assetUrl },
      { published_urls: assetUrl },
      { "creative_json.primary_asset_url": assetUrl },
      { "creative_json.asset_urls": assetUrl },
      { "tracking_json.publish_payload.asset_urls": assetUrl },
    ],
  };
}

async function purgeCampaignRun(runId, { actorAdminId = null } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (!run.archived_at || run.status !== "archived") throw new Error("Archive the campaign before permanent deletion");
  if (run.instagram_media_id || run.published_at || run.publish_status === "published") {
    throw new Error("Published campaigns must remain as audit records and can only be archived");
  }
  const runningTasks = await AgentTask.countDocuments({ campaign_run_id: run._id, status: "running" });
  if (runningTasks) throw new Error("Wait for running campaign tasks to stop before permanent deletion");

  const assets = await MarketingAsset.find({ campaign_run_id: run._id, deleted_at: null });
  for (const asset of assets) {
    const referencedRun = await MarketingCampaignRun.findOne(
      buildCampaignAssetReferenceQuery(asset.url, run._id)
    ).select("_id campaign_id").lean();
    if (referencedRun) {
      asset.campaign_run_id = referencedRun._id;
      asset.campaign_id = referencedRun.campaign_id;
      await asset.save();
      continue;
    }
    await deleteCampaignAsset(asset.toObject());
    asset.deleted_at = new Date();
    await asset.save();
  }
  logger.info({ campaignId: run.campaign_id, actorAdminId, assetCount: assets.length }, "campaign permanently purged");
  await Promise.all([
    AgentTask.deleteMany({ campaign_run_id: run._id }),
    MarketingCampaignPublishEvent.deleteMany({ campaign_run_id: run._id }),
    MarketingPublishAttempt.deleteMany({ campaign_run_id: run._id }),
    MarketingAsset.deleteMany({ campaign_run_id: run._id }),
  ]);
  await MarketingCampaignRun.deleteOne({ _id: run._id });
  return { deleted: true, id: String(run._id), campaign_id: run.campaign_id };
}

async function publishCampaignRunNow(runId, { actorAdminId = null } = {}) {
  const run = await MarketingCampaignRun.findById(runId);
  if (!run) throw new Error("Campaign run not found");
  if (run.carousel_task_id) {
    throw carouselError("carousel_conflict", "This campaign belongs to a carousel. Manage publishing from the carousel controls.");
  }
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
  await assertPublishOutcomeResolved(run._id);
  const readiness = await buildCurrentRunPublishReadiness(run, { requireApproval: true });
  assertPublishReadiness(readiness, "Campaign is not ready for Instagram publishing");

  run.status = "publishing";
  run.current_stage = "publish";
  run.publish_status = "publishing";
  run.scheduled_for = null;
  run.last_error = null;
  run.publish_attempted_at = new Date();
  await run.save();
  await recordPublishEvent(run, {
    actionType: "publish",
    status: "started",
    actorAdminId,
    readinessSnapshot: readiness,
  });

  return queueTask(runId, "publish");
}

function normalizeOrderedCarouselRunIds(runIds = []) {
  if (!Array.isArray(runIds)) {
    throw carouselError("carousel_selection_invalid", "Carousel run_ids must be an array.");
  }
  const normalized = runIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (normalized.length < 2 || normalized.length > MAX_CAROUSEL_ITEMS) {
    throw carouselError("carousel_selection_invalid", "Select between 2 and 10 affiliate campaigns.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw carouselError("carousel_selection_invalid", "A campaign can appear only once in a carousel.");
  }
  if (normalized.some((id) => !/^[0-9a-fA-F]{24}$/.test(id))) {
    throw carouselError("carousel_selection_invalid", "One or more selected campaign IDs are invalid.");
  }
  return normalized;
}

function buildCarouselGroupIdentity(runIds = []) {
  return `carousel:${[...normalizeOrderedCarouselRunIds(runIds)].sort().join(":")}`;
}

function parseCarouselScheduleDate(scheduledFor) {
  if (scheduledFor == null || scheduledFor === "") return null;
  const scheduleDate = new Date(scheduledFor);
  if (Number.isNaN(scheduleDate.getTime())) {
    throw carouselError("invalid_schedule_time", "Invalid carousel schedule time.");
  }
  if (scheduleDate.getTime() <= Date.now() + MIN_SCHEDULE_DELAY_MS) {
    throw carouselError(
      "invalid_schedule_time",
      `Schedule time must be at least ${Math.round(MIN_SCHEDULE_DELAY_MS / 60000)} minutes in the future.`
    );
  }
  return scheduleDate;
}

function uniqueCarouselIssues(issues = []) {
  return Array.from(new Map(issues.map((issue) => [
    `${issue.run_id || "carousel"}:${issue.code}`,
    issue,
  ])).values());
}

async function buildAffiliateCarouselPreview(runIds = [], {
  captionBody,
  hashtags,
  frozenComposition = null,
  carouselTaskId = null,
  allowScheduledState = false,
  allowPublishingState = false,
  allowPublishedState = false,
} = {}) {
  assertAffiliateCarouselEnabled();
  const orderedRunIds = normalizeOrderedCarouselRunIds(runIds);
  const runs = await MarketingCampaignRun.find({ _id: { $in: orderedRunIds } });
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  const orderedRuns = orderedRunIds.map((id) => runMap.get(id)).filter(Boolean);
  if (orderedRuns.length !== orderedRunIds.length) {
    const missingIds = orderedRunIds.filter((id) => !runMap.has(id));
    throw carouselError("carousel_selection_invalid", `Campaign runs not found: ${missingIds.join(", ")}.`);
  }

  const productIds = Array.from(new Set(orderedRuns.map((run) => getObjectIdString(run.public_product_id)).filter(Boolean)));
  const products = productIds.length ? await Product.find({ _id: { $in: productIds } }).lean() : [];
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const nonAffiliateRun = orderedRuns.find((run) => {
    const product = productMap.get(getObjectIdString(run.public_product_id));
    return !isAffiliateCampaignRun(run, product) || run.source_event !== "affiliate_product.published";
  });
  if (nonAffiliateRun) {
    throw carouselError(
      "carousel_affiliate_only",
      `${nonAffiliateRun.product_title || nonAffiliateRun.campaign_id} is not an affiliate campaign. Affiliate carousels cannot mix product sources.`
    );
  }

  const blockers = buildCarouselReadinessBlockers(orderedRuns, productMap, {
    allowPublishingState,
    allowPublishedState,
    allowScheduledState,
    carouselTaskId,
  });
  const warnings = [];
  const frozenItemMap = new Map(
    (Array.isArray(frozenComposition?.items) ? frozenComposition.items : [])
      .map((item) => [String(item?.run_id || ""), item])
  );
  if (frozenComposition && frozenItemMap.size !== orderedRunIds.length) {
    blockers.push(readinessIssue("carousel_payload_invalid", "Stored carousel slide data does not match the selected campaigns."));
  }

  const items = orderedRuns.map((run, index) => {
    const runId = String(run._id);
    const product = productMap.get(getObjectIdString(run.public_product_id)) || null;
    const currentAssetUrl = getRunPrimaryAssetUrl(run);
    const expectedTrackedUrl = buildCarouselTrackingUrl(run);
    const frozenItem = frozenItemMap.get(runId);
    const item = frozenItem
      ? {
        run_id: runId,
        campaign_id: run.campaign_id,
        product_title: frozenItem.product_title,
        asset_url: frozenItem.asset_url,
        tracked_url: frozenItem.tracked_url,
      }
      : {
        run_id: runId,
        campaign_id: run.campaign_id,
        product_title: run.product_title || product?.title || `Partner pick ${index + 1}`,
        asset_url: currentAssetUrl,
        tracked_url: expectedTrackedUrl,
      };

    if (!product?.slug) {
      blockers.push({
        run_id: runId,
        product_title: run.product_title || run.campaign_id,
        ...readinessIssue("tracking_destination_missing", "Affiliate product is missing its Pink Paisa product-page destination."),
      });
    }
    if (frozenItem && frozenItem.asset_url !== currentAssetUrl) {
      blockers.push({
        run_id: runId,
        product_title: run.product_title || run.campaign_id,
        ...readinessIssue("carousel_asset_changed", "The approved campaign image changed after the carousel was composed."),
      });
    }
    if (frozenItem && frozenItem.tracked_url !== expectedTrackedUrl) {
      blockers.push({
        run_id: runId,
        product_title: run.product_title || run.campaign_id,
        ...readinessIssue("carousel_tracking_changed", "The Pink Paisa carousel tracking link changed after review."),
      });
    }

    const readiness = buildRunPublishReadinessSnapshot(run, product, {
      productWasFetched: Boolean(getObjectIdString(run.public_product_id)),
      requireApproval: true,
      allowPublishingState,
      allowPublishedState,
      carouselTaskId,
    });
    readiness.warnings.forEach((warning) => warnings.push({
      run_id: runId,
      product_title: run.product_title || run.campaign_id,
      ...warning,
    }));
    return item;
  });

  const selectedHashtags = hashtags === undefined
    ? (frozenComposition?.hashtags || getDefaultCarouselHashtags(orderedRuns))
    : hashtags;
  const selectedCaptionBody = captionBody === undefined
    ? (frozenComposition?.caption_body ?? DEFAULT_AFFILIATE_CAROUSEL_CAPTION)
    : captionBody;
  let composition = null;
  try {
    composition = buildAffiliateCarouselCaption({
      captionBody: selectedCaptionBody,
      items,
      hashtags: selectedHashtags,
    });
    const canonicalFrozenCaption = frozenComposition?.final_caption
      ? ensureAffiliateInstagramDisclosure(stripAffiliateInstagramDisclosure(frozenComposition.final_caption), true)
      : null;
    if (canonicalFrozenCaption && composition.final_caption !== canonicalFrozenCaption) {
      blockers.push(readinessIssue("carousel_caption_changed", "The stored carousel caption no longer matches its reviewed payload."));
    }
  } catch (error) {
    blockers.push(readinessIssue(error.code || "carousel_caption_invalid", error.message));
  }

  const uniqueBlockers = uniqueCarouselIssues(blockers);
  return {
    can_publish: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    warnings: uniqueCarouselIssues(warnings),
    carousel: composition || {
      caption_body: String(selectedCaptionBody || ""),
      hashtags: Array.isArray(selectedHashtags) ? selectedHashtags : [],
      final_caption: null,
      caption_character_count: 0,
      disclosure: null,
      items,
    },
  };
}

function serialiseCarouselAttempt(attempt) {
  if (!attempt) return null;
  return {
    id: String(attempt._id),
    status: attempt.status,
    content_type: attempt.content_type,
    group_run_ids: (attempt.group_run_ids || []).map(String),
    creation_id: attempt.creation_id || null,
    child_creation_ids: attempt.child_creation_ids || [],
    media_id: attempt.media_id || null,
    permalink: attempt.permalink || null,
    attempt_count: Number(attempt.attempt_count || 0),
    last_error: attempt.last_error || null,
    started_at: attempt.started_at || null,
    finished_at: attempt.finished_at || null,
  };
}

function serialiseAffiliateCarouselComposition(composition) {
  if (!composition) return null;
  const storedCaption = composition.final_caption || composition.publish_payload?.caption || "";
  const finalCaption = storedCaption
    ? ensureAffiliateInstagramDisclosure(stripAffiliateInstagramDisclosure(storedCaption), true)
    : null;
  return {
    ...composition,
    final_caption: finalCaption,
    disclosure: AFFILIATE_INSTAGRAM_DISCLOSURE,
    publish_payload: composition.publish_payload
      ? { ...composition.publish_payload, caption: finalCaption }
      : composition.publish_payload,
  };
}

async function getAffiliateCarouselTask(taskId) {
  const task = await AgentTask.findOne({ _id: taskId, agent_name: "carousel" }).lean();
  if (!task) throw carouselError("carousel_not_found", "Carousel task not found.");
  const runIds = normalizeRunIdList(task.input_json?.grouped_run_ids || []);
  const runs = await MarketingCampaignRun.find({ _id: { $in: runIds } })
    .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
    .lean();
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  const orderedRunIds = (task.input_json?.grouped_run_ids || []).map(String);
  const orderedRuns = orderedRunIds.map((id) => runMap.get(id)).filter(Boolean);
  const attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: task.campaign_run_id }).lean();
  const availableAt = task.available_at ? new Date(task.available_at) : null;
  const derivedStatus = task.status === "queued" && availableAt && availableAt.getTime() > Date.now()
    ? "scheduled"
    : task.status;

  return {
    carousel_task_id: String(task._id),
    status: derivedStatus,
    task_status: task.status,
    scheduled_for: task.input_json?.carousel?.scheduled_for || null,
    available_at: task.available_at || null,
    carousel: serialiseAffiliateCarouselComposition(task.input_json?.carousel),
    runs: orderedRuns.map((run) => serialiseRun(run)),
    publish_attempt: serialiseCarouselAttempt(attempt),
    instagram: {
      media_id: attempt?.media_id || null,
      permalink: attempt?.permalink || null,
      creation_id: attempt?.creation_id || null,
      child_creation_ids: attempt?.child_creation_ids || [],
    },
    error_message: task.error_message || attempt?.last_error || null,
  };
}

async function rollbackCarouselClaims(task, previousRuns = []) {
  for (const run of previousRuns) {
    await MarketingCampaignRun.updateOne(
      { _id: run._id, carousel_task_id: task._id },
      {
        $set: {
          status: run.status,
          current_stage: run.current_stage,
          publish_status: run.publish_status,
          scheduled_for: run.scheduled_for || null,
          publish_attempted_at: run.publish_attempted_at || null,
          content_type: run.content_type || "single_image",
          carousel_task_id: null,
          carousel_position: null,
          carousel_size: null,
          last_error: run.last_error || null,
        },
      }
    ).catch(() => null);
  }
}

async function recoverExpiredCarouselCompositions({ limit = 20 } = {}) {
  const now = new Date();
  const expiredTasks = await AgentTask.find({
    agent_name: "carousel",
    status: "cancelled",
    lease_owner: /^carousel-compose:/,
    lease_expires_at: { $lte: now },
  }).sort({ lease_expires_at: 1 }).limit(Math.max(Number(limit || 1), 1));
  let recoveredCount = 0;
  const recoveredRunIds = new Set();

  for (const task of expiredTasks) {
    const recoveredTask = await AgentTask.findOneAndUpdate(
      {
        _id: task._id,
        status: "cancelled",
        lease_owner: task.lease_owner,
        lease_expires_at: task.lease_expires_at,
      },
      {
        $set: {
          lease_owner: null,
          lease_expires_at: null,
          cancellation_requested: true,
          error_message: "Expired carousel composition was released before queueing.",
          finished_at: now,
        },
      },
      { new: true }
    );
    if (!recoveredTask) continue;
    const runs = await restoreQueuedCarouselMembers(recoveredTask, "Expired carousel composition was released before queueing.");
    runs.forEach((run) => recoveredRunIds.add(String(run._id)));
    recoveredCount += 1;
  }

  return { recovered_count: recoveredCount, campaign_run_ids: Array.from(recoveredRunIds) };
}

async function recoverCancelledCarouselMemberships({ limit = 20 } = {}) {
  const tasks = await AgentTask.find({
    agent_name: "carousel",
    status: "cancelled",
    cancellation_requested: true,
    $or: [{ lease_owner: null }, { lease_owner: { $exists: false } }],
  }).sort({ finished_at: 1, updated_at: 1 }).limit(Math.max(Number(limit || 1), 1));
  let recoveredCount = 0;
  const recoveredRunIds = new Set();

  for (const task of tasks) {
    const attempt = await MarketingPublishAttempt.findOne({ campaign_run_id: task.campaign_run_id }).lean();
    const lifecycle = getPublishAttemptLifecycleState(attempt);
    if (lifecycle.has_external_work) {
      const message = lifecycle.outcome_uncertain
        ? publishOutcomeUncertainError().message
        : "Carousel membership cannot be released because Instagram container creation had already started.";
      await AgentTask.updateOne(
        { _id: task._id, agent_name: "carousel", status: "cancelled" },
        { $set: { status: "failed", cancellation_requested: false, error_message: message, finished_at: new Date() } }
      );
      if (lifecycle.outcome_uncertain && attempt?._id) {
        await MarketingPublishAttempt.updateOne(
          { _id: attempt._id, media_id: null, status: { $ne: "published" } },
          { $set: { status: "uncertain", last_error: message, finished_at: new Date() } }
        );
      }
      const runIds = normalizeRunIdList(task.input_json?.grouped_run_ids || []);
      await MarketingCampaignRun.updateMany(
        { _id: { $in: runIds }, carousel_task_id: task._id, archived_at: null, instagram_media_id: null },
        { $set: { status: "failed", current_stage: "publish", publish_status: "failed", last_error: message } }
      );
      runIds.forEach((runId) => recoveredRunIds.add(runId));
      recoveredCount += 1;
      continue;
    }
    const runs = await restoreQueuedCarouselMembers(task, "Cancelled carousel membership was recovered.");
    runs.forEach((run) => recoveredRunIds.add(String(run._id)));
    recoveredCount += 1;
  }

  return { recovered_count: recoveredCount, campaign_run_ids: Array.from(recoveredRunIds) };
}

async function queueAffiliateCarousel({
  runIds = [],
  captionBody,
  hashtags,
  scheduledFor = null,
  actorAdminId = null,
} = {}) {
  assertAffiliateCarouselEnabled();
  const scheduleDate = parseCarouselScheduleDate(scheduledFor);
  const orderedRunIds = normalizeOrderedCarouselRunIds(runIds);
  await recoverExpiredCarouselCompositions();
  await recoverCancelledCarouselMemberships();
  const preview = await buildAffiliateCarouselPreview(orderedRunIds, { captionBody, hashtags });
  if (!preview.can_publish) {
    const conflict = preview.blockers.some((blocker) => blocker.code === "carousel_conflict");
    throw carouselError(conflict ? "carousel_conflict" : "carousel_not_ready", conflict
      ? "One or more selected campaigns already belong to another carousel."
      : "Carousel contains campaigns that are not ready to publish.", {
      blockers: preview.blockers,
      warnings: preview.warnings,
    });
  }

  const deterministicPrimaryId = [...orderedRunIds].sort()[0];
  const runs = await MarketingCampaignRun.find({ _id: { $in: orderedRunIds } });
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  const orderedRuns = orderedRunIds.map((id) => runMap.get(id));
  const primaryRun = runMap.get(deterministicPrimaryId);
  const now = new Date();
  const compositionLeaseOwner = `carousel-compose:${crypto.randomUUID()}`;
  const taskInput = {
    grouped_run_ids: orderedRunIds,
    actor_admin_id: actorAdminId ? String(actorAdminId) : null,
    carousel: {
      ...preview.carousel,
      scheduled_for: scheduleDate?.toISOString() || null,
      publish_payload: {
        content_type: "carousel",
        asset_urls: preview.carousel.items.map((item) => item.asset_url),
        caption: preview.carousel.final_caption,
      },
    },
  };
  let task;
  try {
    task = await AgentTask.findOneAndUpdate(
      {
        campaign_run_id: primaryRun._id,
        agent_name: "carousel",
        status: "cancelled",
        $or: [{ lease_owner: null }, { lease_owner: { $exists: false } }],
      },
      {
        $set: {
          campaign_id: primaryRun.campaign_id,
          campaign_run_id: primaryRun._id,
          agent_name: "carousel",
          sequence: getSequence("carousel"),
          status: "cancelled",
          queue_lane: "publish",
          priority: getTaskPriority("carousel"),
          available_at: scheduleDate || now,
          idempotency_key: buildCarouselGroupIdentity(orderedRunIds),
          lease_owner: compositionLeaseOwner,
          lease_expires_at: new Date(now.getTime() + CAROUSEL_COMPOSITION_LEASE_MS),
          heartbeat_at: null,
          cancellation_requested: false,
          input_json: taskInput,
          output_json: null,
          error_message: null,
          attempt_count: 0,
          started_at: null,
          finished_at: null,
        },
      },
      { new: true, upsert: true }
    );
  } catch (error) {
    if (error?.code === 11000) {
      throw carouselError("carousel_conflict", "Another admin is already composing or publishing a carousel with these campaigns.");
    }
    throw error;
  }
  if (!task) throw carouselError("carousel_conflict", "Carousel task could not be reserved.");

  const previousRuns = [];
  try {
    for (let index = 0; index < orderedRuns.length; index += 1) {
      const run = orderedRuns[index];
      const claimed = await MarketingCampaignRun.findOneAndUpdate(
        {
          _id: run._id,
          status: run.status,
          publish_status: run.publish_status,
          review_status: "approved",
          archived_at: null,
          instagram_media_id: null,
          carousel_task_id: null,
        },
        {
          $set: {
            status: scheduleDate ? "scheduled" : "publishing",
            current_stage: scheduleDate ? "scheduled_for_carousel" : "queued_for_carousel_publish",
            publish_status: scheduleDate ? "scheduled" : "publishing",
            scheduled_for: scheduleDate,
            publish_attempted_at: scheduleDate ? null : now,
            content_type: "carousel",
            carousel_task_id: task._id,
            carousel_position: index + 1,
            carousel_size: orderedRuns.length,
            last_error: null,
          },
        },
        { new: true }
      );
      if (!claimed) {
        throw carouselError("carousel_conflict", `${run.product_title || run.campaign_id} changed or was selected by another publish request.`);
      }
      previousRuns.push(run);
    }

    const activated = await AgentTask.findOneAndUpdate(
      { _id: task._id, status: "cancelled", lease_owner: compositionLeaseOwner, cancellation_requested: { $ne: true } },
      { $set: { status: "queued", available_at: scheduleDate || now, finished_at: null, lease_owner: null, lease_expires_at: null } },
      { new: true }
    );
    if (!activated) throw carouselError("carousel_conflict", "Carousel task could not be activated.");
  } catch (error) {
    await rollbackCarouselClaims(task, previousRuns);
    await AgentTask.updateOne(
      { _id: task._id, status: "cancelled", lease_owner: compositionLeaseOwner },
      { $set: { cancellation_requested: true, error_message: error.message, finished_at: new Date(), lease_owner: null, lease_expires_at: null } }
    ).catch(() => null);
    throw error;
  }

  for (const run of orderedRuns) {
    await recordPublishEvent(run, {
      actionType: scheduleDate ? "schedule" : "carousel_publish",
      status: scheduleDate ? "success" : "started",
      actorAdminId,
      readinessSnapshot: preview,
      metadata: {
        task_id: String(task._id),
        content_type: "carousel",
        selected_run_ids: orderedRunIds,
        scheduled_for: scheduleDate?.toISOString() || null,
      },
    });
  }
  return getAffiliateCarouselTask(task._id);
}

async function restoreQueuedCarouselMembers(task, message = null) {
  const runIds = normalizeRunIdList(task.input_json?.grouped_run_ids || []);
  const runs = await MarketingCampaignRun.find({
    _id: { $in: runIds },
    carousel_task_id: task._id,
    instagram_media_id: null,
    archived_at: null,
  });
  await MarketingCampaignRun.updateMany(
    { _id: { $in: runIds }, carousel_task_id: task._id, instagram_media_id: null, archived_at: null },
    {
      $set: {
        status: "approved_for_publish",
        current_stage: "approved_for_publish",
        publish_status: "ready",
        scheduled_for: null,
        publish_attempted_at: null,
        content_type: "single_image",
        carousel_task_id: null,
        carousel_position: null,
        carousel_size: null,
        last_error: message,
      },
    }
  );
  await AgentTask.updateOne(
    { _id: task._id, agent_name: "carousel", status: "cancelled" },
    { $set: { cancellation_requested: false } }
  );
  return runs;
}

async function rescheduleAffiliateCarousel(taskId, scheduledFor, { actorAdminId = null } = {}) {
  assertAffiliateCarouselEnabled();
  const scheduleDate = parseCarouselScheduleDate(scheduledFor);
  if (!scheduleDate) throw carouselError("invalid_schedule_time", "A future schedule time is required.");
  const task = await AgentTask.findOne({ _id: taskId, agent_name: "carousel" });
  if (!task) throw carouselError("carousel_not_found", "Carousel task not found.");
  if (task.status !== "queued" || task.lease_owner) {
    throw carouselError("carousel_conflict", "Carousel cannot be rescheduled after publishing has started.");
  }
  await assertCarouselLifecycleMutable(task, "rescheduled");
  const runIds = task.input_json?.grouped_run_ids || [];
  const preview = await buildAffiliateCarouselPreview(runIds, {
    frozenComposition: task.input_json?.carousel,
    carouselTaskId: task._id,
    allowScheduledState: true,
    allowPublishingState: true,
  });
  if (!preview.can_publish) {
    throw carouselError("carousel_not_ready", "Carousel is no longer ready to schedule.", { blockers: preview.blockers, warnings: preview.warnings });
  }

  const nextInput = {
    ...(task.input_json || {}),
    carousel: { ...(task.input_json?.carousel || {}), scheduled_for: scheduleDate.toISOString() },
  };
  const updatedTask = await AgentTask.findOneAndUpdate(
    { _id: task._id, agent_name: "carousel", status: "queued", lease_owner: null },
    { $set: { available_at: scheduleDate, input_json: nextInput } },
    { new: true }
  );
  if (!updatedTask) {
    throw carouselError("carousel_conflict", "Carousel cannot be rescheduled after publishing has started.");
  }
  const runs = await MarketingCampaignRun.find({ _id: { $in: runIds }, carousel_task_id: task._id });
  await MarketingCampaignRun.updateMany(
    { _id: { $in: runIds }, carousel_task_id: task._id },
    { $set: { status: "scheduled", current_stage: "scheduled_for_carousel", publish_status: "scheduled", scheduled_for: scheduleDate, publish_attempted_at: null } }
  );
  for (const run of runs) {
    await recordPublishEvent(run, {
      actionType: "schedule",
      status: "success",
      actorAdminId,
      metadata: { task_id: String(task._id), content_type: "carousel", scheduled_for: scheduleDate.toISOString(), rescheduled: true },
    });
  }
  return getAffiliateCarouselTask(updatedTask._id);
}

async function cancelAffiliateCarousel(taskId, { actorAdminId = null } = {}) {
  const existing = await AgentTask.findOne({ _id: taskId, agent_name: "carousel" });
  if (!existing) throw carouselError("carousel_not_found", "Carousel task not found.");
  if (existing.lease_owner || !["queued", "cancelled"].includes(existing.status)) {
    throw carouselError("carousel_conflict", "Carousel cannot be cancelled after Instagram publishing has started.");
  }
  await assertCarouselLifecycleMutable(existing, "cancelled");

  let task = existing;
  if (existing.status === "queued") {
    task = await AgentTask.findOneAndUpdate(
      { _id: taskId, agent_name: "carousel", status: "queued", lease_owner: null },
      {
        $set: {
          status: "cancelled",
          cancellation_requested: true,
          error_message: "Carousel cancelled by admin before Instagram publishing started.",
          finished_at: new Date(),
        },
      },
      { new: true }
    );
  }
  if (!task) {
    throw carouselError("carousel_conflict", "Carousel cannot be cancelled after Instagram publishing has started.");
  }
  const runs = await restoreQueuedCarouselMembers(task, null);
  for (const run of runs) {
    await recordPublishEvent(run, {
      actionType: "carousel_cancel",
      status: "success",
      actorAdminId,
      metadata: { task_id: String(task._id), selected_run_ids: task.input_json?.grouped_run_ids || [] },
    });
  }
  return getAffiliateCarouselTask(task._id);
}

async function retryAffiliateCarousel(taskId, { actorAdminId = null } = {}) {
  assertAffiliateCarouselEnabled();
  const task = await AgentTask.findOne({ _id: taskId, agent_name: "carousel" });
  if (!task) throw carouselError("carousel_not_found", "Carousel task not found.");
  if (task.status !== "failed") throw carouselError("carousel_conflict", "Only a failed carousel can be retried.");
  const publishAttempt = await MarketingPublishAttempt.findOne({ campaign_run_id: task.campaign_run_id }).lean();
  const publishLifecycle = getPublishAttemptLifecycleState(publishAttempt);
  if (publishLifecycle.outcome_uncertain) {
    throw carouselError("carousel_publish_uncertain", publishOutcomeUncertainError().message);
  }
  if (publishLifecycle.has_media_id) {
    throw carouselError("carousel_conflict", "This carousel already has a confirmed Instagram post.");
  }
  const runIds = task.input_json?.grouped_run_ids || [];
  const preview = await buildAffiliateCarouselPreview(runIds, {
    frozenComposition: task.input_json?.carousel,
    carouselTaskId: task._id,
    allowScheduledState: true,
    allowPublishingState: true,
  });
  if (!preview.can_publish) {
    throw carouselError("carousel_not_ready", "Carousel is no longer ready to retry.", { blockers: preview.blockers, warnings: preview.warnings });
  }
  const now = new Date();
  const runs = await MarketingCampaignRun.find({ _id: { $in: runIds }, carousel_task_id: task._id });
  if (runs.length !== runIds.length) throw carouselError("carousel_conflict", "Carousel membership changed and cannot be retried.");
  await MarketingCampaignRun.updateMany(
    { _id: { $in: runIds }, carousel_task_id: task._id },
    { $set: { status: "publishing", current_stage: "queued_for_carousel_publish", publish_status: "publishing", scheduled_for: null, publish_attempted_at: now, last_error: null } }
  );
  const nextInput = {
    ...(task.input_json || {}),
    actor_admin_id: actorAdminId ? String(actorAdminId) : task.input_json?.actor_admin_id || null,
    carousel: { ...(task.input_json?.carousel || {}), scheduled_for: null },
  };
  const retriedTask = await AgentTask.findOneAndUpdate(
    { _id: task._id, agent_name: "carousel", status: "failed", lease_owner: null },
    {
      $set: {
        status: "queued",
        available_at: now,
        cancellation_requested: false,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        started_at: null,
        finished_at: null,
        error_message: null,
        output_json: null,
        input_json: nextInput,
        attempt_count: 0,
      },
    },
    { new: true }
  );
  if (!retriedTask) throw carouselError("carousel_conflict", "Carousel retry was already claimed or started.");
  for (const run of runs) {
    await recordPublishEvent(run, {
      actionType: "retry",
      status: "started",
      actorAdminId,
      metadata: { task_id: String(task._id), content_type: "carousel" },
    });
  }
  return getAffiliateCarouselTask(retriedTask._id);
}

function isMatchingDurableCarouselAttempt(attempt, runIds, publishPayload) {
  if (!hasDurablePublishedAttempt(attempt) || attempt.content_type !== "carousel") return false;
  const { payloadFingerprint } = buildPublishPayloadIdentity(publishPayload);
  return attempt.payload_fingerprint === payloadFingerprint
    && sameRunIdSet(attempt.group_run_ids, runIds);
}

async function reconcileCarouselPublishedRuns({
  orderedRuns,
  uniqueRunIds,
  assetUrls,
  caption,
  publishResult,
  actorAdminId,
  startedAt,
  carouselTaskId = null,
}) {
  const finishedAt = new Date();
  const sharedPublishNote = `Published in grouped carousel post with ${orderedRuns.length} products.`;
  const commonUpdates = {
    status: "published",
    current_stage: "published",
    review_status: "approved",
    review_stage: null,
    review_notes: sharedPublishNote,
    publish_status: "published",
    scheduled_for: null,
    last_error: null,
    publish_attempted_at: startedAt,
    published_at: finishedAt,
    instagram_creation_id: publishResult.creation_id || null,
    instagram_child_creation_ids: publishResult.child_creation_ids || [],
    instagram_media_id: publishResult.media_id,
    instagram_permalink: publishResult.permalink || null,
    published_urls: assetUrls,
    content_type: "carousel",
  };

  await MarketingCampaignRun.updateMany(
    { _id: { $in: uniqueRunIds } },
    { $set: commonUpdates }
  );

  for (let index = 0; index < orderedRuns.length; index += 1) {
    const run = orderedRuns[index];
    Object.assign(run, commonUpdates);
    await recordPublishEvent(run, {
      actionType: "carousel_publish",
      status: "success",
      actorAdminId,
      publishResult,
      readinessSnapshot: await buildCurrentRunPublishReadiness(run, {
        requireApproval: true,
        allowPublishingState: true,
        allowPublishedState: true,
        carouselTaskId,
      }).catch(() => null),
      metadata: {
        total_items: orderedRuns.length,
        position: index + 1,
        selected_run_ids: uniqueRunIds,
      },
    });
  }

  const batchIds = Array.from(new Set(orderedRuns.map((run) => getObjectIdString(run.batch_run_id)).filter(Boolean)));
  await Promise.all(batchIds.map((batchId) => refreshBatchRun(batchId)));
  return {
    publish_result: publishResult,
    caption,
    runs: orderedRuns.map((run) => serialiseRun(run)),
  };
}

async function publishCampaignRunsAsCarousel(runIds = [], {
  actorAdminId = null,
  executeNow = false,
  carouselTask = null,
} = {}) {
  if (!executeNow) {
    return queueAffiliateCarousel({ runIds, actorAdminId });
  }
  assertAffiliateCarouselEnabled();
  const uniqueRunIds = normalizeOrderedCarouselRunIds(runIds);
  const runs = await MarketingCampaignRun.find({ _id: { $in: uniqueRunIds } });
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  const orderedRuns = uniqueRunIds.map((id) => runMap.get(id)).filter(Boolean);
  if (orderedRuns.length !== uniqueRunIds.length) {
    const missingIds = uniqueRunIds.filter((id) => !runMap.has(id));
    throw carouselError("carousel_selection_invalid", `Campaign runs not found: ${missingIds.join(", ")}.`);
  }

  const taskPrimaryId = getObjectIdString(carouselTask?.campaign_run_id);
  const primaryRun = (taskPrimaryId && runMap.get(taskPrimaryId)) || orderedRuns[0];
  const frozenComposition = carouselTask?.input_json?.carousel || null;
  const preliminaryPayload = frozenComposition?.publish_payload || (frozenComposition ? {
    content_type: "carousel",
    asset_urls: (frozenComposition.items || []).map((item) => item.asset_url),
    caption: frozenComposition.final_caption,
  } : null);
  const existingAttempt = await MarketingPublishAttempt.findOne({ campaign_run_id: primaryRun._id });
  const durableExistingAttempt = mergeAttemptWithRunPublishState(existingAttempt, primaryRun);
  const preliminaryRecovery = preliminaryPayload
    ? isMatchingDurableCarouselAttempt(durableExistingAttempt, uniqueRunIds, preliminaryPayload)
    : false;
  const preview = await buildAffiliateCarouselPreview(uniqueRunIds, {
    frozenComposition,
    carouselTaskId: carouselTask?._id || null,
    allowPublishingState: true,
    allowScheduledState: true,
    allowPublishedState: preliminaryRecovery,
  });
  if (!preview.can_publish) {
    throw carouselError("carousel_not_ready", "Carousel publish blocked by current campaign readiness.", {
      blockers: preview.blockers,
      warnings: preview.warnings,
    });
  }
  const assetUrls = preview.carousel.items.map((item) => item.asset_url);
  const caption = preview.carousel.final_caption;
  const publishPayload = { content_type: "carousel", asset_urls: assetUrls, caption };
  const durableRecoveryPayload = preliminaryRecovery ? preliminaryPayload : publishPayload;
  const isDurableRecovery = isMatchingDurableCarouselAttempt(durableExistingAttempt, uniqueRunIds, durableRecoveryPayload);
  const startedAt = new Date();

  if (!isDurableRecovery) {
    for (let index = 0; index < orderedRuns.length; index += 1) {
      const run = orderedRuns[index];
      run.status = "publishing";
      run.current_stage = "publish";
      run.publish_status = "publishing";
      run.scheduled_for = null;
      run.last_error = null;
      run.publish_attempted_at = startedAt;
      run.content_type = "carousel";
      if (carouselTask?._id) run.carousel_task_id = carouselTask._id;
      run.carousel_position = index + 1;
      run.carousel_size = orderedRuns.length;
      await run.save();
    }
  }

  let confirmedPublishResult = null;
  try {
    let publishAttempt = durableExistingAttempt;
    let publishResult;
    if (isDurableRecovery) {
      publishResult = buildPublishResultFromAttempt(durableExistingAttempt, durableRecoveryPayload);
    } else {
      publishAttempt = await getOrCreatePublishAttempt(primaryRun, publishPayload, {
        groupedRunIds: uniqueRunIds,
      });
      const durablePublishAttempt = mergeAttemptWithRunPublishState(publishAttempt, primaryRun);
      publishResult = hasDurablePublishedAttempt(durablePublishAttempt)
        ? buildPublishResultFromAttempt(durablePublishAttempt, publishPayload)
        : await publishInstagramDraft({
          contentType: "carousel",
          assetUrls,
          caption,
          resumeState: {
            creation_id: publishAttempt.creation_id || primaryRun.instagram_creation_id || null,
            child_creation_ids: publishAttempt.child_creation_ids || primaryRun.instagram_child_creation_ids || [],
            media_id: publishAttempt.media_id || primaryRun.instagram_media_id || null,
            permalink: publishAttempt.permalink || primaryRun.instagram_permalink || null,
          },
          onProgress: (progress) => persistPublishProgress(primaryRun, publishAttempt, progress, {
            groupedRunIds: uniqueRunIds,
          }),
        });
    }
    confirmedPublishResult = publishResult;
    if (publishAttempt?._id) {
      await MarketingPublishAttempt.updateOne(
        { _id: publishAttempt._id },
        {
          $set: {
            status: "published",
            creation_id: publishResult.creation_id || null,
            child_creation_ids: publishResult.child_creation_ids || [],
            media_id: publishResult.media_id,
            permalink: publishResult.permalink || null,
            group_run_ids: uniqueRunIds,
            last_error: null,
            finished_at: new Date(),
          },
        }
      ).catch((persistError) => {
        logger.error({ err: persistError, campaignId: primaryRun.campaign_id, instagramMediaId: publishResult.media_id }, "carousel published but attempt finalization failed");
      });
    }

    return reconcileCarouselPublishedRuns({
      orderedRuns,
      uniqueRunIds,
      assetUrls,
      caption,
      publishResult,
      actorAdminId,
      startedAt,
      carouselTaskId: carouselTask?._id || null,
    });
  } catch (error) {
    const message = describeExecutionError(error);
    const finishedAt = new Date();
    const durableAttempt = await MarketingPublishAttempt.findOne({ campaign_run_id: primaryRun._id }).catch(() => null);
    const durableRecoveryAttempt = confirmedPublishResult?.media_id
      ? {
        ...(durableAttempt?.toObject ? durableAttempt.toObject() : durableAttempt || {}),
        content_type: "carousel",
        group_run_ids: uniqueRunIds,
        payload_fingerprint: buildPublishPayloadIdentity(publishPayload).payloadFingerprint,
        creation_id: confirmedPublishResult.creation_id || null,
        child_creation_ids: confirmedPublishResult.child_creation_ids || [],
        media_id: confirmedPublishResult.media_id,
        permalink: confirmedPublishResult.permalink || null,
      }
      : mergeAttemptWithRunPublishState(durableAttempt, primaryRun);
    if (isMatchingDurableCarouselAttempt(durableRecoveryAttempt, uniqueRunIds, publishPayload)) {
      return reconcileCarouselPublishedRuns({
        orderedRuns,
        uniqueRunIds,
        assetUrls,
        caption,
        publishResult: buildPublishResultFromAttempt(durableRecoveryAttempt, publishPayload),
        actorAdminId,
        startedAt,
        carouselTaskId: carouselTask?._id || null,
      });
    }

    for (const run of orderedRuns) {
      run.status = "failed";
      run.current_stage = "publish";
      run.publish_status = "failed";
      run.last_error = message;
      run.publish_attempted_at = startedAt;
      await run.save();
      await recordPublishEvent(run, {
        actionType: "carousel_publish",
        status: "failed",
        actorAdminId,
        errorMessage: message,
        readinessSnapshot: await buildCurrentRunPublishReadiness(run, { requireApproval: true, allowPublishingState: true }).catch(() => null),
        metadata: {
          total_items: orderedRuns.length,
          selected_run_ids: uniqueRunIds,
        },
      });
      await refreshBatchRun(run.batch_run_id);
    }

    const failedAttempt = await markPublishAttemptFailure(primaryRun._id, error, message, finishedAt).catch(() => null);
    const failureCode = failedAttempt?.status === "uncertain"
      ? "carousel_publish_uncertain"
      : error.code || "carousel_publish_failed";

    const publishError = carouselError(failureCode, message, {
      ...(error.details && typeof error.details === "object" ? error.details : {}),
      carousel_runs_finalized: true,
    });
    throw publishError;
  }
}

async function processDueScheduledPublishes(limit = 3) {
  const scheduledRuns = await MarketingCampaignRun.find({
    status: "scheduled",
    publish_status: "scheduled",
    scheduled_for: { $lte: new Date() },
    carousel_task_id: null,
  }).sort({ scheduled_for: 1 }).limit(limit);

  for (const run of scheduledRuns) {
    try {
      await publishCampaignRunNow(run._id);
    } catch (error) {
      const failedRun = await MarketingCampaignRun.findOneAndUpdate({
        _id: run._id,
        status: "scheduled",
        publish_status: "scheduled",
      }, {
        $set: {
          status: "failed",
          current_stage: "publish",
          publish_status: "failed",
          last_error: error.message,
          publish_attempted_at: new Date(),
        },
      }, { new: true });
      if (failedRun) {
        logger.error({ campaignId: failedRun.campaign_id, err: error }, "scheduled campaign could not be queued for publishing");
      } else {
        logger.info({ campaignId: run.campaign_id }, "scheduled publish was already claimed or changed");
      }
    }
  }
}

function buildCampaignRunListQuery({
  search = "",
  status = "all",
  source_event: sourceEvent = "",
  date_from: dateFrom = "",
  date_to: dateTo = "",
  affiliate_only: affiliateOnly = false,
  include_archived: includeArchived = false,
} = {}) {
  const query = {};
  if (includeArchived === "only") query.archived_at = { $ne: null };
  else if (!(includeArchived === true || includeArchived === "true" || includeArchived === "1")) query.archived_at = null;
  const trimmedSearch = String(search || "").trim();
  if (status !== "all") query.status = status;
  if (sourceEvent && sourceEvent !== "all") query.source_event = sourceEvent;
  if (affiliateOnly === true || affiliateOnly === "true" || affiliateOnly === "1") {
    query.$or = [
      { source_event: "affiliate_product.published" },
      { "brief_json.is_affiliate": true },
    ];
  }
  const createdRange = {};
  if (dateFrom) {
    const parsed = new Date(dateFrom);
    if (!Number.isNaN(parsed.getTime())) createdRange.$gte = parsed;
  }
  if (dateTo) {
    const parsed = new Date(dateTo);
    if (!Number.isNaN(parsed.getTime())) createdRange.$lte = parsed;
  }
  if (Object.keys(createdRange).length) query.created_at = createdRange;
  if (trimmedSearch) {
    const searchOr = [
      { campaign_id: { $regex: trimmedSearch, $options: "i" } },
      { product_title: { $regex: trimmedSearch, $options: "i" } },
      { vendor_shop_name: { $regex: trimmedSearch, $options: "i" } },
    ];
    if (query.$or) {
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }
  return query;
}

function matchesReadinessFilter(run, readiness) {
  if (!readiness || readiness === "all") return true;
  const snapshot = serialiseRun(run).publish_readiness;
  const blockers = snapshot?.blockers || [];
  const warnings = snapshot?.warnings || [];
  if (readiness === "ready") return snapshot?.can_publish === true;
  if (readiness === "blocked") return blockers.length > 0;
  if (readiness === "warnings") return blockers.length === 0 && warnings.length > 0;
  return true;
}

async function listCampaignRuns({
  search = "",
  status = "all",
  page = 1,
  limit = 10,
  source_event: sourceEvent = "",
  readiness = "all",
  date_from: dateFrom = "",
  date_to: dateTo = "",
  affiliate_only: affiliateOnly = false,
  include_archived: includeArchived = false,
} = {}) {
  const query = buildCampaignRunListQuery({
    search,
    status,
    source_event: sourceEvent,
    date_from: dateFrom,
    date_to: dateTo,
    affiliate_only: affiliateOnly,
    include_archived: includeArchived,
  });

  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 10), 1), 50);
  const usesReadinessFilter = readiness && readiness !== "all";
  const baseFind = MarketingCampaignRun.find(query)
      .sort({ updated_at: -1 })
      .populate("vendor_product_id", "featured_image additional_images")
      .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
      .lean();
  if (!usesReadinessFilter) {
    baseFind.skip((safePage - 1) * safeLimit).limit(safeLimit);
  }

  const countFind = usesReadinessFilter
    ? Promise.resolve(null)
    : MarketingCampaignRun.find(query)
      .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
      .lean();

  const [rawItems, totalWithoutReadiness, groupedCounts, latestBatch, countItems, archivedCount] = await Promise.all([
    baseFind,
    MarketingCampaignRun.countDocuments(query),
    MarketingCampaignRun.aggregate([{ $match: query }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    DailyBatchRun.findOne().sort({ created_at: -1 }).lean(),
    countFind,
    MarketingCampaignRun.countDocuments({ archived_at: { $ne: null } }),
  ]);

  const filteredItems = usesReadinessFilter
    ? rawItems.filter((item) => matchesReadinessFilter(item, readiness))
    : rawItems;
  const total = usesReadinessFilter ? filteredItems.length : totalWithoutReadiness;
  const items = usesReadinessFilter
    ? filteredItems.slice((safePage - 1) * safeLimit, safePage * safeLimit)
    : filteredItems;

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
    archived: archivedCount,
  };
  groupedCounts.forEach((row) => {
    if (counts[row._id] != null) counts[row._id] = row.count;
  });
  const countableItems = countItems || rawItems;
  counts.ready_to_post = countableItems.filter((item) => matchesReadinessFilter(item, "ready")).length;
  counts.blocked = countableItems.filter((item) => matchesReadinessFilter(item, "blocked")).length;
  counts.affiliate = countableItems.filter((item) => serialiseRun(item).is_affiliate).length;

  return {
    items: items.map((item) => serialiseRun(item, taskCountMap.get(String(item._id)) || undefined)),
    features: { affiliate_carousel: isAffiliateCarouselEnabled() },
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

async function listCampaignCatalogProducts({
  search = "",
  page = 1,
  limit = 24,
  source = "all",
  readiness = "all",
  category = "",
  affiliate_only: affiliateOnly = false,
  instagram_pick: instagramPick = false,
} = {}) {
  const query = {
    status: "active",
    is_visible: { $ne: false },
    archived_at: null,
  };
  const trimmedSearch = String(search || "").trim();
  if (trimmedSearch) {
    query.$or = [
      { title: { $regex: trimmedSearch, $options: "i" } },
      { slug: { $regex: trimmedSearch, $options: "i" } },
      { category: { $regex: trimmedSearch, $options: "i" } },
      { subcategory: { $regex: trimmedSearch, $options: "i" } },
      { affiliate_asin: { $regex: trimmedSearch, $options: "i" } },
    ];
  }
  if (source === "affiliate" || affiliateOnly === true || affiliateOnly === "true" || affiliateOnly === "1") query.is_affiliate = true;
  if (source === "admin") {
    query.source_type = "admin";
    query.is_affiliate = { $ne: true };
  }
  if (source === "vendor") query.source_type = "vendor";
  if (instagramPick === true || instagramPick === "true" || instagramPick === "1") query.affiliate_is_instagram_pick = true;
  if (category) query.category = { $regex: String(category).trim(), $options: "i" };

  const safePage = Math.max(Number(page || 1), 1);
  const safeLimit = Math.min(Math.max(Number(limit || 24), 1), 100);
  const usesReadinessFilter = readiness && readiness !== "all";
  const baseQuery = Product.find(query)
    .select([
      "title",
      "slug",
      "source_type",
      "status",
      "is_visible",
      "is_affiliate",
      "featured_image",
      "images",
      "price",
      "sale_price",
      "category",
      "subcategory",
      "affiliate_is_instagram_pick",
      "affiliate_compliance_status",
      "affiliate_link_check_status",
      "affiliate_tag",
      "affiliate_url",
      "affiliate_campaign_asset_url",
      "affiliate_campaign_usage_rights",
    ].join(" "))
    .sort({ is_affiliate: -1, affiliate_is_instagram_pick: -1, updatedAt: -1 })
    .lean();

  if (!usesReadinessFilter) {
    baseQuery.skip((safePage - 1) * safeLimit).limit(safeLimit);
  }

  const [rawItems, totalWithoutReadiness] = await Promise.all([
    baseQuery,
    Product.countDocuments(query),
  ]);
  const filtered = usesReadinessFilter
    ? rawItems.filter((product) => {
      const statusValue = getCatalogProductReadiness(product).status;
      if (readiness === "ready") return statusValue === "ready" || statusValue === "warning";
      if (readiness === "blocked") return statusValue === "blocked";
      if (readiness === "warning") return statusValue === "warning";
      return true;
    })
    : rawItems;
  const total = usesReadinessFilter ? filtered.length : totalWithoutReadiness;
  const items = usesReadinessFilter
    ? filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit)
    : filtered;

  return {
    items: items.map(serialiseCatalogProduct),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      total_pages: Math.ceil(total / safeLimit) || 1,
    },
  };
}

async function scanCampaignReadiness(runIds = []) {
  const uniqueRunIds = Array.from(new Set(
    (Array.isArray(runIds) ? runIds : []).map((id) => String(id || "").trim()).filter(Boolean)
  ));
  if (!uniqueRunIds.length) throw new Error("Select at least one campaign run to scan");

  const runs = await MarketingCampaignRun.find({ _id: { $in: uniqueRunIds } })
    .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
    .lean();
  const runMap = new Map(runs.map((run) => [String(run._id), run]));
  return {
    requested: uniqueRunIds.length,
    results: uniqueRunIds.map((id) => {
      const run = runMap.get(id);
      if (!run) {
        return {
          id,
          ok: false,
          message: "Campaign run not found",
          publish_readiness: {
            can_publish: false,
            blockers: [readinessIssue("run_not_found", "Campaign run not found.")],
            warnings: [],
            checked_at: new Date().toISOString(),
          },
        };
      }
      const serialised = serialiseRun(run);
      const blockers = serialised.publish_readiness?.blockers || [];
      return {
        id,
        ok: blockers.length === 0,
        message: blockers.length ? blockers[0].message : "Campaign can proceed to publish checks",
        run: serialised,
        publish_readiness: serialised.publish_readiness,
      };
    }),
  };
}

async function listCampaignCalendar({ from = "", to = "" } = {}) {
  const now = new Date();
  const fromDate = from && !Number.isNaN(new Date(from).getTime())
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const toDate = to && !Number.isNaN(new Date(to).getTime())
    ? new Date(to)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);

  const runs = await MarketingCampaignRun.find({
    archived_at: null,
    $or: [
      { scheduled_for: { $gte: fromDate, $lte: toDate } },
      { published_at: { $gte: fromDate, $lte: toDate } },
    ],
  })
    .sort({ scheduled_for: 1, published_at: 1, updated_at: -1 })
    .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
    .lean();

  const carouselRepresentatives = new Map();
  const calendarRuns = [];
  for (const run of runs) {
    const taskId = getObjectIdString(run.carousel_task_id);
    if (!taskId) {
      calendarRuns.push(run);
      continue;
    }
    const existing = carouselRepresentatives.get(taskId);
    if (!existing || Number(run.carousel_position || 99) < Number(existing.carousel_position || 99)) {
      carouselRepresentatives.set(taskId, run);
    }
  }
  calendarRuns.push(...carouselRepresentatives.values());

  const entries = calendarRuns.map((run) => {
    const serialised = serialiseRun(run);
    const dateValue = run.scheduled_for || run.published_at || run.updated_at;
    const dateKey = dateValue ? new Date(dateValue).toISOString().slice(0, 10) : "unknown";
    const dayRuns = calendarRuns.filter((candidate) => {
      const candidateDate = candidate.scheduled_for || candidate.published_at || candidate.updated_at;
      return candidateDate && new Date(candidateDate).toISOString().slice(0, 10) === dateKey;
    });
    const warnings = [];
    if (dayRuns.filter((candidate) => candidate.status === "scheduled").length > 3) {
      warnings.push(readinessIssue("schedule_density", "More than 3 Instagram posts are scheduled on this date."));
    }
    if (serialised.publish_readiness?.blockers?.length && run.status === "scheduled") {
      warnings.push(readinessIssue("scheduled_now_blocked", "This scheduled run now has publish blockers."));
    }
    return {
      date: dateKey,
      run: serialised,
      carousel_task_id: getObjectIdString(run.carousel_task_id),
      carousel_size: Number(run.carousel_size || 0) || null,
      warnings,
    };
  });

  const grouped = entries.reduce((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = [];
    acc[entry.date].push(entry);
    return acc;
  }, {});

  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    entries,
    grouped,
  };
}

async function getDailyBatchRunDetail(batchId) {
  const batch = await DailyBatchRun.findById(batchId).lean();
  if (!batch) throw new Error("Daily batch not found");
  const runIds = Array.isArray(batch.run_ids) ? batch.run_ids : [];
  const [runs, taskRows] = await Promise.all([
    MarketingCampaignRun.find({ _id: { $in: runIds } })
      .sort({ updated_at: -1 })
      .populate("public_product_id", PUBLIC_PRODUCT_CAMPAIGN_FIELDS)
      .lean(),
    AgentTask.aggregate([
      { $match: { campaign_run_id: { $in: runIds } } },
      { $group: { _id: { campaign_run_id: "$campaign_run_id", status: "$status" }, count: { $sum: 1 } } },
    ]),
  ]);
  const taskCountMap = new Map();
  taskRows.forEach((row) => {
    const runId = String(row._id.campaign_run_id);
    const existing = taskCountMap.get(runId) || { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    existing[row._id.status] = row.count;
    taskCountMap.set(runId, existing);
  });
  const summary = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    stuck: 0,
  };
  taskRows.forEach((row) => {
    if (summary[row._id.status] != null) summary[row._id.status] += row.count;
  });
  summary.stuck = runs.filter((run) => ["batch_running", "publishing"].includes(run.status) && run.updated_at && Date.now() - new Date(run.updated_at).getTime() > STALE_TASK_THRESHOLD_MS).length;

  return {
    batch: serialiseBatchRun(batch),
    summary,
    runs: runs.map((run) => serialiseRun(run, taskCountMap.get(String(run._id)) || undefined)),
  };
}

async function retryFailedBatchRuns(batchId, { actorAdminId = null } = {}) {
  const batch = await DailyBatchRun.findById(batchId).lean();
  if (!batch) throw new Error("Daily batch not found");
  const failedRuns = await MarketingCampaignRun.find({
    _id: { $in: batch.run_ids || [] },
    status: "failed",
  });
  const results = [];
  for (const run of failedRuns) {
    try {
      const updated = await retryCampaignRun(run._id, { actorAdminId });
      results.push({ id: String(run._id), ok: true, run: updated });
    } catch (error) {
      results.push({ id: String(run._id), ok: false, message: error.message });
    }
  }
  return {
    requested: failedRuns.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
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

  const [tasks, publishEvents] = await Promise.all([
    AgentTask.find({
      $or: [
        { campaign_run_id: runId },
        { agent_name: "carousel", "input_json.grouped_run_ids": String(runId) },
      ],
    }).sort({ sequence: 1, created_at: 1 }).lean(),
    MarketingCampaignPublishEvent.find({ campaign_run_id: runId }).sort({ created_at: -1 }).limit(50).lean(),
  ]);
  return {
    run: serialiseRun(run),
    batch: serialiseBatchRun(run.batch_run_id),
    tasks: tasks.map(serialiseTask),
    publish_events: publishEvents.map(serialisePublishEvent),
  };
}

async function updateWorkerHeartbeat() {
  const now = new Date();
  await MarketingWorkerHeartbeat.findOneAndUpdate(
    { worker_key: "marketing-agent-worker" },
    {
      $set: {
        worker_id: workerId,
        heartbeat_at: now,
        metadata_json: {
          pid: process.pid,
          host: os.hostname(),
          lanes: Object.fromEntries(Object.entries(TASK_LANES).map(([lane, config]) => [lane, config.concurrency])),
        },
      },
    },
    { upsert: true, new: true }
  );
}

function accumulateQueueLaneCounts(lanes, rows = []) {
  rows.forEach((row) => {
    const lane = row._id.lane || getQueueLane(row._id.agent_name);
    const status = row._id.status;
    if (lanes[lane] && status) {
      lanes[lane][status] = Number(lanes[lane][status] || 0) + Number(row.count || 0);
    }
  });
  return lanes;
}

async function getMarketingQueueHealth() {
  const [heartbeat, counts, oldestRows] = await Promise.all([
    MarketingWorkerHeartbeat.findOne({ worker_key: "marketing-agent-worker" }).lean(),
    AgentTask.aggregate([
      { $match: { status: { $in: ["queued", "running", "failed"] } } },
      { $group: { _id: { lane: "$queue_lane", agent_name: "$agent_name", status: "$status" }, count: { $sum: 1 } } },
    ]),
    AgentTask.aggregate([
      { $match: { status: "queued" } },
      { $group: { _id: { lane: "$queue_lane", agent_name: "$agent_name" }, oldest_at: { $min: "$created_at" } } },
    ]),
  ]);
  const now = Date.now();
  const lanes = {};
  Object.keys(TASK_LANES).forEach((lane) => {
    lanes[lane] = {
      concurrency: TASK_LANES[lane].concurrency,
      queued: 0,
      running: 0,
      failed: 0,
      oldest_queued_at: null,
      oldest_queue_age_seconds: 0,
    };
  });
  accumulateQueueLaneCounts(lanes, counts);
  oldestRows.forEach((row) => {
    const lane = row._id.lane || getQueueLane(row._id.agent_name);
    if (!lanes[lane] || !row.oldest_at) return;
    const current = lanes[lane].oldest_queued_at;
    if (!current || new Date(row.oldest_at).getTime() < new Date(current).getTime()) {
      lanes[lane].oldest_queued_at = row.oldest_at;
      lanes[lane].oldest_queue_age_seconds = Math.max(Math.round((now - new Date(row.oldest_at).getTime()) / 1000), 0);
    }
  });
  const heartbeatAgeMs = heartbeat?.heartbeat_at ? now - new Date(heartbeat.heartbeat_at).getTime() : Infinity;
  return {
    status: heartbeatAgeMs <= Math.max(WORKER_INTERVAL_MS * 3, 30000) ? "healthy" : "stale",
    worker: heartbeat ? {
      worker_id: heartbeat.worker_id,
      heartbeat_at: heartbeat.heartbeat_at,
      heartbeat_age_seconds: Math.max(Math.round(heartbeatAgeMs / 1000), 0),
      metadata: heartbeat.metadata_json || null,
    } : null,
    lanes,
    checked_at: new Date().toISOString(),
  };
}

function startMarketingAgentWorker() {
  if (workerStarted) return;
  workerStarted = true;
  setInterval(() => {
    void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  }, WORKER_INTERVAL_MS);
  void processQueuedTasks().catch((error) => logger.error({ err: error }, "marketing worker execution failed"));
  setInterval(() => {
    void updateWorkerHeartbeat().catch((error) => logger.error({ err: error }, "marketing worker heartbeat failed"));
  }, Math.max(WORKER_INTERVAL_MS, 10000)).unref?.();
  void updateWorkerHeartbeat().catch((error) => logger.error({ err: error }, "marketing worker heartbeat failed"));
  logger.info({ pollMs: WORKER_INTERVAL_MS, workerId, lanes: TASK_LANES }, "marketing agent worker started");
}

module.exports = {
  archiveCampaignRun,
  archiveCampaignRuns,
  buildAffiliateCarouselPreview,
  cancelAffiliateCarousel,
  enqueueAdminProductCampaign,
  enqueueAffiliateProductCampaign,
  enqueueApprovedProductCampaign,
  getAffiliateCarouselTask,
  getCampaignSettings,
  getDailyBatchRunDetail,
  getCampaignRunDetail,
  getLatestDailyBatchRun,
  getMarketingQueueHealth,
  listCampaignCalendar,
  listCampaignCatalogProducts,
  listCampaignRuns,
  processDueScheduledPublishes,
  processQueuedTasks,
  processQueueLane,
  publishCampaignRunsAsCarousel,
  publishCampaignRunNow,
  purgeCampaignRun,
  queueAffiliateCarousel,
  recoverOrphanedPublishingRuns,
  recoverCancelledCarouselMemberships,
  recoverExpiredCarouselCompositions,
  recoverStaleRunningTasks,
  regenerateCampaignRun,
  resetStuckCampaignRun,
  rescheduleAffiliateCarousel,
  reviewCampaignRun,
  reviewCampaignRuns,
  restoreCampaignRun,
  retryFailedBatchRuns,
  retryCampaignRun,
  retryAffiliateCarousel,
  runDailyBatch,
  scanCampaignReadiness,
  scheduleCampaignRun,
  serialiseBatchRun,
  serialiseCatalogProduct,
  serialisePublishEvent,
  serialiseRun,
  startMarketingAgentWorker,
  updateCampaignDraft,
  validateAffiliateProductForCampaign,
  _private: {
    accumulateQueueLaneCounts,
    buildCampaignAssetReferenceQuery,
    buildCarouselGroupIdentity,
    buildCarouselTrackingUrl,
    buildBulkCarouselCaption,
    buildCarouselReadinessBlockers,
    buildPublishPayloadIdentity,
    buildPublishResultFromAttempt,
    buildPublishTaskMembershipQuery,
    buildStaleTaskRecoveryFilter,
    getActiveLeaseFilter,
    getNextAutoAgent,
    buildRunPublishReadinessSnapshot,
    assertReviewApprovalReadiness,
    buildLaneClaimQuery,
    buildOrphanPublishRecoveryUpdates,
    getQueueLane,
    getRunNextAction,
    getRunPublishAssetUrls,
    hasDurablePublishedAttempt,
    buildPublishAttemptFailureUpdates,
    getPublishAttemptLifecycleState,
    isMatchingDurableCarouselAttempt,
    isUnresolvedPublishAttempt,
    mergeAttemptWithRunPublishState,
    normalizeOrderedCarouselRunIds,
    normalizeBulkCampaignRunIds,
    normalizeBulkReviewRunIds,
    collectBulkCampaignReviewResults,
    parseCarouselScheduleDate,
    sameRunIdSet,
    shouldReturnExistingRunningBatch,
  },
};
