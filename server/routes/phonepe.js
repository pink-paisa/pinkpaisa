const express = require("express");
const router = express.Router();
const { optionalProtect } = require("../middleware/auth");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const WorkshopBooking = require("../models/WorkshopBooking");
const User = require("../models/User");
const PendingPayment = require("../models/PendingPayment");
const {
  enrichOrderItemsWithProductData,
  reserveInventoryForOrderItems,
  releaseInventoryForOrderItems,
  applyOrderSideEffects,
} = require("../controllers/orderController");
const { calculateShippingCost } = require("../utils/commerceConfig");
const logger = require("../utils/logger");
const { sendOrderConfirmationEmail, sendWorkshopBookingConfirmationEmail } = require("../utils/email");
const { createGuestOrderReceiptToken } = require("../utils/orderReceiptToken");
const { StandardCheckoutClient, StandardCheckoutPayRequest, Env } = require("@phonepe-pg/pg-sdk-node");

let phonepeClient = null;
const CLAIMABLE_PENDING_STATUSES = ["initiated", "pending"];
const EXPIRABLE_PENDING_STATUSES = ["initiated", "pending", "processing"];
const PENDING_PAYMENT_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const PENDING_PAYMENT_CLEANUP_INTERVAL_MS = 60 * 1000;

function getGuestReceiptToken(order) {
  if (!order || order.user_id) return null;
  return createGuestOrderReceiptToken(order);
}

function queuePhonepeOrderConfirmationEmail(order, items = []) {
  const orderPayload = order?.toObject ? order.toObject() : order;
  const orderId = orderPayload?._id?.toString?.() || null;
  void sendOrderConfirmationEmail({ order: orderPayload, items })
    .catch((error) => {
      logger.error({ err: error, order_id: orderId }, "Failed to send PhonePe order confirmation email");
    });
}

function queueWorkshopBookingEmail(booking) {
  const bookingPayload = booking?.toObject ? booking.toObject() : booking;
  const bookingId = bookingPayload?._id?.toString?.() || bookingPayload?.id || null;
  void sendWorkshopBookingConfirmationEmail({ booking: bookingPayload })
    .catch((error) => {
      logger.error({ err: error, booking_id: bookingId }, "Failed to send workshop booking confirmation email");
    });
}

function getPhonepeClient() {
  if (phonepeClient) return phonepeClient;

  const clientId = process.env.PHONEPE_CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
  const clientVersion = Number(process.env.PHONEPE_CLIENT_VERSION || 1);
  const env = (process.env.PHONEPE_ENV || "SANDBOX").toUpperCase() === "PRODUCTION" ? Env.PRODUCTION : Env.SANDBOX;

  if (!clientId || !clientSecret) {
    console.warn("PhonePe credentials not configured - payment requests will be rejected");
    return null;
  }

  phonepeClient = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);
  return phonepeClient;
}

function getPhonepeCallbackCredentials() {
  const username = String(process.env.PHONEPE_CALLBACK_USERNAME || "").trim();
  const password = String(process.env.PHONEPE_CALLBACK_PASSWORD || "").trim();

  if (!username || !password) {
    const error = new Error("PhonePe callback credentials are not configured");
    error.status = 503;
    throw error;
  }

  return { username, password };
}

function validatePhonepeCallback(req) {
  const client = getPhonepeClient();
  if (!client) {
    const error = new Error("Payment gateway is not configured");
    error.status = 503;
    throw error;
  }

  const authorization = String(req.headers.authorization || req.headers["x-verify"] || "").trim();
  if (!authorization) {
    const error = new Error("PhonePe callback authorization header is required");
    error.status = 401;
    throw error;
  }

  const { username, password } = getPhonepeCallbackCredentials();
  return client.validateCallback(username, password, authorization, JSON.stringify(req.body || {}));
}

function getClientBaseUrl() {
  return String(
    process.env.CLIENT_URL || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || "http://localhost:8081"
  )
    .trim()
    .replace(/\/+$/, "");
}

function getPendingPaymentExpiryDate() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function getPendingPaymentProcessingLeaseDate() {
  return new Date(Date.now() + PENDING_PAYMENT_PROCESSING_LEASE_MS);
}

