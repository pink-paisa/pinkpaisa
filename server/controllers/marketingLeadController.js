const MarketingLead = require("../models/MarketingLead");
const EmailOutbox = require("../models/EmailOutbox");
const {
  captureMarketingLead,
  normalizeLeadStatus,
  unsubscribeMarketingLead,
} = require("../services/marketingLeadService");

function publicLead(lead, outbox = null) {
  const value = lead?.toObject ? lead.toObject() : lead;
  return {
    id: String(value?._id || value?.id || ""),
    result_type: value?.result_type || null,
    status: value?.status || null,
    email_queued: Boolean(outbox),
    email_status: outbox?.status || null,
    created_at: value?.createdAt || null,
  };
}

async function createMarketingLead(req, res) {
  try {
    const result = await captureMarketingLead({
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    return res.status(result.reused ? 200 : 201).json({
      lead: publicLead(result.lead, result.outbox),
      reused: result.reused,
    });
  } catch (error) {
    return res.status(Number(error.status) || 400).json({
      message: error.message,
      code: error.code || "marketing_lead_capture_failed",
    });
  }
}

async function unsubscribe(req, res) {
  try {
    const result = await unsubscribeMarketingLead(req.body?.token || req.query?.token || "");
    return res.json({ unsubscribed: true, reused: result.reused });
  } catch (error) {
    return res.status(Number(error.status) || 400).json({
      message: error.message,
      code: error.code || "marketing_unsubscribe_failed",
    });
  }
}

function buildLeadFilter(query = {}) {
  const filter = {};
  const status = normalizeLeadStatus(query.status);
  if (status) filter.status = status;
  const resultType = String(query.result_type || "").trim().toLowerCase();
  if (resultType) filter.result_type = resultType;
  const search = String(query.search || "").trim().slice(0, 120);
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(safe, "i");
    filter.$or = [{ email: regex }, { first_name: regex }, { phone: regex }];
  }
  return filter;
}

function adminLead(row) {
  return {
    id: String(row._id),
    source: row.source,
    result_type: row.result_type,
    first_name: row.first_name || null,
    email: row.email,
    phone: row.phone || null,
    status: row.status,
    email_consent: row.email_consent,
    whatsapp_consent: row.whatsapp_consent,
    attribution: row.attribution || null,
    last_captured_at: row.last_captured_at || null,
    last_contacted_at: row.last_contacted_at || null,
    unsubscribed_at: row.unsubscribed_at || null,
    internal_notes: row.internal_notes || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function listMarketingLeads(req, res) {
  try {
    const page = Math.max(Number.parseInt(req.query.page || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "50", 10) || 50, 1), 200);
    const filter = buildLeadFilter(req.query);
    const [rows, total] = await Promise.all([
      MarketingLead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      MarketingLead.countDocuments(filter),
    ]);
    return res.json({
      items: rows.map(adminLead),
      page,
      limit,
      total,
      pages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

async function updateMarketingLead(req, res) {
  try {
    const status = req.body.status === undefined ? undefined : normalizeLeadStatus(req.body.status);
    if (req.body.status !== undefined && !status) {
      return res.status(400).json({ message: "Invalid marketing lead status" });
    }
    const updates = {};
    if (status) {
      updates.status = status;
      if (status === "CONTACTED") updates.last_contacted_at = new Date();
      if (status === "UNSUBSCRIBED") {
        updates.unsubscribed_at = new Date();
        updates["email_consent.granted"] = false;
        updates["whatsapp_consent.granted"] = false;
      }
    }
    if (req.body.internal_notes !== undefined) {
      updates.internal_notes = String(req.body.internal_notes || "").trim().slice(0, 4000) || null;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No supported lead updates were provided" });
    }
    const lead = await MarketingLead.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).lean();
    if (!lead) return res.status(404).json({ message: "Marketing lead not found" });
    if (status === "UNSUBSCRIBED") {
      await EmailOutbox.updateMany(
        { lead_id: lead._id, status: { $in: ["QUEUED", "RETRY"] } },
        { $set: { status: "CANCELLED", last_error: "Lead unsubscribed by administrator", next_attempt_at: null } },
      );
    }
    return res.json(adminLead(lead));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportMarketingLeadsCsv(req, res) {
  try {
    const rows = await MarketingLead.find(buildLeadFilter(req.query)).sort({ createdAt: -1 }).limit(50_000).lean();
    const headers = ["id", "created_at", "status", "result_type", "first_name", "email", "phone", "email_consent", "whatsapp_consent", "utm_source", "utm_medium", "utm_campaign", "internal_notes"];
    const lines = [headers.map(csvCell).join(",")];
    for (const row of rows) {
      lines.push([
        row._id,
        row.createdAt?.toISOString?.() || row.createdAt,
        row.status,
        row.result_type,
        row.first_name,
        row.email,
        row.phone,
        Boolean(row.email_consent?.granted),
        Boolean(row.whatsapp_consent?.granted),
        row.attribution?.first_touch?.utm_source,
        row.attribution?.first_touch?.utm_medium,
        row.attribution?.first_touch?.utm_campaign,
        row.internal_notes,
      ].map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pink-paisa-marketing-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${lines.join("\r\n")}`);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
}

module.exports = {
  createMarketingLead,
  exportMarketingLeadsCsv,
  listMarketingLeads,
  unsubscribe,
  updateMarketingLead,
  _private: { adminLead, buildLeadFilter, csvCell, publicLead },
};
