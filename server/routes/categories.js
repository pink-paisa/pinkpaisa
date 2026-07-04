const express = require("express");
const router = express.Router();
const { protect, adminOnly, optionalProtect } = require("../middleware/auth");
const {
  listCategoryTree,
  getCategoryAdminSummary,
  createCategory,
  updateCategory,
  deleteCategory,
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
} = require("../controllers/categoryController");

router.get("/tree", optionalProtect, listCategoryTree);
router.get("/admin", protect, adminOnly, getCategoryAdminSummary);
router.post("/", protect, adminOnly, createCategory);
router.put("/:id", protect, adminOnly, updateCategory);
router.delete("/:id", protect, adminOnly, deleteCategory);
router.post("/subcategories", protect, adminOnly, createSubcategory);
router.put("/subcategories/:id", protect, adminOnly, updateSubcategory);
router.delete("/subcategories/:id", protect, adminOnly, deleteSubcategory);

module.exports = router;