function normalizeCheckoutDetails(payload = {}, user = null) {
  return {
    guest_name: String(user?.full_name || payload.guest_name || payload.name || "").trim(),
    guest_email: String(user?.email || payload.guest_email || payload.email || "").trim().toLowerCase(),
    guest_phone: String(user?.phone || payload.guest_phone || payload.phone || "").trim() || null,
    shipping_address: String(payload.shipping_address || user?.address || "").trim() || null,
    shipping_city: String(payload.shipping_city || user?.city || "").trim() || null,
    shipping_state: String(payload.shipping_state || user?.state || "").trim() || null,
    shipping_pincode: String(payload.shipping_pincode || user?.pincode || "").trim() || null,
  };
}

function assertCheckoutDetails(details) {
  const requiredFields = [
    ["guest_name", "Name is required"],
    ["guest_email", "Email is required"],
    ["guest_phone", "Phone is required"],
    ["shipping_address", "Shipping address is required"],
    ["shipping_city", "Shipping city is required"],
    ["shipping_state", "Shipping state is required"],
    ["shipping_pincode", "Shipping pincode is required"],
  ];

  for (const [field, message] of requiredFields) {
    if (!details[field]) {
      const error = new Error(message);
      error.status = 400;
      throw error;
    }
  }
}

async function markPendingPaymentFailed(pending) {
  if (Array.isArray(pending.reserved_items) && pending.reserved_items.length) {
    await releaseInventoryForOrderItems(pending.reserved_items).catch(() => null);
  }
  if (pending.purpose === "workshop_booking" && pending.reference_id) {
    await WorkshopBooking.findByIdAndUpdate(pending.reference_id, {
      payment_status: "failed",
      booking_status: "failed",
    }).catch(() => null);
  }
  pending.reserved_items = [];
  pending.status = "failed";
  pending.processing_started_at = null;
  pending.expires_at = null;
  await pending.save();
}

async function markPendingPaymentCompleted(pending) {
  pending.reserved_items = [];
  pending.status = "completed";
  pending.processing_started_at = null;
  pending.expires_at = null;
  await pending.save();
}

async function markPendingPaymentExpired(pending) {
  if (Array.isArray(pending.reserved_items) && pending.reserved_items.length) {
    await releaseInventoryForOrderItems(pending.reserved_items).catch(() => null);
  }
  if (pending.purpose === "workshop_booking" && pending.reference_id) {
    await WorkshopBooking.findByIdAndUpdate(pending.reference_id, {
      payment_status: "cancelled",
      booking_status: "cancelled",
      cancelled_at: new Date(),
    }).catch(() => null);
  }
  pending.reserved_items = [];
  pending.status = "expired";
  pending.processing_started_at = null;
  pending.expires_at = null;
  await pending.save();
}

async function claimPendingPaymentForProcessing(merchantOrderId) {
  return PendingPayment.findOneAndUpdate(
    {
      merchant_order_id: merchantOrderId,
      status: { $in: CLAIMABLE_PENDING_STATUSES },
    },
    {
      $set: {
        status: "processing",
        processing_started_at: new Date(),
        expires_at: getPendingPaymentProcessingLeaseDate(),
      },
    },
    { new: true }
  );
}

async function releasePendingPaymentForRetry(pending) {
  pending.status = "initiated";
  pending.processing_started_at = null;
  pending.expires_at = getPendingPaymentExpiryDate();
  await pending.save();
}

async function releaseExpiredPendingPayments() {
  const now = new Date();
  const expiredPendings = await PendingPayment.find({
    status: { $in: EXPIRABLE_PENDING_STATUSES },
    expires_at: { $ne: null, $lte: now },
  });

  for (const pending of expiredPendings) {
    await markPendingPaymentExpired(pending).catch((error) => {
      logger.error({ err: error, merchant_order_id: pending.merchant_order_id }, "Failed to expire pending payment");
    });
  }
}

async function fetchPhonePeOrderState(merchantOrderId) {
  const client = getPhonepeClient();
  if (!client) {
    const error = new Error("Payment gateway is not configured");
    error.status = 503;
    throw error;
  }

  const statusResponse = await client.getOrderStatus(merchantOrderId);
  const state = statusResponse?.state || statusResponse?.data?.state || "PENDING";
  const transactionId =
    statusResponse?.paymentDetails?.[0]?.transactionId ||
    statusResponse?.transactionId ||
    merchantOrderId;

  return { state, transactionId, statusResponse };
}

