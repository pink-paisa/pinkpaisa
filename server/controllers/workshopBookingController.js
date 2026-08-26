const crypto = require("crypto");
const { StandardCheckoutPayRequest } = require("@phonepe-pg/pg-sdk-node");
const WorkshopBooking = require("../models/WorkshopBooking");
const Workshop = require("../models/Workshop");
const PendingPayment = require("../models/PendingPayment");
const { getPhonepeClient, isDirectPaymentsLive } = require("../utils/phonepeClient");
const {
  createGuestWorkshopReceiptToken,
  verifyGuestWorkshopReceiptToken,
} = require("../utils/workshopReceiptToken");
const logger = require("../utils/logger");
const { applyQueryParams } = require("./orderController");
const { normalizeMarketingAttribution } = require("../utils/marketingAttribution");
const { createPaymentVerificationSecret } = require("../utils/paymentVerificationSecret");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });

function buildPublicWorkshopReceipt(booking) {
  return {
    id: String(booking._id || booking.id),
    workshop_id: booking.workshop_id || null,
    workshop_title: booking.workshop_title,
    full_name: booking.full_name,
    team_size: Number(booking.team_size || 1),
    preferred_date: booking.preferred_date || null,
    preferred_time: booking.preferred_time || null,
    delivery_mode: booking.delivery_mode || "Online",
    subtotal: Number(booking.subtotal || 0),
    addons_total: Number(booking.addons_total || 0),
    total: Number(booking.total || 0),
    payment_status: booking.payment_status,
    booking_status: booking.booking_status,
    createdAt: booking.createdAt || null,
    updatedAt: booking.updatedAt || null,
  };
}

function getPendingPaymentExpiryDate() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function getClientBaseUrl() {
  return String(
    process.env.CLIENT_URL || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:3000"
  )
    .trim()
    .replace(/\/+$/, "");
}

function normalizeString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function generateWorkshopMerchantOrderId(userId) {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const userPart = String(userId || "GUEST").replace(/[^A-Z0-9]/gi, "").slice(-8) || "GUEST";
  return `WB_${userPart}_${Date.now()}_${suffix}`;
}

function buildWorkshopPricing(workshop, payload) {
  const teamSize = Math.max(1, Number(payload.team_size) || 1);
  const minPeople = Math.max(1, Number(workshop.min_people) || 1);
  if (teamSize < minPeople) {
    const error = new Error(`Minimum group size for this workshop is ${minPeople}`);
    error.status = 400;
    throw error;
  }

  const subtotal = Number(workshop.price || 0) * teamSize;
  const recordingAddon = Boolean(payload.recording_addon) && Boolean(workshop.recording_addon_available);
  const certificationAddon = Boolean(payload.certification_addon) && Boolean(workshop.certification_addon_available);
  const recordingCost = recordingAddon ? Number(workshop.recording_addon_price || 0) : 0;
  const certificationCost = certificationAddon ? Number(workshop.certification_addon_price || 0) * teamSize : 0;
  const addonsTotal = recordingCost + certificationCost;
  const total = subtotal + addonsTotal;

  return {
    teamSize,
    recordingAddon,
    certificationAddon,
    subtotal,
    addonsTotal,
    total,
  };
}

