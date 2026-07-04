const express = require("express");
const { protect, adminOnly } = require("../middleware/auth");
const { runBackup } = require("../controllers/adminBackupController");

const router = express.Router();

router.post("/run", protect, adminOnly, runBackup);

module.exports = router;