async function createOrderFromPending(pending, transactionId) {
  const existingOrder = await Order.findOne({ phonepe_order_id: pending.merchant_order_id });
  if (existingOrder) {
    if (pending.status !== "completed") await markPendingPaymentCompleted(pending);
    return existingOrder;
  }

  const enriched = await enrichOrderItemsWithProductData(pending.cart_items);
  const orderItems = enriched.map((entry) => ({
    ...entry.order_item,
    order_id: "",
  }));

  let reservations = [];
  let createdOrder = null;
  const hasReservedInventory = Array.isArray(pending.reserved_items) && pending.reserved_items.length > 0;
  try {
    if (!hasReservedInventory) {
      reservations = await reserveInventoryForOrderItems(orderItems);
    }

    createdOrder = await Order.create({
      user_id: pending.user_id,
      guest_name: pending.guest_name,
      guest_email: pending.guest_email,
      guest_phone: pending.guest_phone,
      shipping_address: pending.shipping_address,
      shipping_city: pending.shipping_city,
      shipping_state: pending.shipping_state,
      shipping_pincode: pending.shipping_pincode,
      subtotal: pending.subtotal,
      shipping_cost: pending.shipping_cost,
      total: pending.total,
      payment_method: "phonepe",
      status: "confirmed",
      payment_status: "paid",
      phonepe_order_id: pending.merchant_order_id,
      phonepe_transaction_id: transactionId || pending.merchant_order_id,
      vendor_payout_status: "not_ready",
    });

    const finalizedOrderItems = orderItems.map((entry) => ({
      ...entry,
      order_id: createdOrder._id.toString(),
    }));

    await OrderItem.insertMany(finalizedOrderItems);
    await applyOrderSideEffects(createdOrder, finalizedOrderItems, { releaseStock: false });
    await createdOrder.save();
    await markPendingPaymentCompleted(pending);
    queuePhonepeOrderConfirmationEmail(createdOrder, finalizedOrderItems);

    return createdOrder;
  } catch (error) {
    if (!hasReservedInventory) {
      await releaseInventoryForOrderItems(reservations).catch(() => null);
    }
    if (createdOrder?._id) {
      await OrderItem.deleteMany({ order_id: createdOrder._id.toString() }).catch(() => null);
      await Order.findByIdAndDelete(createdOrder._id).catch(() => null);
    }

    if (error?.code === 11000) {
      const existingDuplicate = await Order.findOne({ phonepe_order_id: pending.merchant_order_id });
      if (existingDuplicate) {
        await markPendingPaymentCompleted(pending);
        return existingDuplicate;
      }
    }

    await releasePendingPaymentForRetry(pending).catch(() => null);
    throw error;
  }
}

async function confirmWorkshopBookingFromPending(pending, transactionId) {
  const booking = await WorkshopBooking.findById(pending.reference_id);
  if (!booking) {
    await markPendingPaymentFailed(pending).catch(() => null);
    const error = new Error("Workshop booking not found for this payment");
    error.status = 404;
    throw error;
  }

  if (booking.payment_status === "paid") {
    if (pending.status !== "completed") await markPendingPaymentCompleted(pending);
    return booking;
  }

  booking.payment_method = booking.payment_method || "phonepe";
  booking.payment_status = "paid";
  if (["draft", "pending_payment", "failed", "cancelled"].includes(String(booking.booking_status || ""))) {
    booking.booking_status = "confirmed";
  }
  booking.phonepe_transaction_id = transactionId || pending.merchant_order_id;
  booking.merchant_order_id = pending.merchant_order_id;
  await booking.save();
  await markPendingPaymentCompleted(pending);
  queueWorkshopBookingEmail(booking);
  return booking;
}

