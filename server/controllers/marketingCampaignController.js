const {
  archiveCampaignRun,
  archiveCampaignRuns,
  enqueueAffiliateProductCampaign,
  enqueueAdminProductCampaign,
  enqueueApprovedProductCampaign,
  getDailyBatchRunDetail,
  getCampaignRunDetail,
  getLatestDailyBatchRun,
  getMarketingQueueHealth,
  listCampaignCalendar,
  listCampaignCatalogProducts,
  listCampaignRuns,
  publishCampaignRunsAsCarousel,
  publishCampaignRunNow,
  purgeCampaignRun,
  recoverStaleRunningTasks,
  regenerateCampaignRun,
  resetStuckCampaignRun,
  reviewCampaignRun,
  restoreCampaignRun,
  retryCampaignRun,
  retryFailedBatchRuns,
  runDailyBatch,
  scanCampaignReadiness,
  scheduleCampaignRun,
  updateCampaignDraft,
} = require("../services/marketingAgentOrchestrator");
const Product = require("../models/Product");
const VendorProduct = require("../models/VendorProduct");

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
    const updated = await reviewCampaignRun(req.params.id, req.body.action, req.body.notes || "");
    res.json({ message: req.body.action === "reject" ? "Campaign review rejected" : "Campaign review approved", run: updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const retryMarketingCampaign = async (req, res) => {
  try {
    const updated = await retryCampaignRun(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign task re-queued", run: updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
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
    res.status(400).json({ message: error.message });
  }
};

const updateMarketingCampaignDraftController = async (req, res) => {
  try {
    const updated = await updateCampaignDraft(req.params.id, req.body || {});
    res.json({ message: "Campaign draft updated", ...updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const publishMarketingCampaignController = async (req, res) => {
  try {
    const updated = await publishCampaignRunNow(req.params.id, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.status(202).json({ message: "Instagram publish queued", queued: true, ...updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const publishMarketingCarouselController = async (req, res) => {
  try {
    const result = await publishCampaignRunsAsCarousel(req.body.run_ids || [], {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.status(202).json({
      message: `Instagram carousel queued for ${result.runs.length} reviewed product${result.runs.length === 1 ? "" : "s"}`,
      ...result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const scheduleMarketingCampaignController = async (req, res) => {
  try {
    const run = await scheduleCampaignRun(req.params.id, req.body.scheduled_for, {
      actorAdminId: req.user?._id || req.user?.id || null,
    });
    res.json({ message: "Campaign scheduled for Instagram publishing", run });
  } catch (error) {
    res.status(400).json({ message: error.message });
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
    res.status(400).json({ message: error.message });
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
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  archiveMarketingCampaignController,
  bulkArchiveMarketingCampaignsController,
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getMarketingBatchDetail,
  getMarketingCampaignCalendar,
  listMarketingCampaignCatalogProducts,
  getLatestMarketingBatch,
  getMarketingQueueHealthController,
  getMarketingCampaignRun,
  listMarketingCampaignRuns,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  purgeMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  reviewMarketingCampaignRun,
  restoreMarketingCampaignController,
  retryFailedMarketingBatchItems,
  retryMarketingCampaign,
  runDailyMarketingBatchController,
  scanMarketingCampaignReadiness,
  scheduleMarketingCampaignController,
  updateMarketingCampaignDraftController,
};
