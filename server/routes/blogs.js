const express = require("express");
const router = express.Router();
const { getBlogs, getBlog, createBlog, updateBlog, deleteBlog } = require("../controllers/blogController");
const { protect, adminOnly } = require("../middleware/auth");

router.get("/", getBlogs);
router.get("/:slug", getBlog);
router.post("/", protect, adminOnly, createBlog);
router.put("/:id", protect, adminOnly, updateBlog);
router.delete("/:id", protect, adminOnly, deleteBlog);

module.exports = router;