async function finalizePendingPayment(merchantOrderId) {
  const pending = await PendingPayment.findOne({ merchant_order_id: merchantOrderId });
  if (!pending) return { purpose: "order", status: "MISSING", verified: false, order: null, booking: null };

  if (pending.status === "completed") {
    if (pending.purpose === "workshop_booking") {
      const completedBooking = pending.reference_id ? await WorkshopBooking.findById(pending.reference_id) : null;
      return { purpose: pending.purpose, status: "COMPLETED", verified: true, order: null, booking: completedBooking || null };
    }
    const completedOrder = await Order.findOne({ phonepe_order_id: merchantOrderId });
    return { purpose: pending.purpose, status: "COMPLETED", verified: true, order: completedOrder || null, booking: null };
  }

  if (pending.status === "failed") {
    return { purpose: pending.purpose, status: "FAILED", verified: false, order: null, booking: null };
  }

  if (pending.status === "expired") {
    return { purpose: pending.purpose, status: "EXPIRED", verified: false, order: null, booking: null };
  }

  const { state, transactionId } = await fetchPhonePeOrderState(merchantOrderId);

  if (state === "FAILED") {
    await markPendingPaymentFailed(pending);
    return { purpose: pending.purpose, status: "FAILED", verified: false, order: null, booking: null };
  }

  if (state !== "COMPLETED") {
    return { purpose: pending.purpose, status: state, verified: false, order: null, booking: null };
  }

  const claimedPending = await claimPendingPaymentForProcessing(merchantOrderId);
  if (!claimedPending) {
    if (pending.purpose === "workshop_booking") {
      const existingBooking = pending.reference_id ? await WorkshopBooking.findById(pending.reference_id) : null;
      if (existingBooking?.payment_status === "paid") {
        return { purpose: pending.purpose, status: "COMPLETED", verified: true, order: null, booking: existingBooking };
      }
    } else {
      const existingOrder = await Order.findOne({ phonepe_order_id: merchantOrderId });
      if (existingOrder) {
        return { purpose: pending.purpose, status: "COMPLETED", verified: true, order: existingOrder, booking: null };
      }
    }

    const latestPending = await PendingPayment.findOne({ merchant_order_id: merchantOrderId });
    if (latestPending?.status === "failed") {
      return { purpose: latestPending.purpose || pending.purpose, status: "FAILED", verified: false, order: null, booking: null };
    }

    return { purpose: pending.purpose, status: "PROCESSING", verified: false, order: null, booking: null };
  }

  if (claimedPending.purpose === "workshop_booking") {
    const booking = await confirmWorkshopBookingFromPending(claimedPending, transactionId);
    return { purpose: claimedPending.purpose, status: "COMPLETED", verified: true, order: null, booking };
  }

  const order = await createOrderFromPending(claimedPending, transactionId);
  return { purpose: claimedPending.purpose, status: "COMPLETED", verified: true, order, booking: null };
}

async function buildOrderSummary(order) {
  if (!order) return null;
  const items = await OrderItem.find({ order_id: order._id.toString() }).lean();
  return {
    id: order._id.toString(),
    order_number: order.order_number || null,
    guest_name: order.guest_name,
    guest_email: order.guest_email,
    total: order.total,
    status: order.status,
    items: items.map((item) => ({
      product_title: item.product_title,
      price: item.price,
      quantity: item.quantity,
    })),
  };
}

async function buildWorkshopBookingSummary(booking) {
  if (!booking) return null;
  return {
    id: booking._id.toString(),
    workshop_title: booking.workshop_title,
    full_name: booking.full_name,
    email: booking.email,
    phone: booking.phone,
    team_size: booking.team_size,
    total: booking.total,
    payment_status: booking.payment_status,
    booking_status: booking.booking_status,
    preferred_date: booking.preferred_date,
    preferred_time: booking.preferred_time,
  };
}

router.post("/create-order", optionalProtect, async (req, res) => {
  try {
    await releaseExpiredPendingPayments().catch(() => null);
    const { items = [] } = req.body;
    const user = req.user?._id ? await User.findById(req.user._id).lean() : null;
    if (req.user?._id && !user) return res.status(404).json({ error: "User not found" });
    if (!items.length) return res.status(400).json({ error: "Cart items are required" });

    const enriched = await enrichOrderItemsWithProductData(items);
    const checkoutDetails = normalizeCheckoutDetails(req.body, user);
    assertCheckoutDetails(checkoutDetails);
    const actualSubtotal = enriched.reduce((sum, entry) => sum + Number(entry.order_item.price) * Number(entry.order_item.quantity), 0);
    const actualShippingCost = calculateShippingCost(actualSubtotal);
    const actualTotal = actualSubtotal + actualShippingCost;
    const merchantOrderId = `PP_${(user?._id?.toString?.().slice(-8) || "GUEST").replace(/[^A-Z0-9]/gi, "")}_${Date.now()}`;
    let reservedItems = [];
    let pending = null;

    try {
      reservedItems = await reserveInventoryForOrderItems(
        enriched.map((entry) => ({
          ...entry.order_item,
          order_id: "",
        }))
      );

      pending = await PendingPayment.create({
        merchant_order_id: merchantOrderId,
        purpose: "order",
        reference_id: null,
        metadata: null,
        user_id: user?._id || null,
        ...checkoutDetails,
        subtotal: actualSubtotal,
        shipping_cost: actualShippingCost,
        total: actualTotal,
        cart_items: items,
        reserved_items: reservedItems,
        status: "initiated",
        processing_started_at: null,
        expires_at: getPendingPaymentExpiryDate(),
      });

      const client = getPhonepeClient();
      if (!client) {
        await markPendingPaymentFailed(pending);
        return res.status(503).json({ error: "Payment gateway is not configured" });
      }

      const redirectUrl = `${getClientBaseUrl()}/phonepe-return?merchantOrderId=${encodeURIComponent(merchantOrderId)}`;

      const payRequest = StandardCheckoutPayRequest.builder()
        .merchantOrderId(merchantOrderId)
        .amount(Math.round(actualTotal * 100))
        .redirectUrl(redirectUrl)
        .build();

      const response = await client.pay(payRequest);
      const checkoutUrl = response.redirectUrl || response.data?.redirectUrl;

      if (!checkoutUrl) {
        await markPendingPaymentFailed(pending);
        return res.status(502).json({ error: "Payment gateway did not return a checkout URL" });
      }

      return res.json({ checkout_url: checkoutUrl, merchant_order_id: merchantOrderId });
    } catch (phonepeErr) {
      if (pending) {
        await markPendingPaymentFailed(pending).catch(() => null);
      } else if (reservedItems.length) {
        await releaseInventoryForOrderItems(reservedItems).catch(() => null);
      }
      logger.error({ err: phonepeErr }, "PhonePe create-order error");
      return res.status(502).json({ error: "Failed to create PhonePe checkout session" });
    }
  } catch (err) {
    logger.error({ err }, "Unhandled PhonePe create-order error");
    return res.status(500).json({ error: err.message });
  }
});

