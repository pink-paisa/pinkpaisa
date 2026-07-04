const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const VendorUploadLog = require("../models/VendorUploadLog");
const ProductCategory = require("../models/ProductCategory");
const { validateVendorPayload } = require("../utils/vendorValidation");
const { clearVendorAuthCookie, setVendorAuthCookie, signVendorToken } = require("../utils/vendorSession");
const { createSecureToken, hashToken } = require("../utils/tokens");
const { sendVendorPasswordResetEmail, sendVendorVerificationEmail, getPublicAppUrl } = require("../utils/email");
const { buildLockedError, clearLoginFailures, isAccountLocked, recordFailedLogin } = require("../utils/loginProtection");
const { assertPasswordPolicy } = require("../utils/passwordPolicy");
const { getVendorBankCooldownEndsAt, getVendorBankPayoutBlockReason } = require("../utils/vendorBankStatus");

const DEFAULT_VENDOR_UPLOAD_LIMIT = 25;
const DEFAULT_VENDOR_COMMISSION = 20;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const GENERIC_RESET_MESSAGE = "If a vendor account exists for that email, a reset link has been sent.";
const GENERIC_VERIFY_MESSAGE = "If a vendor account exists for that email, a verification link has been sent.";
const VENDOR_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VENDOR_MOBILE_REGEX = /^[6-9][0-9]{9}$/;
const VENDOR_IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const KYC_DOCUMENT_FIELD_BY_KIND = {
  pan: "pan_url",
  gst: "gst_certificate_url",
  aadhaar: "aadhaar_url",
  cheque: "cancelled_cheque_url",
};

async function getAssignedCategories(vendor) {
  const ids = (vendor.assigned_category_ids || []).map((item) => item?._id?.toString?.() || item?.toString?.() || item).filter(Boolean);
  if (!ids.length) return [];
  const categories = await ProductCategory.find({ _id: { $in: ids } }).sort({ sort_order: 1, name: 1 }).lean();
  return categories.map((category) => ({
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    is_active: category.is_active,
  }));
}

const serializeVendor = async (vendor) => {
  const vendorId = vendor._id?.toString?.() || vendor.id;
  const [uploaded, pendingApproval, approved, rejected, uploadCount, assignedCategories] = await Promise.all([
    VendorProduct.countDocuments({ vendor_id: vendorId }),
    VendorProduct.countDocuments({ vendor_id: vendorId, approval_status: "pending_approval" }),
    VendorProduct.countDocuments({ vendor_id: vendorId, approval_status: "approved" }),
    VendorProduct.countDocuments({ vendor_id: vendorId, approval_status: "rejected" }),
    VendorUploadLog.countDocuments({ vendor_id: vendorId }),
    getAssignedCategories(vendor),
  ]);
  const limit = vendor.max_products_allowed ?? DEFAULT_VENDOR_UPLOAD_LIMIT;
  return {
    id: vendorId,
    owner_name: vendor.owner_name,
    mobile: vendor.mobile,
    email: vendor.email,
    business_name: vendor.business_name,
    shop_name: vendor.shop_name,
    business_type: vendor.business_type,
    gstin: vendor.gstin,
    pan: vendor.pan,
    address: vendor.address,
    city: vendor.city,
    state: vendor.state,
    pincode: vendor.pincode,
    website: vendor.website,
    status: vendor.status,
    email_verified: Boolean(vendor.email_verified),
    max_products_allowed: limit,
    commission_percent: vendor.commission_percent ?? DEFAULT_VENDOR_COMMISSION,
    current_uploaded_count: uploaded,
    remaining_slots: Math.max(limit - uploaded, 0),
    pending_products_count: pendingApproval,
    approved_products_count: approved,
    rejected_products_count: rejected,
    assigned_categories: assignedCategories,
    has_category_restrictions: assignedCategories.length > 0,
    admin_notes: vendor.admin_notes,
    verified_at: vendor.verified_at,
    created_at: vendor.created_at,
    updated_at: vendor.updated_at,
    kyc_verified: Boolean(vendor.kyc_verified),
    bank_verified: Boolean(vendor.bank_verified),
    kyc_documents: vendor.kyc_documents || {},
    bank_changed_at: vendor.bank_changed_at || null,
    bank_cooldown_ends_at: getVendorBankCooldownEndsAt(vendor),
    payout_paused: Boolean(getVendorBankPayoutBlockReason(vendor)),
    payout_pause_reason: getVendorBankPayoutBlockReason(vendor),
    order_reject_count: Number(vendor.order_reject_count || 0),
    auto_ban_threshold: Number(vendor.auto_ban_threshold || 5),
    bank_details: vendor.bank_details || {},
    bank_verification_method: vendor.bank_verification_method || null,
    meta: {
      product_count: uploaded,
      upload_count: uploadCount,
      pending_products_count: pendingApproval,
      approved_products_count: approved,
      rejected_products_count: rejected,
    },
  };
};

