const {
  archiveCampaignRun,
  archiveCampaignRuns,
  buildAffiliateCarouselPreview,
  cancelAffiliateCarousel,
  enqueueAffiliateProductCampaign,
  enqueueAdminProductCampaign,
  enqueueApprovedProductCampaign,
  getDailyBatchRunDetail,
  getCampaignRunDetail,
  getAffiliateCarouselTask,
  getLatestDailyBatchRun,
  getMarketingQueueHealth,
  listCampaignCalendar,
  listCampaignCatalogProducts,
  listCampaignRuns,
  publishCampaignRunNow,
  purgeCampaignRun,
  recoverStaleRunningTasks,
  queueAffiliateCarousel,
  regenerateCampaignRun,
  resetStuckCampaignRun,
  rescheduleAffiliateCarousel,
  reviewCampaignRun,
  reviewCampaignRuns,
  restoreCampaignRun,
  retryCampaignRun,
  retryAffiliateCarousel,
  retryFailedBatchRuns,
  runDailyBatch,
  scanCampaignReadiness,
  scheduleCampaignRun,
  updateCampaignDraft,
} = require("../services/marketingAgentOrchestrator");
const MarketingCampaignRun = require("../models/MarketingCampaignRun");
const Product = require("../models/Product");
const VendorProduct = require("../models/VendorProduct");

const campaignErrorResponse = (error) => ({
  message: error.message,
  ...(error.code ? { code: error.code } : {}),
  ...(error.details && typeof error.details === "object" ? error.details : {}),
});
const isCarouselConflict = (error) => ["carousel_conflict", "carousel_not_ready", "carousel_publish_uncertain"].includes(error?.code);

