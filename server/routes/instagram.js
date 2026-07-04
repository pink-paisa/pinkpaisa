const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const {
  disconnectInstagramController,
  getInstagramConnectionController,
  instagramConnectCallbackController,
  startInstagramConnectController,
} = require("../controllers/instagramController");

router.get("/admin/connection", protect, adminOnly, getInstagramConnectionController);
router.post("/admin/connect/start", protect, adminOnly, startInstagramConnectController);
router.get("/admin/connect/callback", instagramConnectCallbackController);
router.delete("/admin/connection", protect, adminOnly, disconnectInstagramController);

module.exports = router;
