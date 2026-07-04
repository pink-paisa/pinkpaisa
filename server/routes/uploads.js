const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const multer = require("multer");
const User = require("../models/User");
const Vendor = require("../models/Vendor");
const { getJwtSecret } = require("../utils/authConfig");
const { getCustomerSessionToken } = require("../utils/customerSession");
const { extractVendorToken, getVendorJwtSecret } = require("../utils/vendorSession");
const { saveImageBufferAsWebp } = require("../utils/imageUpload");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) return cb(null, true);
    cb(new Error("Only image files are allowed"));
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
      const user = await User.findById(decoded.id).select("role").lean();
      if (user?.role === "admin") {
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

module.exports = router;