const listMarketingCampaignRuns = async (req, res) => {
  try {
    const result = await listCampaignRuns({
      search: req.query.search || "",
      status: req.query.status || "all",
      page: req.query.page || 1,
      limit: req.query.limit || 10,
      source_event: req.query.source_event || "",
      readiness: req.query.readiness || "all",
      date_from: req.query.date_from || "",
      date_to: req.query.date_to || "",
      affiliate_only: req.query.affiliate_only || false,
      include_archived: req.query.include_archived || false,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMarketingQueueHealthController = async (_req, res) => {
  try {
    res.json(await getMarketingQueueHealth());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const archiveMarketingCampaignController = async (req, res) => {
  try {
    const result = await archiveCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
      reason: req.body?.reason || "",
    });
    res.json({ message: "Campaign archived", ...result });
  } catch (error) {
    res.status(409).json({ message: error.message });
  }
};

const bulkArchiveMarketingCampaignsController = async (req, res) => {
  try {
    const result = await archiveCampaignRuns(req.body?.run_ids, {
      actorAdminId: req.user?._id || req.user?.id || null,
      reason: req.body?.reason || "Removed from campaign admin",
    });
    res.json({
      message: result.failed
        ? `${result.archived} campaign(s) removed; ${result.failed} could not be removed`
        : `${result.archived} campaign(s) removed from Pink Paisa`,
      ...result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const restoreMarketingCampaignController = async (req, res) => {
  try {
    const result = await restoreCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign restored", ...result });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const purgeMarketingCampaignController = async (req, res) => {
  try {
    const result = await purgeCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign permanently deleted", ...result });
  } catch (error) {
    res.status(409).json({ message: error.message });
  }
};

const listMarketingCampaignCatalogProducts = async (req, res) => {
  try {
    const result = await listCampaignCatalogProducts({
      search: req.query.search || "",
      page: req.query.page || 1,
      limit: req.query.limit || 24,
      source: req.query.source || "all",
      readiness: req.query.readiness || "all",
      category: req.query.category || "",
      affiliate_only: req.query.affiliate_only || false,
      instagram_pick: req.query.instagram_pick || false,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMarketingCampaignRun = async (req, res) => {
  try {
    const result = await getCampaignRunDetail(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(error.message === "Campaign run not found" ? 404 : 500).json({ message: error.message });
  }
};

const getLatestMarketingBatch = async (_req, res) => {
  try {
    const result = await getLatestDailyBatchRun();
    res.json({ batch: result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const scanMarketingCampaignReadiness = async (req, res) => {
  try {
    const result = await scanCampaignReadiness(req.body.run_ids || []);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getMarketingCampaignCalendar = async (req, res) => {
  try {
    const result = await listCampaignCalendar({
      from: req.query.from || "",
      to: req.query.to || "",
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMarketingBatchDetail = async (req, res) => {
  try {
    const result = await getDailyBatchRunDetail(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(error.message === "Daily batch not found" ? 404 : 500).json({ message: error.message });
  }
};

const retryFailedMarketingBatchItems = async (req, res) => {
  try {
    const result = await retryFailedBatchRuns(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({
      message: result.succeeded
        ? `Retried ${result.succeeded} failed campaign item${result.succeeded === 1 ? "" : "s"}`
        : "No failed campaign items were retried",
      ...result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const reviewMarketingCampaignRun = async (req, res) => {
  try {
    const updated = await reviewCampaignRun(req.params.id, req.body.action, req.body.notes || "", {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: req.body.action === "reject" ? "Campaign review rejected" : "Campaign review approved", run: updated });
  } catch (error) {
    res.status(400).json(campaignErrorResponse(error));
  }
};

const bulkReviewMarketingCampaignsController = async (req, res) => {
  try {
    const result = await reviewCampaignRuns(req.body?.run_ids, {
      notes: req.body?.notes || "",
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({
      message: result.failed
        ? `${result.approved} campaign(s) approved; ${result.failed} remain blocked`
        : `${result.approved} campaign(s) approved for publishing`,
      ...result,
    });
  } catch (error) {
    res.status(400).json(campaignErrorResponse(error));
  }
};

const retryMarketingCampaign = async (req, res) => {
  try {
    const updated = await retryCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign task re-queued", run: updated });
  } catch (error) {
    res.status(error.code === "instagram_publish_outcome_uncertain" ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const recoverStaleMarketingTasksController = async (_req, res) => {
  try {
    const recovery = await recoverStaleRunningTasks();
    res.json({
      message: recovery.recovered_count
        ? `Recovered ${recovery.recovered_count} stale campaign task${recovery.recovered_count === 1 ? "" : "s"}`
        : "No stale campaign tasks were found",
      ...recovery,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const resetStuckMarketingCampaignController = async (req, res) => {
  try {
    const updated = await resetStuckCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Stuck campaign task reset", ...updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const regenerateMarketingCampaign = async (req, res) => {
  try {
    const updated = await regenerateCampaignRun(req.params.id, req.body.stage || "creative", {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign draft regeneration started", ...updated });
  } catch (error) {
    res.status(error.code === "instagram_publish_outcome_uncertain" ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const updateMarketingCampaignDraftController = async (req, res) => {
  try {
    const updated = await updateCampaignDraft(req.params.id, req.body || {});
    res.json({ message: "Campaign draft updated", ...updated });
  } catch (error) {
    res.status(error.code === "instagram_publish_outcome_uncertain" ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const publishMarketingCampaignController = async (req, res) => {
  try {
    const updated = await publishCampaignRunNow(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.status(202).json({ message: "Instagram publish queued", queued: true, ...updated });
  } catch (error) {
    res.status(error.code === "instagram_publish_outcome_uncertain" ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const previewMarketingCarouselController = async (req, res) => {
  try {
    const preview = await buildAffiliateCarouselPreview(req.body?.run_ids, {
      captionBody: req.body?.caption_body,
      hashtags: req.body?.hashtags,
    });
    res.json(preview);
  } catch (error) {
    res.status(400).json(campaignErrorResponse(error));
  }
};

const publishMarketingCarouselController = async (req, res) => {
  try {
    const result = await queueAffiliateCarousel({
      runIds: req.body?.run_ids,
      captionBody: req.body?.caption_body,
      hashtags: req.body?.hashtags,
      scheduledFor: req.body?.scheduled_for || null,
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.status(202).json({
      message: result.status === "scheduled" ? "Instagram carousel scheduled" : "Instagram carousel publish queued",
      queued: true,
      ...result,
    });
  } catch (error) {
    const status = isCarouselConflict(error) ? 409 : 400;
    res.status(status).json(campaignErrorResponse(error));
  }
};

const getMarketingCarouselController = async (req, res) => {
  try {
    res.json(await getAffiliateCarouselTask(req.params.taskId));
  } catch (error) {
    res.status(error.code === "carousel_not_found" ? 404 : 400).json(campaignErrorResponse(error));
  }
};

const rescheduleMarketingCarouselController = async (req, res) => {
  try {
    const result = await rescheduleAffiliateCarousel(req.params.taskId, req.body?.scheduled_for, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Instagram carousel rescheduled", ...result });
  } catch (error) {
    res.status(isCarouselConflict(error) ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const cancelMarketingCarouselController = async (req, res) => {
  try {
    const result = await cancelAffiliateCarousel(req.params.taskId, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Instagram carousel cancelled", ...result });
  } catch (error) {
    res.status(isCarouselConflict(error) ? 409 : error.code === "carousel_not_found" ? 404 : 400).json(campaignErrorResponse(error));
  }
};

const retryMarketingCarouselController = async (req, res) => {
  try {
    const result = await retryAffiliateCarousel(req.params.taskId, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.status(202).json({ message: "Instagram carousel retry queued", queued: true, ...result });
  } catch (error) {
    res.status(isCarouselConflict(error) ? 409 : error.code === "carousel_not_found" ? 404 : 400).json(campaignErrorResponse(error));
  }
};

const redirectMarketingCampaignLinkController = async (req, res) => {
  const frontendBase = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://www.pinkpaisa.in").replace(/\/+$/, "");
  const fallbackUrl = `${frontendBase}/products`;
  try {
    const campaignId = String(req.params.campaignId || "").trim().slice(0, 80);
    if (!campaignId) return res.redirect(302, fallbackUrl);
    const run = await MarketingCampaignRun.findOne({ campaign_id: campaignId }).lean();
    if (!run?.public_product_id) return res.redirect(302, fallbackUrl);
    const product = await Product.findOne({
      _id: run.public_product_id,
      is_affiliate: true,
      status: "active",
      is_visible: true,
      archived_at: null,
    }).select("slug").lean();
    if (!product?.slug) return res.redirect(302, fallbackUrl);

    const destination = new URL(`/product/${encodeURIComponent(product.slug)}`, `${frontendBase}/`);
    destination.searchParams.set("utm_source", "instagram");
    destination.searchParams.set("utm_medium", "organic_social");
    destination.searchParams.set("utm_campaign", run.campaign_id);
    destination.searchParams.set("utm_content", run.carousel_position ? `carousel_slide_${run.carousel_position}` : "carousel");
    return res.redirect(302, destination.toString());
  } catch {
    return res.redirect(302, fallbackUrl);
  }
};

const scheduleMarketingCampaignController = async (req, res) => {
  try {
    const run = await scheduleCampaignRun(req.params.id, req.body.scheduled_for, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign scheduled for Instagram publishing", run });
  } catch (error) {
    res.status(error.code === "instagram_publish_outcome_uncertain" ? 409 : 400).json(campaignErrorResponse(error));
  }
};

const runDailyMarketingBatchController = async (_req, res) => {
  try {
    const batch = await runDailyBatch({ triggerType: "manual", date: new Date() });
    res.json({ message: "Daily Instagram batch started", batch });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const createMarketingCampaignFromApprovedProduct = async (req, res) => {
  try {
    const vendorProduct = await VendorProduct.findById(req.params.vendorProductId).lean();
    if (!vendorProduct) return res.status(404).json({ message: "Vendor product not found" });
    if (vendorProduct.approval_status !== "approved" || !vendorProduct.published_product_id) {
      return res.status(400).json({ message: "Vendor product must already be approved and published" });
    }
    const run = await enqueueApprovedProductCampaign({
      vendorProductId: vendorProduct._id,
      publicProductId: vendorProduct.published_product_id,
      approvedAt: vendorProduct.approved_at || new Date(),
    });
    res.status(201).json({ message: "Campaign added to the daily queue", run });
  } catch (error) {
    res.status(400).json(campaignErrorResponse(error));
  }
};

const createMarketingCampaignFromProductSource = async (req, res) => {
  try {
    const sourceId = req.params.productId;
    const vendorProduct = await VendorProduct.findById(sourceId).lean();
    if (vendorProduct && vendorProduct.approval_status === "approved" && vendorProduct.published_product_id) {
      const run = await enqueueApprovedProductCampaign({
        vendorProductId: vendorProduct._id,
        publicProductId: vendorProduct.published_product_id,
        approvedAt: vendorProduct.approved_at || new Date(),
      });
      return res.status(201).json({ message: "Product added to the daily queue", run });
    }

    const product = await Product.findById(sourceId).lean();
    if (product && (product.source_type || "admin") === "vendor" && product.vendor_product_id) {
      const linkedVendorProduct = await VendorProduct.findById(product.vendor_product_id).lean();
      if (linkedVendorProduct && linkedVendorProduct.approval_status === "approved" && linkedVendorProduct.published_product_id) {
        const run = await enqueueApprovedProductCampaign({
          vendorProductId: linkedVendorProduct._id,
          publicProductId: linkedVendorProduct.published_product_id,
          approvedAt: linkedVendorProduct.approved_at || product.updatedAt || new Date(),
        });
        return res.status(201).json({ message: "Product added to the daily queue", run });
      }
    }

    if (product && (product.source_type || "admin") === "admin" && product.is_affiliate) {
      const run = await enqueueAffiliateProductCampaign({
        productId: product._id,
        queuedAt: new Date(),
      });
      return res.status(201).json({ message: "Affiliate product added to the daily queue", run });
    }

    if (product && (product.source_type || "admin") === "admin" && !product.is_affiliate && product.status === "active" && product.is_visible) {
      const run = await enqueueAdminProductCampaign({
        productId: product._id,
        queuedAt: new Date(),
      });
      return res.status(201).json({ message: "Product added to the daily queue", run });
    }

    return res.status(400).json({ message: "Product must be an approved vendor product, active admin product, or active assigned affiliate product" });
  } catch (error) {
    res.status(400).json(campaignErrorResponse(error));
  }
};

module.exports = {
  archiveMarketingCampaignController,
  bulkArchiveMarketingCampaignsController,
  bulkReviewMarketingCampaignsController,
  cancelMarketingCarouselController,
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getMarketingBatchDetail,
  getMarketingCarouselController,
  getMarketingCampaignCalendar,
  listMarketingCampaignCatalogProducts,
  getLatestMarketingBatch,
  getMarketingQueueHealthController,
  getMarketingCampaignRun,
  listMarketingCampaignRuns,
  previewMarketingCarouselController,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  redirectMarketingCampaignLinkController,
  purgeMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  rescheduleMarketingCarouselController,
  reviewMarketingCampaignRun,
  restoreMarketingCampaignController,
  retryFailedMarketingBatchItems,
  retryMarketingCampaign,
  retryMarketingCarouselController,
  runDailyMarketingBatchController,
  scanMarketingCampaignReadiness,
  scheduleMarketingCampaignController,
  updateMarketingCampaignDraftController,
};
