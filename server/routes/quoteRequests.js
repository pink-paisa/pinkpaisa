const express = require("express");
const router = express.Router();
const QuoteRequest = require("../models/QuoteRequest");
const WorkshopSession = require("../models/WorkshopSession");
const { protect, optionalProtect, adminOnly } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/requestGuards");
const { requireCaptcha } = require("../middleware/captcha");
const { applyQueryParams } = require("../controllers/orderController");
const { sendQuoteRequestReceivedEmails } = require("../utils/email");
const { normalizeMarketingAttribution } = require("../utils/marketingAttribution");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });
const quoteRequestLimiter = createRateLimiter({
  keyPrefix: "quote-request",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many quote requests. Please wait before trying again.",
});

function sessionPayload(body = {}) {
  const text = (value, max = 500) => String(value || "").trim().slice(0, max) || null;
  const payload = {
    title: text(body.title, 200),
    workshop_id: text(body.workshop_id, 100),
    session_date: body.session_date ? new Date(body.session_date) : null,
    session_time: text(body.session_time, 80),
    duration: text(body.duration, 100),
    trainer: text(body.trainer, 200),
    delivery_mode: text(body.delivery_mode, 80) || "Online",
    venue_or_link: text(body.venue_or_link, 1000),
    max_participants: Math.min(Math.max(Number(body.max_participants) || 50, 1), 10000),
    status: text(body.status, 40) || "planned",
    internal_notes: text(body.internal_notes, 4000),
  };
  if (!payload.title) {
    const error = new Error("Session title is required");
    error.status = 400;
    throw error;
  }
  if (payload.session_date && Number.isNaN(payload.session_date.getTime())) {
    const error = new Error("Session date is invalid");
    error.status = 400;
    throw error;
  }
  return payload;
}

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

router.post("/", optionalProtect, quoteRequestLimiter, requireCaptcha({ action: "workshop_quote" }), async (req, res) => {
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
      attribution: normalizeMarketingAttribution(req.body.attribution),
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
    const updates = {};
    if (req.body.status !== undefined) updates.status = String(req.body.status || "").trim().slice(0, 40);
    if (req.body.internal_notes !== undefined) updates.internal_notes = String(req.body.internal_notes || "").trim().slice(0, 4000) || null;
    if (!Object.keys(updates).length) return res.status(400).json({ message: "No supported quote updates were provided" });
    const qr = await QuoteRequest.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).lean();
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
    const s = await WorkshopSession.create(sessionPayload(req.body));
    res.status(201).json(toFlat(s.toObject()));
  } catch (err) { res.status(Number(err.status) || 400).json({ message: err.message }); }
});

router.put("/sessions/:id", protect, adminOnly, async (req, res) => {
  try {
    const session = await WorkshopSession.findByIdAndUpdate(
      req.params.id,
      { $set: sessionPayload(req.body) },
      { new: true, runValidators: true },
    ).lean();
    if (!session) return res.status(404).json({ message: "Workshop session not found" });
    return res.json(toFlat(session));
  } catch (err) {
    return res.status(Number(err.status) || 400).json({ message: err.message });
  }
});

router.delete("/sessions/:id", protect, adminOnly, async (req, res) => {
  try {
    const session = await WorkshopSession.findByIdAndDelete(req.params.id).lean();
    if (!session) return res.status(404).json({ message: "Workshop session not found" });
    return res.json({ success: true, id: String(session._id) });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

module.exports = router;
