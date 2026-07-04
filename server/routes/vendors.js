const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { protectVendor } = require("../middleware/vendorAuth");
const { createRateLimiter } = require("../middleware/requestGuards");
const {
  registerVendor,
  loginVendor,
  logoutVendor,
  getVendorMe,
  updateVendorBusiness,
  updateVendorContact,
  updateVendorAddress,
  updateVendorBank,
  upsertVendorKycDocument,
  deleteVendorKycDocument,
  getVendorApplicationStatus,
  resubmitVendorApplication,
  listVendorsForAdmin,
  getVendorForAdmin,
  updateVendorStatus,
  requestVendorEmailVerification,
  confirmVendorEmailVerification,
  requestVendorPasswordReset,
  resetVendorPassword,
} = require("../controllers/vendorController");

const vendorAuthLimiter = createRateLimiter({
  keyPrefix: "vendor-public",
  max: 20,
  message: "Too many vendor portal requests. Please wait a bit and try again.",
});

router.post("/register", vendorAuthLimiter, registerVendor);
router.post("/login", vendorAuthLimiter, loginVendor);
router.post("/application-status", vendorAuthLimiter, getVendorApplicationStatus);
router.put("/application-status", vendorAuthLimiter, resubmitVendorApplication);
router.post("/verify/request", vendorAuthLimiter, requestVendorEmailVerification);
router.get("/verify/confirm", confirmVendorEmailVerification);
router.post("/password/forgot", vendorAuthLimiter, requestVendorPasswordReset);
router.post("/password/reset", vendorAuthLimiter, resetVendorPassword);
router.get("/me", protectVendor, getVendorMe);
router.put("/me/business", protectVendor, updateVendorBusiness);
router.put("/me/contact", protectVendor, updateVendorContact);
router.put("/me/address", protectVendor, updateVendorAddress);
router.put("/me/bank", protectVendor, updateVendorBank);
router.post("/me/kyc-documents", protectVendor, upsertVendorKycDocument);
router.delete("/me/kyc-documents/:kind", protectVendor, deleteVendorKycDocument);
router.post("/logout", protectVendor, logoutVendor);
router.get("/", protect, adminOnly, listVendorsForAdmin);
router.get("/:id", protect, adminOnly, getVendorForAdmin);
router.put("/:id/status", protect, adminOnly, updateVendorStatus);

module.exports = router;