function buildVendorVerifyRedirect(success) {
  const base = getPublicAppUrl();
  return `${base}/vendor/login?verified=${success ? "1" : "0"}`;
}

async function issueVendorVerification(vendor) {
  const { raw, hash } = createSecureToken();
  vendor.email_verification_token = hash;
  vendor.email_verification_expires_at = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  await vendor.save();
  return sendVendorVerificationEmail({
    email: vendor.email,
    ownerName: vendor.owner_name,
    token: raw,
  });
}

async function issueVendorPasswordReset(vendor) {
  const { raw, hash } = createSecureToken();
  vendor.password_reset_token = hash;
  vendor.password_reset_expires_at = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await vendor.save();
  return sendVendorPasswordResetEmail({
    email: vendor.email,
    ownerName: vendor.owner_name,
    token: raw,
  });
}

const registerVendor = async (req, res) => {
  try {
    const payload = { ...req.body };
    const errors = validateVendorPayload(payload);
    if (Object.keys(errors).length) return res.status(400).json({ message: "Validation failed", errors });

    const email = String(payload.email).trim().toLowerCase();
    const gstin = String(payload.gstin).trim().toUpperCase();
    const pan = String(payload.pan).trim().toUpperCase();

    const existingEmail = await Vendor.findOne({ email }).lean();
    if (existingEmail) return res.status(409).json({ message: "Email already registered", errors: { email: "Email already registered" } });
    const existingGstin = await Vendor.findOne({ gstin }).lean();
    if (existingGstin) return res.status(409).json({ message: "GSTIN already registered", errors: { gstin: "GSTIN already registered" } });

    const vendor = await Vendor.create({
      owner_name: payload.owner_name,
      mobile: String(payload.mobile).trim(),
      email,
      password_hash: payload.password,
      business_name: payload.business_name,
      shop_name: payload.shop_name,
      business_type: payload.business_type,
      gstin,
      pan,
      address: payload.address,
      city: payload.city,
      state: payload.state,
      pincode: String(payload.pincode).trim(),
      website: payload.website || null,
      status: "pending",
      email_verified: false,
      max_products_allowed: DEFAULT_VENDOR_UPLOAD_LIMIT,
      commission_percent: DEFAULT_VENDOR_COMMISSION,
      kyc_verified: false,
      bank_verified: false,
      bank_details: {
        account_holder_name: payload.account_holder_name || null,
        account_number: payload.account_number || null,
        ifsc_code: payload.ifsc_code ? String(payload.ifsc_code).trim().toUpperCase() : null,
        bank_name: payload.bank_name || null,
        branch_name: payload.branch_name || null,
        upi_id: payload.upi_id || null,
      },
      assigned_category_ids: [],
    });

    const preview = await issueVendorVerification(vendor);
    res.status(201).json({
      message: "Vendor application submitted successfully. Please verify your email while admin reviews your onboarding.",
      vendor: await serializeVendor(vendor.toObject()),
      ...(process.env.NODE_ENV !== "production" ? preview : {}),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

async function findVendorByCredentials(email, password, ipAddress) {
  if (!email || !password) throw new Error("Email and password are required");
  const vendor = await Vendor.findOne({ email: String(email).trim().toLowerCase() });
  if (!vendor) {
    const error = new Error("Invalid vendor credentials");
    error.status = 401;
    throw error;
  }
  if (isAccountLocked(vendor)) {
    throw buildLockedError("Vendor account is temporarily locked. Try again in 15 minutes.");
  }
  if (!(await vendor.matchPassword(password))) {
    const lockedNow = await recordFailedLogin(vendor);
    if (lockedNow) {
      throw buildLockedError("Vendor account locked for 15 minutes after repeated failed attempts.");
    }
    const error = new Error("Invalid vendor credentials");
    error.status = 401;
    throw error;
  }
  await clearLoginFailures(vendor, ipAddress);
  if (vendor.status === "banned") {
    const error = new Error("Your vendor account has been banned. Please contact admin.");
    error.status = 403;
    error.vendor_status = vendor.status;
    throw error;
  }
  return vendor;
}

const loginVendor = async (req, res) => {
  try {
    const { email, password } = req.body;
    const vendor = await findVendorByCredentials(email, password, req.ip);
    if (vendor.status !== "verified") {
      clearVendorAuthCookie(res);
      return res.status(403).json({
        message: vendor.status === "rejected" ? "Your vendor account has been rejected. Review the notes below and resubmit your application." : "Your vendor account is not verified yet. Please track your onboarding status.",
        status: vendor.status,
        vendor: await serializeVendor(vendor.toObject()),
      });
    }
    const token = signVendorToken(vendor._id.toString());
    setVendorAuthCookie(res, token);
    res.json({ token, vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    clearVendorAuthCookie(res);
    res.status(err.status || 500).json({ message: err.message, status: err.vendor_status });
  }
};

const getVendorMe = async (req, res) => {
  res.json(await serializeVendor(req.vendor));
};

const updateVendorBusiness = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const businessName = String(req.body.business_name || "").trim();
    const shopName = String(req.body.shop_name || "").trim();
    const businessType = String(req.body.business_type || "").trim();
    const website = String(req.body.website || "").trim() || null;

    if (!businessName || !shopName || !businessType) {
      return res.status(400).json({ message: "Business name, shop name, and business type are required" });
    }

    vendor.business_name = businessName;
    vendor.shop_name = shopName;
    vendor.business_type = businessType;
    vendor.website = website;
    await vendor.save();

    res.json({ message: "Business profile updated", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateVendorContact = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const ownerName = String(req.body.owner_name || "").trim();
    const mobile = String(req.body.mobile || "").trim();
    const nextEmail = String(req.body.email || "").trim().toLowerCase();

    if (!ownerName) return res.status(400).json({ message: "Owner name is required" });
    if (!VENDOR_MOBILE_REGEX.test(mobile)) return res.status(400).json({ message: "Enter a valid 10 digit mobile number" });
    if (!VENDOR_EMAIL_REGEX.test(nextEmail)) return res.status(400).json({ message: "Enter a valid email address" });

    const emailChanged = nextEmail !== String(vendor.email || "").trim().toLowerCase();
    if (emailChanged) {
      const existingEmail = await Vendor.findOne({ email: nextEmail, _id: { $ne: vendor._id } }).lean();
      if (existingEmail) return res.status(409).json({ message: "Email already registered to another vendor" });
      vendor.email = nextEmail;
      vendor.email_verified = false;
      vendor.email_verification_token = null;
      vendor.email_verification_expires_at = null;
    }

    vendor.owner_name = ownerName;
    vendor.mobile = mobile;
    await vendor.save();

    let preview = null;
    if (emailChanged) {
      preview = await issueVendorVerification(vendor);
    }

    res.json({
      message: emailChanged ? "Contact details updated. Please verify your new email address." : "Contact details updated",
      vendor: await serializeVendor(vendor.toObject()),
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateVendorAddress = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const address = String(req.body.address || "").trim();
    const city = String(req.body.city || "").trim();
    const state = String(req.body.state || "").trim();
    const pincode = String(req.body.pincode || "").trim();

    if (!address || !city || !state || !pincode) {
      return res.status(400).json({ message: "Address, city, state, and pincode are required" });
    }
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ message: "Enter a valid 6 digit pincode" });
    }

    vendor.address = address;
    vendor.city = city;
    vendor.state = state;
    vendor.pincode = pincode;
    await vendor.save();

    res.json({ message: "Business address updated", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateVendorBank = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const accountHolderName = String(req.body.account_holder_name || "").trim();
    const accountNumber = String(req.body.account_number || "").trim();
    const ifscCode = String(req.body.ifsc_code || "").trim().toUpperCase();
    const bankName = String(req.body.bank_name || "").trim();
    const branchName = String(req.body.branch_name || "").trim() || null;
    const upiId = String(req.body.upi_id || "").trim() || null;

    if (!accountHolderName || !accountNumber || !ifscCode || !bankName) {
      return res.status(400).json({ message: "Account holder, account number, IFSC code, and bank name are required" });
    }
    if (accountNumber.length < 8) {
      return res.status(400).json({ message: "Enter a valid account number" });
    }
    if (!VENDOR_IFSC_REGEX.test(ifscCode)) {
      return res.status(400).json({ message: "Enter a valid IFSC code" });
    }

    const previous = vendor.bank_details || {};
    const changed =
      String(previous.account_holder_name || "") !== accountHolderName ||
      String(previous.account_number || "") !== accountNumber ||
      String(previous.ifsc_code || "") !== ifscCode ||
      String(previous.bank_name || "") !== bankName ||
      String(previous.branch_name || "") !== String(branchName || "") ||
      String(previous.upi_id || "") !== String(upiId || "");

    vendor.bank_details = {
      account_holder_name: accountHolderName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      bank_name: bankName,
      branch_name: branchName,
      upi_id: upiId,
    };

    if (changed) {
      vendor.bank_verified = false;
      vendor.bank_verification_method = null;
      vendor.bank_changed_at = new Date();
    }

    await vendor.save();

    res.json({
      message: changed ? "Bank details updated. Payouts are paused until Pink Paisa re-verifies them." : "Bank details updated",
      vendor: await serializeVendor(vendor.toObject()),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const upsertVendorKycDocument = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const kind = String(req.body.kind || "").trim().toLowerCase();
    const url = String(req.body.url || "").trim();
    const field = KYC_DOCUMENT_FIELD_BY_KIND[kind];

    if (!field) return res.status(400).json({ message: "Invalid KYC document kind" });
    if (!url) return res.status(400).json({ message: "Document URL is required" });

    vendor.kyc_documents = {
      ...(vendor.kyc_documents || {}),
      [field]: url,
      uploaded_at: new Date(),
    };
    vendor.kyc_verified = false;
    await vendor.save();

    res.json({ message: "KYC document saved", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteVendorKycDocument = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.vendor._id || req.vendor.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const kind = String(req.params.kind || "").trim().toLowerCase();
    const field = KYC_DOCUMENT_FIELD_BY_KIND[kind];
    if (!field) return res.status(400).json({ message: "Invalid KYC document kind" });

    vendor.kyc_documents = {
      ...(vendor.kyc_documents || {}),
      [field]: null,
      uploaded_at: vendor.kyc_documents?.uploaded_at || null,
    };
    vendor.kyc_verified = false;
    await vendor.save();

    res.json({ message: "KYC document removed", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const logoutVendor = async (_req, res) => {
  clearVendorAuthCookie(res);
  res.json({ message: "Vendor logged out" });
};

const getVendorApplicationStatus = async (req, res) => {
  try {
    const vendor = await findVendorByCredentials(req.body.email, req.body.password, req.ip);
    res.json({ vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message, status: err.vendor_status });
  }
};

const resubmitVendorApplication = async (req, res) => {
  try {
    const vendor = await findVendorByCredentials(req.body.email, req.body.password, req.ip);
    if (vendor.status === "verified") return res.status(409).json({ message: "Verified vendors should use the vendor portal instead of resubmitting onboarding." });
    const payload = { ...req.body, email: vendor.email, password: req.body.password, confirm_password: req.body.confirm_password || req.body.password };
    const errors = validateVendorPayload(payload);
    if (Object.keys(errors).length) return res.status(400).json({ message: "Validation failed", errors });

    const nextGstin = String(payload.gstin).trim().toUpperCase();
    const nextPan = String(payload.pan).trim().toUpperCase();
    if (nextGstin !== vendor.gstin) {
      const existingGstin = await Vendor.findOne({ gstin: nextGstin, _id: { $ne: vendor._id } }).lean();
      if (existingGstin) return res.status(409).json({ message: "GSTIN already registered", errors: { gstin: "GSTIN already registered" } });
    }

    vendor.owner_name = payload.owner_name;
    vendor.mobile = String(payload.mobile).trim();
    vendor.password_hash = payload.password;
    vendor.business_name = payload.business_name;
    vendor.shop_name = payload.shop_name;
    vendor.business_type = payload.business_type;
    vendor.gstin = nextGstin;
    vendor.pan = nextPan;
    vendor.address = payload.address;
    vendor.city = payload.city;
    vendor.state = payload.state;
    vendor.pincode = String(payload.pincode).trim();
    vendor.website = payload.website || null;
    vendor.status = "pending";
    vendor.admin_notes = null;
    vendor.verified_at = null;
    vendor.kyc_verified = false;
    vendor.bank_verified = false;
    vendor.bank_details = {
      account_holder_name: payload.account_holder_name || null,
      account_number: payload.account_number || null,
      ifsc_code: payload.ifsc_code ? String(payload.ifsc_code).trim().toUpperCase() : null,
      bank_name: payload.bank_name || null,
      branch_name: payload.branch_name || null,
      upi_id: payload.upi_id || null,
    };
    if (!vendor.email_verified) {
      await issueVendorVerification(vendor);
    } else {
      await vendor.save();
    }
    clearVendorAuthCookie(res);
    res.json({ message: "Application resubmitted successfully", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message, status: err.vendor_status });
  }
};

const listVendorsForAdmin = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 100);
    const status = String(req.query.status || "all");
    const search = String(req.query.search || "").trim();
    const query = {};
    if (status !== "all") query.status = status;
    if (search) {
      query.$or = [
        { owner_name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { gstin: { $regex: search, $options: "i" } },
        { mobile: { $regex: search, $options: "i" } },
        { business_name: { $regex: search, $options: "i" } },
      ];
    }
    const [items, total, counts] = await Promise.all([
      Vendor.find(query).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Vendor.countDocuments(query),
      Vendor.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const countMap = { pending: 0, verified: 0, rejected: 0, banned: 0 };
    for (const entry of counts) countMap[entry._id] = entry.count;
    res.json({ items: await Promise.all(items.map((item) => serializeVendor(item))), pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 1 }, counts: countMap });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVendorForAdmin = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id).lean();
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    res.json(await serializeVendor(vendor));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateVendorStatus = async (req, res) => {
  try {
    const { status, remarks, admin_notes, max_products_allowed, kyc_verified, bank_verified, auto_ban_threshold } = req.body;
    const assignedCategoryIds = Array.isArray(req.body.assigned_category_ids) ? [...new Set(req.body.assigned_category_ids.map((id) => String(id)).filter(Boolean))] : null;
    if (status && !["pending", "verified", "rejected", "banned"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    if (max_products_allowed != null && (Number.isNaN(Number(max_products_allowed)) || Number(max_products_allowed) < 0)) return res.status(400).json({ message: "Max products allowed must be a valid non-negative number" });
    if (assignedCategoryIds) {
      const existingCategories = await ProductCategory.find({ _id: { $in: assignedCategoryIds } }).select("_id").lean();
      if (existingCategories.length !== assignedCategoryIds.length) return res.status(400).json({ message: "One or more assigned categories are invalid" });
    }
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });
    if (status) {
      vendor.status = status;
      vendor.verified_at = status === "verified" ? new Date() : null;
    }
    if (remarks !== undefined || admin_notes !== undefined) vendor.admin_notes = remarks || admin_notes || null;
    if (max_products_allowed != null) vendor.max_products_allowed = Number(max_products_allowed);
    if (assignedCategoryIds) vendor.assigned_category_ids = assignedCategoryIds;
    if (kyc_verified != null) vendor.kyc_verified = Boolean(kyc_verified);
    if (bank_verified != null) vendor.bank_verified = Boolean(bank_verified);
    if (auto_ban_threshold != null && !Number.isNaN(Number(auto_ban_threshold))) vendor.auto_ban_threshold = Number(auto_ban_threshold);
    if (req.body.commission_percent != null) {
      const nextCommission = Number(req.body.commission_percent);
      if (!Number.isNaN(nextCommission) && nextCommission >= 0 && nextCommission <= 100) {
        vendor.commission_percent = nextCommission;
      }
    }
    if (req.body.bank_details) {
      vendor.bank_details = {
        ...vendor.bank_details,
        ...req.body.bank_details,
        ifsc_code: req.body.bank_details.ifsc_code ? String(req.body.bank_details.ifsc_code).trim().toUpperCase() : vendor.bank_details?.ifsc_code || null,
      };
    }
    await vendor.save();
    res.json({ message: "Vendor updated successfully", vendor: await serializeVendor(vendor.toObject()) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const requestVendorEmailVerification = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    let preview = null;
    if (email) {
      const vendor = await Vendor.findOne({ email });
      if (vendor && !vendor.email_verified) {
        preview = await issueVendorVerification(vendor);
      }
    }
    res.json({
      message: GENERIC_VERIFY_MESSAGE,
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const confirmVendorEmailVerification = async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.redirect(buildVendorVerifyRedirect(false));
    }
    const vendor = await Vendor.findOne({
      email_verification_token: hashToken(token),
      email_verification_expires_at: { $gt: new Date() },
    });
    if (!vendor) {
      return res.redirect(buildVendorVerifyRedirect(false));
    }
    vendor.email_verified = true;
    vendor.email_verification_token = null;
    vendor.email_verification_expires_at = null;
    await vendor.save();
    return res.redirect(buildVendorVerifyRedirect(true));
  } catch {
    return res.redirect(buildVendorVerifyRedirect(false));
  }
};

const requestVendorPasswordReset = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    let preview = null;
    if (email) {
      const vendor = await Vendor.findOne({ email });
      if (vendor) {
        preview = await issueVendorPasswordReset(vendor);
      }
    }
    res.json({
      message: GENERIC_RESET_MESSAGE,
      ...(process.env.NODE_ENV !== "production" && preview ? preview : {}),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const resetVendorPassword = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");
    if (!token) return res.status(400).json({ message: "Reset token is required" });
    assertPasswordPolicy(password);
    const vendor = await Vendor.findOne({
      password_reset_token: hashToken(token),
      password_reset_expires_at: { $gt: new Date() },
    });
    if (!vendor) return res.status(400).json({ message: "This reset link is invalid or expired" });
    vendor.password_hash = password;
    vendor.password_reset_token = null;
    vendor.password_reset_expires_at = null;
    vendor.failed_login_attempts = 0;
    vendor.locked_until = null;
    await vendor.save();
    const authToken = signVendorToken(vendor._id.toString());
    setVendorAuthCookie(res, authToken);
    res.json({
      token: authToken,
      vendor: await serializeVendor(vendor.toObject()),
      message: "Password reset successful",
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

module.exports = {
  DEFAULT_VENDOR_UPLOAD_LIMIT,
  DEFAULT_VENDOR_COMMISSION,
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
  serializeVendor,
};
