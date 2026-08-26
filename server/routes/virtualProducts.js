const express = require("express");
const router = express.Router();
const { getProducts, getProduct, createProduct, updateProduct, deleteProduct } = require("../controllers/virtualProductController");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");

router.get("/", optionalProtect, getProducts);
router.get("/:id", optionalProtect, getProduct);
router.post("/", protect, adminOnly, createProduct);
router.put("/:id", protect, adminOnly, updateProduct);
router.delete("/:id", protect, adminOnly, deleteProduct);

module.exports = router;
