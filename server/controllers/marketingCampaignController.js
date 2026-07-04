const {
  enqueueAffiliateProductCampaign,
  enqueueAdminProductCampaign,
  enqueueApprovedProductCampaign,
  getCampaignRunDetail,
  getLatestDailyBatchRun,
  listCampaignRuns,
  publishCampaignRunsAsCarousel,
  publishCampaignRunNow,
  recoverStaleRunningTasks,
  regenerateCampaignRun,
  resetStuckCampaignRun,
  reviewCampaignRun,
  retryCampaignRun,
  runDailyBatch,
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
    const updated = await retryCampaignRun(req.params.id);
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
    const updated = await resetStuckCampaignRun(req.params.id);
    res.json({ message: "Stuck campaign task reset", ...updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const regenerateMarketingCampaign = async (req, res) => {
  try {
    const updated = await regenerateCampaignRun(req.params.id, req.body.stage || "creative");
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
    const updated = await publishCampaignRunNow(req.params.id);
    res.json({ message: "Instagram publish completed", ...updated });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const publishMarketingCarouselController = async (req, res) => {
  try {
    const result = await publishCampaignRunsAsCarousel(req.body.run_ids || []);
    res.json({
      message: `Instagram carousel published for ${result.runs.length} reviewed product${result.runs.length === 1 ? "" : "s"}`,
      ...result,
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const scheduleMarketingCampaignController = async (req, res) => {
  try {
    const run = await scheduleCampaignRun(req.params.id, req.body.scheduled_for);
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
  createMarketingCampaignFromApprovedProduct,
  createMarketingCampaignFromProductSource,
  getLatestMarketingBatch,
  getMarketingCampaignRun,
  listMarketingCampaignRuns,
  publishMarketingCarouselController,
  publishMarketingCampaignController,
  recoverStaleMarketingTasksController,
  regenerateMarketingCampaign,
  resetStuckMarketingCampaignController,
  reviewMarketingCampaignRun,
  retryMarketingCampaign,
  runDailyMarketingBatchController,
  scheduleMarketingCampaignController,
  updateMarketingCampaignDraftController,
};
