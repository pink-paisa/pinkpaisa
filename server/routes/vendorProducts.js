const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { protectVendor } = require("../middleware/vendorAuth");
const {
  getVendorProductStats,
  listVendorProducts,
  getVendorProduct,
  createVendorProduct,
  updateVendorProduct,
  patchVendorProductStock,
  deleteVendorProduct,
  previewVendorProductsImport,
  importVendorProducts,
  listVendorUploadLogs,
  listVendorProductsForAdmin,
  getVendorProductForAdmin,
  updateVendorProductApproval,
} = require("../controllers/vendorProductController");

router.get("/admin", protect, adminOnly, listVendorProductsForAdmin);
router.get("/admin/:id", protect, adminOnly, getVendorProductForAdmin);
router.put("/admin/:id/approval", protect, adminOnly, updateVendorProductApproval);

router.get("/mine/stats", protectVendor, getVendorProductStats);
router.get("/mine/logs", protectVendor, listVendorUploadLogs);
router.get("/mine", protectVendor, listVendorProducts);
router.get("/mine/:id", protectVendor, getVendorProduct);
router.post("/preview-import", protectVendor, previewVendorProductsImport);
router.post("/import", protectVendor, importVendorProducts);
router.post("/", protectVendor, createVendorProduct);
router.patch("/:id/stock", protectVendor, patchVendorProductStock);
router.put("/:id", protectVendor, updateVendorProduct);
router.delete("/:id", protectVendor, deleteVendorProduct);

module.exports = router;
