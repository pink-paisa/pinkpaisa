const express = require("express");
const router = express.Router();
const {
  getProducts,
  getProductsFacets,
  getProductSuggestions,
  getProduct,
  validateCartProducts,
  createProduct,
  updateProduct,
  bulkImportProducts,
  bulkUpdateProducts,
  bulkDeleteProducts,
  deleteProduct,
} = require("../controllers/productController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", getProducts);
router.get("/facets", getProductsFacets);
router.get("/suggest", getProductSuggestions);
router.post("/cart-validate", validateCartProducts);
router.get("/:slug", getProduct);
router.post("/", protect, adminOnly, createProduct);
router.post("/bulk-import", protect, adminOnly, bulkImportProducts);
router.post("/bulk-update", protect, adminOnly, bulkUpdateProducts);
router.post("/bulk-delete", protect, adminOnly, bulkDeleteProducts);
router.put("/:id", protect, adminOnly, updateProduct);
router.delete("/:id", protect, adminOnly, deleteProduct);

module.exports = router;
