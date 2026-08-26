const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const { getJwtSecret } = require("../utils/authConfig");
const { getCustomerSessionToken } = require("../utils/customerSession");
const { extractVendorToken, getVendorJwtSecret } = require("../utils/vendorSession");
const { protect, adminOnly } = require("../middleware/auth");
const {
  UPLOADS_ROOT,
  buildPublicUploadUrl,
  saveImageBufferAsWebp,
} = require("../utils/imageUpload");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed"));
  },
});

const certificateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new Error("Certificates must be a PDF or image file"));
  },
});

function extractUploadedFile(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  if (req.files && typeof req.files === "object") {
    for (const files of Object.values(req.files)) {
      if (Array.isArray(files) && files.length > 0) return files[0];
    }
  }
  return null;
}

async function requireImageUploadActor(req, res, next) {
  const customerToken = getCustomerSessionToken(req);
  if (customerToken) {
    try {
      const decoded = jwt.verify(customerToken, getJwtSecret());
      const user = await User.findById(decoded.id).select("role auth_version").lean();
      const sessionIsCurrent = Number(decoded.version || 0) === Number(user?.auth_version || 0);
      if (user?.role === "admin" && sessionIsCurrent) {
        req.user = user;
        return next();
      }
    } catch {
      // Allow vendor auth to attempt below.
    }
  }

  const vendorToken = extractVendorToken(req);
  if (vendorToken) {
    try {
      const decoded = jwt.verify(vendorToken, getVendorJwtSecret());
      if (decoded.type !== "vendor") {
        return res.status(401).json({ message: "Invalid vendor token" });
      }

      const vendor = await Vendor.findById(decoded.id).select("status").lean();
      if (!vendor) {
        return res.status(401).json({ message: "Vendor not found" });
      }
      if (vendor.status === "banned") {
        return res.status(403).json({ message: "Vendor account is banned" });
      }
      if (vendor.status !== "verified") {
        return res.status(403).json({ message: "Vendor account is not verified" });
      }

      req.vendor = vendor;
      return next();
    } catch {
      // Fall through to a single generic error below.
    }
  }

  return res.status(401).json({ message: "Not authorized to upload images" });
}

// POST /api/uploads/image
router.post("/image", requireImageUploadActor, upload.fields([{ name: "file", maxCount: 1 }, { name: "image", maxCount: 1 }]), async (req, res, next) => {
  const uploadedFile = extractUploadedFile(req);
  if (!uploadedFile) return res.status(400).json({ message: "No file uploaded" });
  try {
    const uploadedImage = await saveImageBufferAsWebp(uploadedFile.buffer, {
      prefix: "upload",
      maxWidth: 1800,
      maxHeight: 1800,
      quality: 82,
    });

    return res.json({
      url: uploadedImage.publicUrl,
      path: uploadedImage.relativePath,
      format: uploadedImage.format,
      size: uploadedImage.size,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/uploads/certificate — admin-only, CSRF-protected by the global API middleware.
router.post("/certificate", protect, adminOnly, certificateUpload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: "No certificate file uploaded" });
  try {
    if (req.file.mimetype.startsWith("image/")) {
      const uploaded = await saveImageBufferAsWebp(req.file.buffer, {
        subdir: "certificates",
        prefix: "certificate",
        maxWidth: 2400,
        maxHeight: 2400,
        quality: 88,
      });
      return res.json({ url: uploaded.publicUrl, path: uploaded.relativePath, format: uploaded.format, size: uploaded.size });
    }

    if (req.file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(400).json({ message: "Certificate PDF signature is invalid" });
    }
    const directory = path.join(UPLOADS_ROOT, "certificates");
    await fs.mkdir(directory, { recursive: true });
    const fileName = `certificate-${Date.now()}-${crypto.randomBytes(12).toString("hex")}.pdf`;
    const relativePath = `certificates/${fileName}`;
    await fs.writeFile(path.join(directory, fileName), req.file.buffer, { flag: "wx" });
    return res.json({
      url: buildPublicUploadUrl(relativePath),
      path: relativePath,
      format: "pdf",
      size: req.file.buffer.length,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
