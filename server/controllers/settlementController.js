const VendorSettlement = require("../models/VendorSettlement");
const OrderItem = require("../models/OrderItem");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function serializeSettlement(settlement) {
  return {
    ...settlement,
    id: String(settlement._id),
    vendor_id: settlement.vendor_id?._id?.toString?.() || settlement.vendor_id?.toString?.() || null,
    vendor: settlement.vendor_id && typeof settlement.vendor_id === "object"
      ? {
          id: String(settlement.vendor_id._id),
          owner_name: settlement.vendor_id.owner_name,
          business_name: settlement.vendor_id.business_name,
          shop_name: settlement.vendor_id.shop_name,
          email: settlement.vendor_id.email,
          commission_percent: settlement.vendor_id.commission_percent,
        }
      : undefined,
    initiated_by: settlement.initiated_by?._id?.toString?.() || settlement.initiated_by?.toString?.() || null,
    line_count: Number(settlement.line_count || 0),
    gross_amount: Number(settlement.gross_amount || 0),
    commission_amount: Number(settlement.commission_amount || 0),
    commission_gst_amount: Number(settlement.commission_gst_amount || 0),
    tds_amount: Number(settlement.tds_amount || 0),
    chargeback_amount: Number(settlement.chargeback_amount || 0),
    net_payable: Number(settlement.net_payable || 0),
  };
}

async function getSettlementWithItems(filter) {
  const settlement = await VendorSettlement.findOne(filter)
    .populate("vendor_id", "owner_name business_name shop_name email commission_percent")
    .populate("initiated_by", "full_name email")
    .lean();

  if (!settlement) return null;

  const items = await OrderItem.find({ payout_settlement_id: settlement._id }).lean();
  return {
    ...serializeSettlement(settlement),
    items: items.map((item) => ({
      ...item,
      id: String(item._id),
    })),
  };
}

const listSettlements = async (req, res) => {
  try {
    const query = {};
    const vendorId = String(req.query.vendor_id || "").trim();
    const status = String(req.query.status || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const limit = clamp(parseInt(req.query.limit || "10", 10) || 10, 1, 100);

    if (vendorId) query.vendor_id = vendorId;
    if (status && status !== "all") query.status = status;
    if (from || to) {
      query.period_start = {};
      if (from) query.period_start.$gte = new Date(from);
      if (to) query.period_start.$lte = new Date(to);
    }

    const total = await VendorSettlement.countDocuments(query);
    const settlements = await VendorSettlement.find(query)
      .populate("vendor_id", "owner_name business_name shop_name email commission_percent")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      items: settlements.map((settlement) => serializeSettlement(settlement)),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSettlement = async (req, res) => {
  try {
    const settlement = await getSettlementWithItems({ _id: req.params.id });
    if (!settlement) return res.status(404).json({ message: "Settlement not found" });
    res.json(settlement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const downloadSettlementInvoice = async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.vendor?._id || req.vendor?.id) {
      filter.vendor_id = req.vendor._id || req.vendor.id;
    }
    const settlement = await VendorSettlement.findOne(filter).lean();
    if (!settlement) return res.status(404).json({ message: "Settlement not found" });
    if (!settlement.invoice?.html) return res.status(404).json({ message: "Settlement invoice is not available" });
    const fileName = `${settlement.invoice.invoice_number || settlement.settlement_number || "settlement"}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(settlement.invoice.html);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const listVendorSettlements = async (req, res) => {
  try {
    const vendorId = req.vendor?._id || req.vendor?.id;
    const settlements = await VendorSettlement.find({ vendor_id: vendorId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items: settlements.map((settlement) => serializeSettlement(settlement)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVendorSettlement = async (req, res) => {
  try {
    const vendorId = req.vendor?._id || req.vendor?.id;
    const settlement = await getSettlementWithItems({ _id: req.params.id, vendor_id: vendorId });
    if (!settlement) return res.status(404).json({ message: "Settlement not found" });
    res.json(settlement);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markSettlementPaidManual = async (req, res) => {
  try {
    const settlement = await VendorSettlement.findById(req.params.id);
    if (!settlement) return res.status(404).json({ message: "Settlement not found" });
    if (settlement.status === "paid") return res.status(400).json({ message: "Settlement is already marked as paid" });
    if (settlement.status === "reversed") return res.status(400).json({ message: "Reversed settlements cannot be marked as paid" });

    const paidAt = req.body.paid_at ? new Date(req.body.paid_at) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ message: "Enter a valid paid date" });
    }

    const utrNumber = String(req.body.utr_number || "").trim() || null;

    settlement.status = "paid";
    settlement.payout_provider = "manual";
    settlement.utr_number = utrNumber;
    settlement.payout_reference = utrNumber;
    settlement.initiated_at = settlement.initiated_at || new Date();
    settlement.processed_at = paidAt;
    settlement.failed_reason = null;
    await settlement.save();

    const detail = await getSettlementWithItems({ _id: settlement._id });
    res.json(detail);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  listSettlements,
  getSettlement,
  downloadSettlementInvoice,
  listVendorSettlements,
  getVendorSettlement,
  markSettlementPaidManual,
};
