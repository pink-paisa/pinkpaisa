const express = require("express");
const multer = require("multer");
const { protect, adminOnly } = require("../middleware/auth");
const { uploadAmazonReport } = require("../controllers/adminAmazonReportController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    const allowedMimeTypes = new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"]);
    if (name.endsWith(".csv") || allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only CSV Amazon report files are allowed"));
  },
});

function uploadCsv(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || "Could not upload Amazon report" });
    return next();
  });
}

router.post("/upload", protect, adminOnly, uploadCsv, uploadAmazonReport);

module.exports = router;