router.post("/verify-payment", optionalProtect, async (req, res) => {
  try {
    await releaseExpiredPendingPayments().catch(() => null);
    const { merchant_order_id } = req.body;
    if (!merchant_order_id) return res.status(400).json({ error: "merchant_order_id is required" });

    const pending = await PendingPayment.findOne({ merchant_order_id });
    if (!pending) return res.json({ verified: false, status: "MISSING" });

    if (pending.status === "completed") {
      const order = await Order.findOne({ phonepe_order_id: merchant_order_id });
      return res.json({
        purpose: "order",
        verified: true,
        status: "COMPLETED",
        order_id: order?._id?.toString() || null,
        order_summary: await buildOrderSummary(order),
        booking_id: null,
        booking_summary: null,
        receipt_token: getGuestReceiptToken(order),
      });
    }

    if (pending.status === "failed") {
      return res.json({ verified: false, status: "FAILED" });
    }

    try {
      const result = await finalizePendingPayment(merchant_order_id);
      return res.json({
        purpose: result.purpose,
        verified: result.verified,
        status: result.status,
        order_id: result.order?._id?.toString() || null,
        order_summary: await buildOrderSummary(result.order),
        booking_id: result.booking?._id?.toString() || null,
        booking_summary: await buildWorkshopBookingSummary(result.booking),
        receipt_token: getGuestReceiptToken(result.order),
      });
    } catch (statusErr) {
      if (statusErr?.status === 503) {
        return res.status(503).json({ verified: false, status: "UNAVAILABLE", message: statusErr.message });
      }
      logger.error({ err: statusErr, merchant_order_id }, "PhonePe status check error");
      return res.json({ verified: false, status: "ERROR", message: statusErr?.message });
    }
  } catch (err) {
    logger.error({ err }, "Unhandled PhonePe verify-payment error");
    return res.status(500).json({ error: err.message });
  }
});

router.post("/callback", async (req, res) => {
  try {
    await releaseExpiredPendingPayments().catch(() => null);
    const callbackPayload = validatePhonepeCallback(req);
    const merchantOrderId = String(callbackPayload?.payload?.merchantOrderId || "").trim();
    if (!merchantOrderId) return res.status(400).json({ error: "merchantOrderId required" });

    const result = await finalizePendingPayment(merchantOrderId);

    return res.json({
      success: true,
      status: result.status,
      order_id: result.order?._id?.toString() || null,
    });
  } catch (err) {
    logger.error({ err }, "PhonePe callback error");
    return res.status(Number(err.status) || 500).json({ error: err.message });
  }
});

const pendingPaymentCleanupTimer = setInterval(() => {
  releaseExpiredPendingPayments().catch((error) => {
    logger.error({ err: error }, "Pending payment cleanup error");
  });
}, PENDING_PAYMENT_CLEANUP_INTERVAL_MS);

pendingPaymentCleanupTimer.unref?.();

module.exports = router;
