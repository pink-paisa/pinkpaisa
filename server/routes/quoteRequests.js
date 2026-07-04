const express = require("express");
const router = express.Router();
const QuoteRequest = require("../models/QuoteRequest");
const WorkshopSession = require("../models/WorkshopSession");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/requestGuards");
const { requireCaptcha } = require("../middleware/captcha");
const { applyQueryParams } = require("../controllers/orderController");
const { sendQuoteRequestReceivedEmails } = require("../utils/email");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });
const quoteRequestLimiter = createRateLimiter({
  keyPrefix: "quote-request",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many quote requests. Please wait before trying again.",
});

// Quote Requests
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    let q = QuoteRequest.find();
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ createdAt: -1 });
    const items = await q.lean();
    res.json(items.map(toFlat));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post("/", optionalProtect, quoteRequestLimiter, requireCaptcha(), async (req, res) => {
  try {
    const payload = {
      user_id: req.user?._id?.toString?.() || null,
      company_name: String(req.body.company_name || "").trim(),
      contact_name: String(req.body.contact_name || "").trim(),
      email: String(req.body.email || "").trim().toLowerCase(),
      phone: String(req.body.phone || "").trim(),
      team_size: req.body.team_size ? Number(req.body.team_size) : null,
      goals: String(req.body.goals || "").trim() || null,
      preferred_format: String(req.body.preferred_format || "").trim() || null,
      budget: String(req.body.budget || "").trim() || null,
      status: "new",
    };
    if (!payload.company_name || !payload.contact_name || !payload.email || !payload.phone) {
      return res.status(400).json({ message: "Company, contact name, email, and phone are required" });
    }

    const qr = await QuoteRequest.create(payload);
    void sendQuoteRequestReceivedEmails({ quoteRequest: qr.toObject() }).catch(() => null);
    res.status(201).json(toFlat(qr.toObject()));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const qr = await QuoteRequest.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!qr) return res.status(404).json({ message: "Not found" });
    res.json(toFlat(qr));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

// Workshop Sessions (co-located here for simplicity)
router.get("/sessions", protect, adminOnly, async (req, res) => {
  try {
    let q = WorkshopSession.find();
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ session_date: 1 });
    const items = await q.lean();
    res.json(items.map(toFlat));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post("/sessions", protect, adminOnly, async (req, res) => {
  try {
    const s = await WorkshopSession.create(req.body);
    res.status(201).json(toFlat(s.toObject()));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

module.exports = router;