const getBookings = async (req, res) => {
  try {
    let q = WorkshopBooking.find();
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ createdAt: -1 });
    const bookings = await q.lean();
    res.json(bookings.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getBooking = async (req, res) => {
  try {
    const booking = await WorkshopBooking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const isAdmin = req.user?.role === "admin";
    const ownsBooking = Boolean(req.user?._id) && String(booking.user_id || "") === String(req.user._id);
    if (!isAdmin && !ownsBooking) {
      const token = String(req.headers?.["x-workshop-receipt-token"] || req.query.t || "").trim();
      if (!token) return res.status(401).json({ message: "Receipt token is required" });
      verifyGuestWorkshopReceiptToken(token, req.params.id);
    }
    res.json(buildPublicWorkshopReceipt(booking));
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

const createBooking = async (req, res) => {
  try {
    const workshopId = normalizeString(req.body.workshop_id);
    if (!workshopId) {
      return res.status(400).json({ message: "Workshop is required" });
    }

    const workshop = await Workshop.findById(workshopId).lean();
    if (!workshop || workshop.status !== "active") {
      return res.status(404).json({ message: "Workshop not found" });
    }
    if (workshop.custom_quote_enabled) {
      return res.status(409).json({ message: "This workshop requires a custom quote. Please request a quote instead." });
    }

    const payload = {
      user_id: req.user?._id?.toString?.() || null,
      workshop_id: workshop._id.toString(),
      workshop_title: workshop.title,
      full_name: normalizeString(req.body.full_name) || req.user?.full_name || null,
      company_name: normalizeString(req.body.company_name),
      contact_person: normalizeString(req.body.contact_person),
      email: normalizeString(req.body.email) || req.user?.email || null,
      phone: normalizeString(req.body.phone) || req.user?.phone || null,
      organization_type: normalizeString(req.body.organization_type),
      preferred_date: normalizeString(req.body.preferred_date),
      preferred_time: normalizeString(req.body.preferred_time),
      city: normalizeString(req.body.city),
      delivery_mode: normalizeString(req.body.delivery_mode) || "Online",
      venue_address: normalizeString(req.body.venue_address),
      notes: normalizeString(req.body.notes),
      internal_notes: null,
      attribution: normalizeMarketingAttribution(req.body.attribution),
    };
    if (!payload.full_name || !payload.email || !payload.phone) {
      return res.status(400).json({ message: "Workshop, name, email, and phone are required" });
    }

    if (!isDirectPaymentsLive()) {
      return res.status(503).json({
        code: "direct_payments_not_live",
        message: "Direct workshop payments are not live yet. Please request a quote instead.",
      });
    }

    const client = getPhonepeClient();
    if (!client) {
      return res.status(503).json({ message: "Payment gateway is not configured" });
    }

    const pricing = buildWorkshopPricing(workshop, req.body);
    if (pricing.total <= 0) {
      return res.status(400).json({ message: "Workshop total must be greater than zero" });
    }

    const merchantOrderId = generateWorkshopMerchantOrderId(req.user?._id?.toString?.());
    const paymentVerification = createPaymentVerificationSecret();

    const booking = await WorkshopBooking.create({
      ...payload,
      team_size: pricing.teamSize,
      recording_addon: pricing.recordingAddon,
      certification_addon: pricing.certificationAddon,
      subtotal: pricing.subtotal,
      addons_total: pricing.addonsTotal,
      total: pricing.total,
      payment_method: "phonepe",
      payment_status: "pending",
      booking_status: "draft",
      merchant_order_id: merchantOrderId,
    });
    const receiptToken = createGuestWorkshopReceiptToken(booking);

    let pending = null;
    try {
      pending = await PendingPayment.create({
        merchant_order_id: merchantOrderId,
        verification_secret_hash: paymentVerification.secret_hash,
        purpose: "workshop_booking",
        reference_id: booking._id.toString(),
        metadata: {
          workshop_id: workshop._id.toString(),
          workshop_title: workshop.title,
        },
        attribution: payload.attribution,
        user_id: req.user?._id || null,
        guest_name: payload.full_name,
        guest_email: payload.email,
        guest_phone: payload.phone,
        shipping_address: null,
        shipping_city: null,
        shipping_state: null,
        shipping_pincode: null,
        subtotal: pricing.subtotal,
        shipping_cost: 0,
        total: pricing.total,
        cart_items: [],
        reserved_items: [],
        status: "initiated",
        processing_started_at: null,
        expires_at: getPendingPaymentExpiryDate(),
      });

      // The caller keeps receipt/payment capabilities in sessionStorage. Keeping them
      // out of the provider return URL prevents referrer, analytics, and access-log leaks.
      const redirectUrl = `${getClientBaseUrl()}/workshop-booking-confirmation/${booking._id.toString()}`;
      const payRequest = StandardCheckoutPayRequest.builder()
        .merchantOrderId(merchantOrderId)
        .amount(Math.round(pricing.total * 100))
        .redirectUrl(redirectUrl)
        .build();

      const response = await client.pay(payRequest);
      const checkoutUrl = response?.redirectUrl || response?.data?.redirectUrl || null;
      if (!checkoutUrl) {
        throw new Error("Payment gateway did not return a checkout URL");
      }

      return res.status(201).json({
        ...toFlat(booking.toObject()),
        checkout_url: checkoutUrl,
        merchant_order_id: merchantOrderId,
        verification_secret: paymentVerification.secret,
        receipt_token: receiptToken,
      });
    } catch (error) {
      if (pending) {
        pending.status = "failed";
        pending.processing_started_at = null;
        pending.expires_at = null;
        await pending.save().catch(() => null);
      }

      await WorkshopBooking.findByIdAndUpdate(booking._id, {
        payment_status: "failed",
        booking_status: "failed",
      }).catch(() => null);

      logger.error({ err: error, booking_id: booking._id.toString() }, "Workshop booking payment session error");
      return res.status(502).json({ message: "Failed to create workshop payment session" });
    }
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
};

const updateBooking = async (req, res) => {
  try {
    const allowedFields = [
      "booking_status",
      "payment_status",
      "preferred_date",
      "preferred_time",
      "internal_notes",
      "certificate_url",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (Object.hasOwn(req.body || {}, field)) updates[field] = req.body[field];
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No supported booking updates were provided" });
    }
    const booking = await WorkshopBooking.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    res.json(toFlat(booking));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getBookings,
  getBooking,
  createBooking,
  updateBooking,
  _private: { buildPublicWorkshopReceipt },
};
