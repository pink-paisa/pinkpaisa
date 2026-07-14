const express = require("express");
const multer = require("multer");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  listAffiliateProducts,
  createAffiliateProduct,
  updateAffiliateProduct,
  deleteAffiliateProduct,
  restoreAffiliateProduct,
  purgeAffiliateProduct,
  previewAffiliateProducts,
  uploadAffiliateProducts,
  assignAffiliateCategory,
  bulkAffiliateProductAction,
  publishAffiliateProduct,
  unpublishAffiliateProduct,
  pauseAffiliateProduct,
  featureAffiliateProduct,
  sortAffiliateProduct,
  validateAffiliateProduct,
  checkAffiliateProductLinkForAdmin,
  refreshAffiliateProductApiData,
  refreshAffiliateProductsApiData,
  backfillAffiliateCompliance,
  backfillAffiliateImages,
} = require("../controllers/affiliateProductController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const allowedMimeTypes = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
      "application/zip",
    ]);
    if (name.endsWith(".xlsx") && allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error("Only modern Excel files (.xlsx) are allowed"));
  },
});

const uploadAffiliateExcel = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Could not upload Excel file" });
    return next();
  });
};

router.get("/", protect, adminOnly, listAffiliateProducts);
router.post("/", protect, adminOnly, createAffiliateProduct);
router.post("/preview-excel", protect, adminOnly, uploadAffiliateExcel, previewAffiliateProducts);
router.post("/upload-excel", protect, adminOnly, uploadAffiliateExcel, uploadAffiliateProducts);
router.patch("/assign-category", protect, adminOnly, assignAffiliateCategory);
router.post("/bulk-action", protect, adminOnly, bulkAffiliateProductAction);
router.post("/backfill-compliance", protect, adminOnly, backfillAffiliateCompliance);
router.post("/backfill-images", protect, adminOnly, backfillAffiliateImages);
router.post("/refresh-api-data", protect, adminOnly, refreshAffiliateProductsApiData);
router.put("/:id", protect, adminOnly, updateAffiliateProduct);
router.delete("/:id", protect, adminOnly, deleteAffiliateProduct);
router.post("/:id/restore", protect, adminOnly, restoreAffiliateProduct);
router.delete("/:id/purge", protect, adminOnly, purgeAffiliateProduct);
router.post("/:id/publish", protect, adminOnly, publishAffiliateProduct);
router.post("/:id/unpublish", protect, adminOnly, unpublishAffiliateProduct);
router.post("/:id/pause", protect, adminOnly, pauseAffiliateProduct);
router.patch("/:id/feature", protect, adminOnly, featureAffiliateProduct);
router.patch("/:id/sort", protect, adminOnly, sortAffiliateProduct);
router.post("/:id/validate-compliance", protect, adminOnly, validateAffiliateProduct);
router.post("/:id/check-link", protect, adminOnly, checkAffiliateProductLinkForAdmin);
router.post("/:id/refresh-api-data", protect, adminOnly, refreshAffiliateProductApiData);

module.exports = router;
