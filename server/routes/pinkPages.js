const express = require("express");
const router = express.Router();
const PinkPagesCategory = require("../models/PinkPagesCategory");
const PinkPagesListing = require("../models/PinkPagesListing");
const { applyQueryParams } = require("../controllers/orderController");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/requestGuards");
const { requireCaptcha } = require("../middleware/captcha");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });
const publicSubmissionLimiter = createRateLimiter({
  keyPrefix: "pink-pages-submit",
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: "Too many directory submissions. Please try again later.",
});

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isAdminRequest(req) {
  return req.user?.role === "admin";
}

// ─── Categories ───

router.get("/categories", async (req, res) => {
  try {
    let q = PinkPagesCategory.find();
    if (req.query.status) q = q.where("status").equals(req.query.status);
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ sort_order: 1 });
    const cats = await q.lean();
    res.json(cats.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/categories/:id", async (req, res) => {
  try {
    const cat = await PinkPagesCategory.findById(req.params.id).lean();
    if (!cat) return res.status(404).json({ message: "Category not found" });
    res.json(toFlat(cat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/categories", protect, adminOnly, async (req, res) => {
  try {
    const cat = await PinkPagesCategory.create(req.body);
    res.status(201).json(toFlat(cat.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/categories/:id", protect, adminOnly, async (req, res) => {
  try {
    const cat = await PinkPagesCategory.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!cat) return res.status(404).json({ message: "Category not found" });
    res.json(toFlat(cat));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/categories/:id", protect, adminOnly, async (req, res) => {
  try {
    const cat = await PinkPagesCategory.findByIdAndDelete(req.params.id);
    if (!cat) return res.status(404).json({ message: "Category not found" });
    res.json({ message: "Category deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Listings ───

router.get("/listings", optionalProtect, async (req, res) => {
  try {
    let q = PinkPagesListing.find();
    const queryForFilters = { query: { ...req.query } };
    if (isAdminRequest(req)) {
      if (req.query.status) q = q.where("status").equals(req.query.status);
      if (req.query.verified) q = q.where("verified").equals(req.query.verified === "true");
    } else {
      q = q.where("status").equals("active");
      q = q.where("verified").equals(true);
      delete queryForFilters.query.status;
      delete queryForFilters.query.verified;
    }
    if (req.query.q) {
      const needle = String(req.query.q).trim();
      if (needle) {
        const regex = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        q = q.find({
          $or: [
            { business_name: regex },
            { short_description: regex },
            { city: regex },
            { state: regex },
          ],
        });
      }
    }
    delete queryForFilters.query.q;
    q = applyQueryParams(q, queryForFilters);
    if (!req.query._sort) q = q.sort({ sort_order: 1 });
    const listings = await q.lean();

    // Attach category_name by looking up each category
    const catIds = [...new Set(listings.map((l) => l.category_id).filter(Boolean))];
    const cats = catIds.length
      ? await PinkPagesCategory.find({ _id: { $in: catIds } }).lean()
      : [];
    const catMap = Object.fromEntries(cats.map((c) => [c._id.toString(), c.name]));

    res.json(
      listings.map((l) => ({
        ...toFlat(l),
        category_name: catMap[l.category_id] ?? null,
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/listings/:id", optionalProtect, async (req, res) => {
  try {
    let listing = null;
    if (req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      listing = await PinkPagesListing.findById(req.params.id).lean();
    }
    if (!listing) listing = await PinkPagesListing.findOne({ slug: req.params.id }).lean();
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (!isAdminRequest(req) && (listing.status !== "active" || listing.verified !== true)) {
      return res.status(404).json({ message: "Listing not found" });
    }
    res.json(toFlat(listing));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/listings/submit", optionalProtect, publicSubmissionLimiter, requireCaptcha(), async (req, res) => {
  try {
    const businessName = String(req.body.business_name || "").trim();
    const categoryId = String(req.body.category_id || "").trim() || null;
    const phone = String(req.body.phone || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!businessName || !phone || !email) {
      return res.status(400).json({ message: "Business name, phone, and email are required" });
    }

    const baseSlug = slugify(req.body.slug || businessName) || `business-${Date.now()}`;
    let slug = baseSlug;
    let suffix = 1;
    while (await PinkPagesListing.exists({ slug })) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const listing = await PinkPagesListing.create({
      category_id: categoryId,
      business_name: businessName,
      slug,
      short_description: String(req.body.short_description || "").trim() || null,
      full_description: String(req.body.full_description || "").trim() || null,
      contact_person: String(req.body.contact_person || "").trim() || null,
      phone,
      email,
      whatsapp: String(req.body.whatsapp || "").trim() || null,
      website: String(req.body.website || "").trim() || null,
      address: String(req.body.address || "").trim() || null,
      city: String(req.body.city || "").trim() || null,
      state: String(req.body.state || "").trim() || null,
      pincode: String(req.body.pincode || "").trim() || null,
      logo: String(req.body.logo || "").trim() || null,
      featured: false,
      verified: false,
      status: "pending",
      sort_order: 0,
      meta_title: null,
      meta_description: null,
    });

    res.status(201).json(toFlat(listing.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/listings", protect, adminOnly, async (req, res) => {
  try {
    const listing = await PinkPagesListing.create(req.body);
    res.status(201).json(toFlat(listing.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/listings/:id", protect, adminOnly, async (req, res) => {
  try {
    const payload = { ...req.body };
    delete payload.category_name;
    delete payload.pink_pages_categories;
    const listing = await PinkPagesListing.findByIdAndUpdate(req.params.id, payload, { new: true }).lean();
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    res.json(toFlat(listing));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/listings/:id", protect, adminOnly, async (req, res) => {
  try {
    const listing = await PinkPagesListing.findByIdAndDelete(req.params.id);
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    res.json({ message: "Listing deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
