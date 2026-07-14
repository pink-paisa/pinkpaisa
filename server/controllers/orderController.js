const mongoose = require("mongoose");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const DeliveryPartner = require("../models/DeliveryPartner");
const Product = require("../models/Product");
const Vendor = require("../models/Vendor");
const VendorProduct = require("../models/VendorProduct");
const VendorSettlement = require("../models/VendorSettlement");
const { calculateShippingCost } = require("../utils/commerceConfig");
const logger = require("../utils/logger");
const { sendOrderConfirmationEmail } = require("../utils/email");
const { createGuestOrderReceiptToken, verifyGuestOrderReceiptToken } = require("../utils/orderReceiptToken");
const { initiatePhonepeRefund } = require("../utils/phonepeClient");
const { buildCommissionInvoiceHtml } = require("../utils/commissionInvoice");
const { getVendorBankPayoutBlockReason } = require("../utils/vendorBankStatus");

const ORDER_STATUS_FLOW = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["pickup_assigned", "cancelled"],
  processing: ["pickup_assigned", "cancelled"],
  pickup_assigned: ["picked_up", "cancelled"],
  picked_up: ["shipped"],
  shipped: ["delivered", "return_requested"],
  delivered: ["return_requested", "refunded"],
  return_requested: ["return_in_transit", "refunded"],
  return_in_transit: ["returned", "refunded"],
  returned: ["refunded"],
  refunded: [],
  cancelled: [],
};

const DELIVERY_STATUS_FLOW = {
  pending: ["pickup_assigned"],
  pickup_assigned: ["picked_up"],
  picked_up: ["shipped"],
  shipped: ["delivered"],
  delivered: ["return_requested"],
  return_requested: ["return_in_transit"],
  return_in_transit: ["returned"],
  returned: [],
};

const ORDER_LIST_DEFAULT_LIMIT = 25;
const ORDER_LIST_MAX_LIMIT = 100;

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseListPagination(query = {}) {
  const page = Math.max(parseInt(String(query.page || "1"), 10) || 1, 1);
  const requestedLimit = parseInt(String(query.limit || ORDER_LIST_DEFAULT_LIMIT), 10) || ORDER_LIST_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(requestedLimit, 1), ORDER_LIST_MAX_LIMIT);
  return { page, limit };
}

function wantsPaginatedOrderList(query = {}) {
  return ["page", "limit", "search"].some((key) => Object.prototype.hasOwnProperty.call(query, key));
}

function buildOrderListFilter(req) {
  const isAdmin = req.user?.role === "admin";
  const filter = isAdmin ? {} : { user_id: req.user._id };
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "all").trim();

  if (status && status !== "all") {
    filter.$or = [
      { status },
      { delivery_status: status },
      { payment_status: status },
    ];
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const searchOr = [
      { guest_name: regex },
      { guest_email: regex },
      { guest_phone: regex },
      { order_number: regex },
      { invoice_number: regex },
    ];
    if (mongoose.Types.ObjectId.isValid(search)) searchOr.push({ _id: new mongoose.Types.ObjectId(search) });
    const searchClause = {
      $or: searchOr,
    };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchClause];
      delete filter.$or;
    } else {
      Object.assign(filter, searchClause);
    }
  }

  return filter;
}

const applyQueryParams = (query, req) => {
  const { _sort, _order, _limit, _page, _select, ...filters } = req.query;
  for (const [key, value] of Object.entries(filters)) {
    if (!key.startsWith("_")) query = query.where(key).equals(value);
  }
  if (_sort) {
    const direction = _order === "desc" ? -1 : 1;
    query = query.sort({ [_sort]: direction });
  }
  if (_select) query = query.select(String(_select).split(",").join(" "));
  if (_limit) {
    const limit = parseInt(_limit, 10);
    query = query.limit(limit);
    if (_page) {
      const page = Math.max(parseInt(_page, 10) || 1, 1);
      query = query.skip((page - 1) * limit);
    }
  }
  return query;
};

const serializeOrder = (order) => ({
  ...order,
  id: order._id.toString(),
  order_number: order.order_number || null,
  invoice_number: order.invoice_number || null,
  invoice_generated_at: order.invoice_generated_at || null,
  user_id: order.user_id?._id?.toString?.() || order.user_id?.toString?.() || order.user_id || null,
  delivery_partner_id: order.delivery_partner_id?._id?.toString?.() || order.delivery_partner_id?.toString?.() || order.delivery_partner_id || null,
  user: order.user_id && typeof order.user_id === "object" ? { id: order.user_id._id?.toString?.() || order.user_id.id, full_name: order.user_id.full_name, email: order.user_id.email, phone: order.user_id.phone } : undefined,
  delivery_partner: order.delivery_partner_id && typeof order.delivery_partner_id === "object" ? { id: order.delivery_partner_id._id?.toString?.() || order.delivery_partner_id.id, name: order.delivery_partner_id.name, phone: order.delivery_partner_id.phone, company_name: order.delivery_partner_id.company_name, status: order.delivery_partner_id.status } : undefined,
});

function calculatePayoutBreakup(price, quantity, commissionPercent = 20) {
  const gross = Number(price || 0) * Number(quantity || 0);
  const commissionAmount = Number((gross * Number(commissionPercent || 20)) / 100);
  return { gross, commissionAmount, payoutAmount: gross - commissionAmount };
}

function canMove(from, to, flow) {
  if (!to || from === to) return true;
  return (flow[from] || []).includes(to);
}

function buildInvoiceNumber(order) {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const orderPart = String(order.order_number || order._id.toString().slice(-8)).replace(/[^A-Z0-9]/gi, "").slice(-8).toUpperCase();
  return `INV-${datePart}-${orderPart}`;
}

function normalizeGuestCheckoutDetails(payload = {}, user = null) {
  const guestName = String(user?.full_name || payload.guest_name || payload.name || "").trim();
  const guestEmail = String(user?.email || payload.guest_email || payload.email || "").trim().toLowerCase();
  const guestPhone = String(user?.phone || payload.guest_phone || payload.phone || "").trim();
  const shippingAddress = String(payload.shipping_address || user?.address || "").trim();
  const shippingCity = String(payload.shipping_city || user?.city || "").trim();
  const shippingState = String(payload.shipping_state || user?.state || "").trim();
  const shippingPincode = String(payload.shipping_pincode || user?.pincode || "").trim();

  return {
    guest_name: guestName,
    guest_email: guestEmail,
    guest_phone: guestPhone || null,
    shipping_address: shippingAddress || null,
    shipping_city: shippingCity || null,
    shipping_state: shippingState || null,
    shipping_pincode: shippingPincode || null,
  };
}

function validateCheckoutContactDetails(details) {
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

function buildReceiptItems(items = []) {
  return items.map((item) => ({
    id: item._id?.toString?.() || item.id || null,
    product_title: item.product_title,
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 0),
  }));
}

function buildPublicOrderReceipt(order, items = []) {
  return {
    id: order._id?.toString?.() || order.id,
    order_number: order.order_number || null,
    guest_name: order.guest_name,
    guest_email: order.guest_email,
    total: Number(order.total || 0),
    status: order.status,
    payment_method: order.payment_method || null,
    createdAt: order.createdAt || order.created_at || null,
    items: buildReceiptItems(items),
  };
}

function queueOrderConfirmationEmail(order, items = []) {
  const orderPayload = order?.toObject ? order.toObject() : order;
  const orderId = orderPayload?._id?.toString?.() || orderPayload?.id || null;
  void sendOrderConfirmationEmail({ order: orderPayload, items })
    .catch((error) => {
      logger.error({ err: error, order_id: orderId }, "Failed to send order confirmation email");
    });
}

async function ensureInvoiceGenerated(order) {
  if (!order) return order;
  if (!order.invoice_number) order.invoice_number = buildInvoiceNumber(order);
  if (!order.invoice_generated_at) order.invoice_generated_at = new Date();
  await order.save();
  return order;
}

const VENDOR_PAYOUT_RETURN_HOLD_DAYS = 7;

function hasCompleteCommissionSnapshot(item) {
  return (
    item?.commission_percent != null &&
    item?.commission_amount != null &&
    item?.payout_amount != null
  );
}

function getSettlementPeriod(items = []) {
  const dates = items
    .map((item) => item.delivered_at || item.createdAt || item.created_at || null)
    .filter(Boolean)
    .map((value) => new Date(value));

  if (!dates.length) {
    const now = new Date();
    return { period_start: now, period_end: now };
  }

  dates.sort((a, b) => a.getTime() - b.getTime());
  return {
    period_start: dates[0],
    period_end: dates[dates.length - 1],
  };
}

function buildSettlementInvoiceNumber(settlementNumber) {
  return `PP-COM-${String(settlementNumber || "").replace(/^SET-/, "")}`;
}

function getVendorPayoutHoldDays(item) {
  return item?.returnable ? VENDOR_PAYOUT_RETURN_HOLD_DAYS : 0;
}

function getEffectiveVendorDeliveredAt(item, order) {
  return item?.delivered_at || order?.delivered_at || null;
}

function hasVendorPayoutPaymentReady(order) {
  const paymentStatus = String(order?.payment_status || "");
  if (["paid", "hold", "released_to_vendor", "partially_refunded"].includes(paymentStatus)) return true;
  // Minimal fallback for already-delivered marketplace orders whose payment flag never got normalized.
  // This keeps the admin payout screen usable without changing unrelated checkout flows.
  return paymentStatus === "pending" && String(order?.status || "") === "delivered" && String(order?.delivery_status || "") === "delivered";
}

function getVendorPayoutReleaseDate(item, order) {
  const deliveredAt = getEffectiveVendorDeliveredAt(item, order);
  if (!deliveredAt) return null;
  const releaseAt = new Date(deliveredAt);
  releaseAt.setDate(releaseAt.getDate() + getVendorPayoutHoldDays(item));
  return releaseAt;
}

function isOrderItemEligibleForVendorRelease(item, order) {
  if (!item || !order) return false;
  if (String(item.vendor_status) !== "delivered") return false;
  if (!["not_requested", "rejected"].includes(String(item.return_status || "not_requested"))) return false;
  if (!hasVendorPayoutPaymentReady(order)) return false;
  if (Number(item.payout_amount || 0) <= 0) return false;
  const deliveredAt = getEffectiveVendorDeliveredAt(item, order);
  if (!deliveredAt) return false;
  const releaseAt = getVendorPayoutReleaseDate(item, order);
  return Boolean(releaseAt && releaseAt <= new Date());
}

function isWithinMaharashtra(stateValue) {
  const normalized = String(stateValue || "").trim().toLowerCase();
  return normalized in {"maharashtra":1, "mh":1, "maha":1};
}

function computeInclusiveTaxBreakup(inclusiveAmount, shippingState) {
  const gross = Number(inclusiveAmount || 0);
  const intraState = isWithinMaharashtra(shippingState);
  const taxRate = intraState ? 0.015 : 0.015;
  const taxableValue = gross / (1 + taxRate);
  const gstAmount = gross - taxableValue;
  const halfTax = gstAmount / 2;
  return {
    gross,
    taxableValue,
    gstAmount,
    cgstRate: intraState ? 0.0075 : 0,
    sgstRate: intraState ? 0.0075 : 0,
    igstRate: intraState ? 0 : 0.015,
    cgstAmount: intraState ? halfTax : 0,
    sgstAmount: intraState ? halfTax : 0,
    igstAmount: intraState ? 0 : gstAmount,
    intraState,
  };
}

function getInvoiceEligibleItems(items = []) {
  return items.filter((item) => !["returned", "refunded"].includes(String(item.return_status || "")) && !["returned", "refunded"].includes(String(item.vendor_status || "")));
}

function buildInvoiceHtml(order, items = []) {
  const invoiceItems = getInvoiceEligibleItems(items);
  const orderDate = new Date(order.delivered_at || order.createdAt || order.created_at || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const intraState = isWithinMaharashtra(order.shipping_state);

  const enriched = invoiceItems.map((item) => {
    const lineTotal = Number(item.price || 0) * Number(item.quantity || 1);
    const tax = computeInclusiveTaxBreakup(lineTotal, order.shipping_state);
    return { item, lineTotal, tax };
  });

  const subtotal = enriched.reduce((sum, entry) => sum + entry.lineTotal, 0);
  const taxableSubtotal = enriched.reduce((sum, entry) => sum + entry.tax.taxableValue, 0);
  const cgstTotal = enriched.reduce((sum, entry) => sum + entry.tax.cgstAmount, 0);
  const sgstTotal = enriched.reduce((sum, entry) => sum + entry.tax.sgstAmount, 0);
  const igstTotal = enriched.reduce((sum, entry) => sum + entry.tax.igstAmount, 0);
  const finalTotal = subtotal;

  const rows = enriched.map((entry, index) => {
    const item = entry.item;
    const tax = entry.tax;
    return `<tr>
      <td style="padding:10px;border:1px solid #ead8dd;">${index + 1}</td>
      <td style="padding:10px;border:1px solid #ead8dd;">${item.product_title}</td>
      <td style="padding:10px;border:1px solid #ead8dd; text-align:right;">${item.quantity}</td>
      <td style="padding:10px;border:1px solid #ead8dd; text-align:right;">₹${Number(item.price || 0).toFixed(2)}</td>
      <td style="padding:10px;border:1px solid #ead8dd; text-align:right;">₹${tax.taxableValue.toFixed(2)}</td>
      ${tax.intraState ? `<td style="padding:10px;border:1px solid #ead8dd; text-align:right;">0.75%<br/>₹${tax.cgstAmount.toFixed(2)}</td><td style="padding:10px;border:1px solid #ead8dd; text-align:right;">0.75%<br/>₹${tax.sgstAmount.toFixed(2)}</td>` : `<td style="padding:10px;border:1px solid #ead8dd; text-align:right;">1.50%<br/>₹${tax.igstAmount.toFixed(2)}</td>`}
      <td style="padding:10px;border:1px solid #ead8dd; text-align:right;">₹${entry.lineTotal.toFixed(2)}</td>
    </tr>`;
  }).join("");

  const taxColumns = intraState
    ? '<th style="padding:10px;border:1px solid #ead8dd;text-align:right;">CGST</th><th style="padding:10px;border:1px solid #ead8dd;text-align:right;">SGST</th>'
    : '<th style="padding:10px;border:1px solid #ead8dd;text-align:right;">IGST</th>';

  const taxSummary = intraState
    ? `<div style="display:flex;justify-content:space-between;padding:8px 0;"><span class="muted">CGST @ 0.75%</span><strong>₹${cgstTotal.toFixed(2)}</strong></div><div style="display:flex;justify-content:space-between;padding:8px 0;"><span class="muted">SGST @ 0.75%</span><strong>₹${sgstTotal.toFixed(2)}</strong></div>`
    : `<div style="display:flex;justify-content:space-between;padding:8px 0;"><span class="muted">IGST @ 1.50%</span><strong>₹${igstTotal.toFixed(2)}</strong></div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${order.invoice_number} - PinkPaisa Invoice</title>
<style>
body{font-family:Arial,sans-serif;background:#fff8f8;color:#4a2030;padding:32px} .card{max-width:980px;margin:0 auto;background:#fff;border:1px solid #eedee3;border-radius:20px;padding:32px} .muted{color:#8b6b76} table{width:100%;border-collapse:collapse} .top{display:flex;justify-content:space-between;gap:24px;margin-bottom:24px} .pill{display:inline-block;padding:6px 12px;border-radius:999px;background:#fdecef;color:#b23b63;font-size:12px;font-weight:700}
</style>
</head>
<body>
<div class="card">
  <div class="top">
    <div>
      <div class="pill">PinkPaisa Invoice</div>
      <h1 style="margin:16px 0 8px;font-size:28px;">PinkPaisa</h1>
      <p class="muted" style="margin:0;">Marketplace Tax Invoice</p>
    </div>
    <div style="text-align:right;">
      <p style="margin:0 0 8px;"><strong>Invoice No:</strong> ${order.invoice_number || "—"}</p>
      <p style="margin:0 0 8px;"><strong>Order No:</strong> ${order.order_number || "—"}</p>
      <p style="margin:0;"><strong>Date:</strong> ${orderDate}</p>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
    <div>
      <h3 style="margin:0 0 8px;">Billed To</h3>
      <p style="margin:0 0 6px;">${order.guest_name || "Customer"}</p>
      <p class="muted" style="margin:0 0 6px;">${order.guest_email || ""}</p>
      <p class="muted" style="margin:0;">${[order.shipping_address, order.shipping_city, order.shipping_state, order.shipping_pincode].filter(Boolean).join(", ")}</p>
    </div>
    <div>
      <h3 style="margin:0 0 8px;">Issued By</h3>
      <p style="margin:0 0 6px;">PinkPaisa</p>
      <p class="muted" style="margin:0 0 6px;">Buyer tax invoice</p>
      <p class="muted" style="margin:0;">Product price below is inclusive of GST. Vendor settlement and platform commission are not shown on buyer invoices.</p>
    </div>
  </div>
  <table>
    <thead>
      <tr style="background:#fff4f6;"><th style="padding:10px;border:1px solid #ead8dd;">#</th><th style="padding:10px;border:1px solid #ead8dd;text-align:left;">Item</th><th style="padding:10px;border:1px solid #ead8dd;text-align:right;">Qty</th><th style="padding:10px;border:1px solid #ead8dd;text-align:right;">Product Price<br/>(Incl. GST)</th><th style="padding:10px;border:1px solid #ead8dd;text-align:right;">Taxable Value</th>${taxColumns}<th style="padding:10px;border:1px solid #ead8dd;text-align:right;">Final Amount</th></tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="${intraState ? 8 : 7}" style="padding:18px;border:1px solid #ead8dd;text-align:center;color:#8b6b76;">No delivered non-returned items are available for invoice display.</td></tr>`}</tbody>
  </table>
  <div style="margin-top:24px;display:flex;justify-content:flex-end;">
    <div style="width:360px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;"><span class="muted">Taxable subtotal</span><strong>₹${taxableSubtotal.toFixed(2)}</strong></div>
      ${taxSummary}
      <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #ead8dd;font-size:18px;"><span><strong>Total Final Price</strong></span><strong>₹${finalTotal.toFixed(2)}</strong></div>
    </div>
  </div>
  <p class="muted" style="margin-top:24px;font-size:12px;">This is a system generated PinkPaisa invoice for buyer and admin viewing. Returned items are excluded from invoice calculation.</p>
</div>
</body>
</html>`;
}

function resolveCheckoutUnitPrice(product = {}) {
  if (product.is_affiliate) {
    throw new Error(`${product.title || "This item"} is an affiliate product and must be purchased on the partner site`);
  }
  const basePrice = Number(product.price);
  const salePrice = product.sale_price == null ? null : Number(product.sale_price);
  const hasValidSalePrice = Number.isFinite(salePrice) && salePrice > 0 && salePrice < basePrice;
  const unitPrice = hasValidSalePrice ? salePrice : basePrice;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error(`A valid checkout price is not available for ${product.title || "this item"}`);
  }
  return unitPrice;
}

async function enrichOrderItemsWithProductData(rawItems = []) {
  const productIds = rawItems.map((item) => item.id).filter(Boolean);
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const vendorIds = [...new Set(products.map((product) => product.vendor_id?.toString?.()).filter(Boolean))];
  const vendors = vendorIds.length ? await Vendor.find({ _id: { $in: vendorIds } }).lean() : [];
  const vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));

  return rawItems.map((item) => {
    const product = productMap.get(String(item.id));
    if (!product) throw new Error(`Product not found for item ${item.title || item.id}`);
    const unitPrice = resolveCheckoutUnitPrice(product);
    if (Number(product.stock_quantity || 0) < Number(item.quantity || 1)) throw new Error(`Insufficient stock for ${product.title}`);
    const vendor = product.vendor_id ? vendorMap.get(String(product.vendor_id)) : null;
    const commissionPercent = Number(vendor?.commission_percent || 20);
    const breakup = calculatePayoutBreakup(unitPrice, item.quantity || 1, commissionPercent);
    return {
      order_item: {
        order_id: "",
        product_id: String(product._id),
        product_title: product.title,
        price: unitPrice,
        cost_price: Number(product.cost_price || 0),
        quantity: Number(item.quantity || 1),
        vendor_id: product.vendor_id || null,
        vendor_product_id: product.vendor_product_id || null,
        vendor_status: product.vendor_id ? "new" : "accepted",
        returnable: product.returnable !== false,
        return_window_days: Number(product.return_window_days || 7),
        return_liability: product.return_liability || (product.vendor_id ? "vendor" : "pinkpaisa"),
        payout_status: product.vendor_id ? "on_hold" : "blocked",
        payout_amount: breakup.payoutAmount,
        commission_percent: commissionPercent,
        commission_amount: breakup.commissionAmount,
      },
      product,
      vendor,
      breakup,
    };
  });
}

async function updateInventoryLine(item, delta, { requireAvailableStock = false } = {}) {
  const quantity = Number(item.quantity || 1);
  const productFilter = { _id: item.product_id };
  if (requireAvailableStock) productFilter.stock_quantity = { $gte: quantity };

  const productResult = await Product.updateOne(productFilter, {
    $inc: { stock_quantity: delta },
  });

  if (productResult.modifiedCount !== 1) {
    throw new Error(`Insufficient stock for ${item.product_title}`);
  }

  let vendorProductTouched = false;
  try {
    if (item.vendor_product_id) {
      const vendorFilter = { _id: item.vendor_product_id };
      if (requireAvailableStock) vendorFilter.stock_quantity = { $gte: quantity };

      const vendorResult = await VendorProduct.updateOne(vendorFilter, {
        $inc: { stock_quantity: delta },
      });

      if (vendorResult.modifiedCount !== 1) {
        throw new Error(`Insufficient vendor stock for ${item.product_title}`);
      }
      vendorProductTouched = true;
    }
  } catch (error) {
    await Product.updateOne({ _id: item.product_id }, { $inc: { stock_quantity: -delta } }).catch(() => null);
    throw error;
  }

  return {
    product_id: item.product_id,
    vendor_product_id: vendorProductTouched ? item.vendor_product_id : null,
    quantity,
  };
}

async function reserveInventoryForOrderItems(orderItems = []) {
  const reservations = [];
  try {
    for (const item of orderItems) {
      const reservation = await updateInventoryLine(item, -Number(item.quantity || 1), { requireAvailableStock: true });
      reservations.push(reservation);
    }
    return reservations;
  } catch (error) {
    await releaseInventoryForOrderItems(reservations);
    throw error;
  }
}

async function releaseInventoryForOrderItems(reservations = []) {
  for (const reservation of reservations) {
    await Product.updateOne({ _id: reservation.product_id }, { $inc: { stock_quantity: reservation.quantity } }).catch(() => null);
    if (reservation.vendor_product_id) {
      await VendorProduct.updateOne(
        { _id: reservation.vendor_product_id },
        { $inc: { stock_quantity: reservation.quantity } }
      ).catch(() => null);
    }
  }
}

async function debitWalletBalance(userId, amount) {
  return User.findOneAndUpdate(
    { _id: userId, wallet_balance: { $gte: amount } },
    { $inc: { wallet_balance: -amount } },
    { new: true }
  );
}

async function creditWalletBalance(userId, amount) {
  if (amount <= 0) return null;
  return User.findByIdAndUpdate(userId, { $inc: { wallet_balance: amount } }, { new: true }).catch(() => null);
}

async function autoAssignDeliveryPartner() {
  return DeliveryPartner.findOne({ status: "active" }).sort({ createdAt: 1 }).lean();
}

async function propagateVendorStatusesForAdmin(order) {
  if (!order) return;
  const query = { order_id: order._id.toString(), vendor_id: { $ne: null } };
  const updates = {};

  if (order.status === "cancelled") {
    updates.vendor_status = "rejected";
    updates.payout_status = "blocked";
  } else if (order.delivery_status === "pickup_assigned") {
    updates.vendor_status = "pickup_assigned";
  } else if (order.delivery_status === "picked_up") {
    updates.vendor_status = "picked_up";
  } else if (order.delivery_status === "shipped") {
    updates.vendor_status = "shipped";
  } else if (order.delivery_status === "delivered") {
    updates.vendor_status = "delivered";
    updates.delivered_at = order.delivered_at || new Date();
  } else if (order.delivery_status === "return_requested") {
    updates.vendor_status = "return_requested";
    updates.return_status = "requested";
    updates.payout_status = "blocked";
  } else if (order.delivery_status === "return_in_transit") {
    updates.vendor_status = "return_in_transit";
    updates.return_status = "in_transit";
    updates.payout_status = "blocked";
  } else if (order.delivery_status === "returned") {
    updates.vendor_status = "returned";
    updates.return_status = "returned";
    updates.payout_status = "blocked";
  }

  if (Object.keys(updates).length) {
    await OrderItem.updateMany(query, updates);
  }
}

async function refreshPayoutReadinessForOrder(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return null;
  const items = await OrderItem.find({ order_id: orderId.toString() });
  let hasHold = false;
  let hasBlocked = false;
  let hasReady = false;
  let hasReleased = false;

  for (const item of items) {
    let changed = false;
    const effectiveDeliveredAt = getEffectiveVendorDeliveredAt(item, order);
    if (!item.delivered_at && effectiveDeliveredAt && String(item.vendor_status) === "delivered") {
      item.delivered_at = effectiveDeliveredAt;
      changed = true;
    }

    if (["blocked", "released"].includes(String(item.payout_status))) {
      // keep current state
    } else if (isOrderItemEligibleForVendorRelease(item, order)) {
      if (item.payout_status !== "ready") {
        item.payout_status = "ready";
        changed = true;
      }
    } else if (String(item.vendor_status) === "delivered" && ["not_requested", "rejected"].includes(String(item.return_status || "not_requested")) && effectiveDeliveredAt && Number(item.payout_amount || 0) > 0) {
      if (item.payout_status !== "on_hold") {
        item.payout_status = "on_hold";
        changed = true;
      }
    }

    if (changed) {
      await item.save();
    }

    if (item.payout_status === "on_hold") hasHold = true;
    if (item.payout_status === "blocked") hasBlocked = true;
    if (item.payout_status === "ready") hasReady = true;
    if (item.payout_status === "released") hasReleased = true;
  }

  if (hasBlocked) order.vendor_payout_status = "blocked";
  else if (hasHold) order.vendor_payout_status = "on_hold";
  else if (hasReady) order.vendor_payout_status = "ready";
  else if (hasReleased) order.vendor_payout_status = "released";
  else order.vendor_payout_status = "not_ready";

  await order.save();
  return order;
}

async function applyOrderSideEffects(order, orderItems, { releaseStock = true } = {}) {
  if (releaseStock) {
    const reservations = await reserveInventoryForOrderItems(orderItems);
    if (!reservations.length && orderItems.length) {
      throw new Error("Unable to reserve stock for this order");
    }
  }

  const hasVendorItem = orderItems.some((item) => item.vendor_id);
  if (hasVendorItem) {
    const partner = await autoAssignDeliveryPartner();
    if (partner) {
      order.delivery_partner_id = partner._id;
      order.delivery_partner_name = partner.name;
      order.delivery_status = "pickup_assigned";
      if (["pending", "confirmed", "processing"].includes(order.status)) order.status = "pickup_assigned";
      const firstVendorItem = orderItems.find((item) => item.vendor_id);
      if (firstVendorItem?.vendor_id) {
        const vendor = await Vendor.findById(firstVendorItem.vendor_id).lean();
        if (vendor) {
          order.pickup_address = vendor.address || null;
          order.pickup_city = vendor.city || null;
          order.pickup_state = vendor.state || null;
          order.pickup_pincode = vendor.pincode || null;
        }
      }
      await OrderItem.updateMany({ order_id: order._id.toString(), vendor_id: { $ne: null } }, { vendor_status: "pickup_assigned" });
    }
    order.payment_status = order.payment_status === "paid" ? "hold" : order.payment_status;
    order.vendor_payout_status = "on_hold";
    order.pinkpaisa_commission_amount = orderItems.reduce((sum, item) => sum + Number(item.commission_amount || 0), 0);
    order.vendor_payout_amount = orderItems.reduce((sum, item) => sum + Number(item.payout_amount || 0), 0);
  } else {
    // Admin-only products — use admin warehouse as pickup address
    const AdminSettings = require("../models/AdminSettings");
    const warehouse = await AdminSettings.findOne({ key: "warehouse" }).lean();
    if (warehouse && warehouse.warehouse_address) {
      order.pickup_address = warehouse.warehouse_address || null;
      order.pickup_city = warehouse.warehouse_city || null;
      order.pickup_state = warehouse.warehouse_state || null;
      order.pickup_pincode = warehouse.warehouse_pincode || null;
    }
    // Auto-assign delivery partner for admin products too
    const partner = await autoAssignDeliveryPartner();
    if (partner) {
      order.delivery_partner_id = partner._id;
      order.delivery_partner_name = partner.name;
      order.delivery_status = "pickup_assigned";
      if (["pending", "confirmed", "processing"].includes(order.status)) order.status = "pickup_assigned";
    }
  }
}

function getOrderItemRefundAmount(item) {
  return Number(item?.price || 0) * Number(item?.quantity || 1);
}

function buildInventoryReleaseReservationsFromItems(items = []) {
  return items
    .map((item) => ({
      product_id: item.product_id,
      vendor_product_id: item.vendor_product_id || null,
      quantity: Number(item.quantity || 1),
    }))
    .filter((reservation) => reservation.product_id && reservation.quantity > 0);
}

function buildPhonepeRefundId(order, item) {
  const orderPart = String(order?.order_number || order?._id || "ORDER")
    .replace(/[^A-Z0-9]/gi, "")
    .slice(-12)
    .toUpperCase();
  const itemPart = String(item?._id || item?.id || "ITEM")
    .replace(/[^A-Z0-9]/gi, "")
    .slice(-8)
    .toUpperCase();
  return `RF_${orderPart}_${itemPart}`;
}

function markOrderRefundTotals(order, refundAmount) {
  const nextRefundedAmount = Number(order.refunded_amount || 0) + Number(refundAmount || 0);
  order.refunded_amount = nextRefundedAmount;
  order.payment_status = nextRefundedAmount >= Number(order.total || 0) ? "refunded" : "partially_refunded";
}

async function processRefundForOrderItem(order, item, reason = "Return refund") {
  const refundAmount = getOrderItemRefundAmount(item);
  if (refundAmount <= 0) {
    item.refund_status = "processed";
    return { mode: "none", amount: 0 };
  }

  const existingRefundStatus = String(item.refund_status || "none");
  if (["processed", "initiated", "manual"].includes(existingRefundStatus)) {
    return {
      mode: String(order.payment_method || "unknown"),
      amount: refundAmount,
      refund_status: existingRefundStatus,
      refund_id: item.refund_id || null,
      already_processed: true,
    };
  }

  if (order.payment_method === "wallet") {
    if (!order.user_id) {
      throw new Error("Wallet refund requires a customer account");
    }
    const creditedUser = await creditWalletBalance(order.user_id, refundAmount);
    if (!creditedUser) {
      throw new Error("Could not credit the customer wallet for this refund");
    }
    await WalletTransaction.create({
      user_id: order.user_id,
      type: "credit",
      amount: refundAmount,
      source: "refund",
      note: `${reason} for order ${order.order_number || order._id.toString().slice(-6).toUpperCase()}`,
      balance_after: Number(creditedUser.wallet_balance || 0),
      order_id: order._id,
    });
    item.refund_status = "processed";
    item.refund_initiated_at = new Date();
    item.refund_id = null;
    markOrderRefundTotals(order, refundAmount);
    return { mode: "wallet", amount: refundAmount, refund_status: item.refund_status };
  }

  if (order.payment_method === "phonepe") {
    const merchantRefundId = buildPhonepeRefundId(order, item);
    const result = await initiatePhonepeRefund({
      order,
      merchantRefundId,
      amount: refundAmount,
    });
    item.refund_status = "initiated";
    item.refund_initiated_at = new Date();
    item.refund_id =
      result?.response?.refundId ||
      result?.response?.data?.refundId ||
      result?.response?.refundDetail?.refundId ||
      merchantRefundId;
    markOrderRefundTotals(order, refundAmount);
    return {
      mode: "phonepe",
      amount: refundAmount,
      refund_status: item.refund_status,
      refund_id: item.refund_id,
    };
  }

  item.refund_status = "manual";
  item.refund_initiated_at = new Date();
  item.refund_id = null;
  return { mode: "manual", amount: refundAmount, refund_status: item.refund_status };
}

async function syncOrderFromItems(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return null;
  const items = await OrderItem.find({ order_id: orderId.toString() }).lean();
  const statuses = items.map((item) => item.vendor_status);

  // All rejected → cancelled
  if (statuses.length && statuses.every((s) => s === "rejected")) {
    order.status = "cancelled";
    order.delivery_status = "pending";
  }
  // Any refunded
  else if (statuses.some((s) => s === "refunded")) {
    order.status = statuses.every((s) => s === "refunded" || s === "rejected") ? "refunded" : "return_requested";
    order.delivery_status = statuses.every((s) => s === "refunded" || s === "rejected") ? "returned" : "return_requested";
  }
  // Any return flow
  else if (statuses.some((s) => ["return_requested", "out_for_return_pickup", "return_pickup_done", "in_transit_return", "returned"].includes(s))) {
    if (statuses.some((s) => s === "returned")) { order.status = "returned"; order.delivery_status = "returned"; }
    else if (statuses.some((s) => s === "in_transit_return")) { order.status = "return_in_transit"; order.delivery_status = "return_in_transit"; }
    else if (statuses.some((s) => s === "return_pickup_done")) { order.status = "return_in_transit"; order.delivery_status = "return_in_transit"; }
    else if (statuses.some((s) => s === "out_for_return_pickup")) { order.status = "return_requested"; order.delivery_status = "return_requested"; }
    else { order.status = "return_requested"; order.delivery_status = "return_requested"; }
  }
  // All delivered
  else if (statuses.length && statuses.every((s) => s === "delivered")) {
    order.status = "delivered";
    order.delivery_status = "delivered";
  }
  // Any out_for_delivery
  else if (statuses.some((s) => s === "out_for_delivery")) {
    order.status = "shipped";
    order.delivery_status = "shipped";
  }
  // Any shipped
  else if (statuses.some((s) => s === "shipped")) {
    order.status = "shipped";
    order.delivery_status = "shipped";
  }
  // Any picked_up
  else if (statuses.some((s) => s === "picked_up")) {
    order.status = "picked_up";
    order.delivery_status = "picked_up";
  }
  // Any pickup_assigned
  else if (statuses.some((s) => s === "pickup_assigned")) {
    order.status = "pickup_assigned";
    order.delivery_status = "pickup_assigned";
  }
  // Confirmed / new
  else if (statuses.some((s) => ["accepted", "new"].includes(s))) {
    order.status = "confirmed";
  }

  if (order.delivery_status === "delivered" && !order.delivered_at) order.delivered_at = new Date();
  if (order.status === "delivered") {
    await ensureInvoiceGenerated(order);
  }
  if (order.delivered_at) {
    const maxHoldDays = items.reduce((max, item) => Math.max(max, getVendorPayoutHoldDays(item)), 0);
    const holdUntil = new Date(order.delivered_at);
    holdUntil.setDate(holdUntil.getDate() + maxHoldDays);
    order.payout_hold_until = holdUntil;
  }
  await order.save();
  await refreshPayoutReadinessForOrder(order._id);
  return order;
}

async function refreshReadyPayoutItemsForVendor(vendorId) {
  const items = await OrderItem.find({ vendor_id: vendorId });
  const orderIds = [...new Set(items.map((item) => String(item.order_id)).filter(Boolean))];
  const orders = await Order.find({ _id: { $in: orderIds } }).lean();
  const orderMap = new Map(orders.map((order) => [String(order._id), order]));

  for (const item of items) {
    const order = orderMap.get(String(item.order_id));
    if (!order) continue;
    if (["blocked", "released"].includes(String(item.payout_status))) continue;

    let changed = false;
    const effectiveDeliveredAt = getEffectiveVendorDeliveredAt(item, order);
    if (!item.delivered_at && effectiveDeliveredAt && String(item.vendor_status) === "delivered") {
      item.delivered_at = effectiveDeliveredAt;
      changed = true;
    }

    if (isOrderItemEligibleForVendorRelease(item, order)) {
      if (item.payout_status !== "ready") {
        item.payout_status = "ready";
        changed = true;
      }
    } else if (String(item.vendor_status) === "delivered" && ["not_requested", "rejected"].includes(String(item.return_status || "not_requested")) && effectiveDeliveredAt && Number(item.payout_amount || 0) > 0) {
      if (item.payout_status !== "on_hold") {
        item.payout_status = "on_hold";
        changed = true;
      }
    }

    if (changed) {
      await item.save();
    }
  }
}

async function runWithOptionalTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    const message = String(error?.message || "");
    const unsupportedTransaction =
      message.includes("Transaction numbers are only allowed") ||
      message.includes("Replica set") ||
      message.includes("transactions are not supported");

    if (!unsupportedTransaction) throw error;

    logger.warn({ err: error }, "transactions not available, falling back to non-transactional settlement creation");
    return work(null);
  } finally {
    await session.endSession().catch(() => null);
  }
}

async function createVendorSettlementRecord({ vendorId, orderItemIds, adminId }) {
  return runWithOptionalTransaction(async (session) => {
    const queryOptions = session ? { session } : undefined;
    const vendor = await Vendor.findById(vendorId, null, queryOptions);
    if (!vendor) {
      const error = new Error("Vendor not found");
      error.status = 404;
      throw error;
    }
    const bankBlockReason = getVendorBankPayoutBlockReason(vendor);
    if (bankBlockReason) {
      const error = new Error(bankBlockReason);
      error.status = 400;
      throw error;
    }

    const items = await OrderItem.find(
      {
        _id: { $in: orderItemIds },
        vendor_id: vendorId,
        payout_status: { $in: ["ready", "on_hold"] },
        payout_settlement_id: null,
      },
      null,
      queryOptions,
    );

    if (!items.length) {
      const error = new Error("No vendor payout rows found");
      error.status = 400;
      throw error;
    }

    const orderIds = [...new Set(items.map((item) => String(item.order_id)).filter(Boolean))];
    const orders = await Order.find({ _id: { $in: orderIds } }, null, queryOptions).lean();
    const orderMap = new Map(orders.map((order) => [String(order._id), order]));

    const eligibleItems = items.filter((item) => {
      const order = orderMap.get(String(item.order_id));
      return (
        hasCompleteCommissionSnapshot(item) &&
        isOrderItemEligibleForVendorRelease(item, order)
      );
    });

    if (!eligibleItems.length) {
      const error = new Error("No eligible vendor payments found for release");
      error.status = 409;
      throw error;
    }

    const settlementId = new mongoose.Types.ObjectId();
    const now = new Date();
    const lineCount = eligibleItems.length;
    const grossAmount = eligibleItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const commissionAmount = eligibleItems.reduce((sum, item) => sum + Number(item.commission_amount || 0), 0);
    const netPayable = eligibleItems.reduce((sum, item) => sum + Number(item.payout_amount || 0), 0);
    const { period_start, period_end } = getSettlementPeriod(eligibleItems);
    const bankSnapshot = {
      account_holder_name: vendor.bank_details?.account_holder_name || null,
      account_number: vendor.bank_details?.account_number || null,
      ifsc_code: vendor.bank_details?.ifsc_code || null,
      bank_name: vendor.bank_details?.bank_name || null,
    };
    const settlementTail = String(settlementId).slice(-6).toUpperCase();
    const settlementNumber = `SET-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${settlementTail}`;

    const settlement = new VendorSettlement({
      _id: settlementId,
      settlement_number: settlementNumber,
      vendor_id: vendor._id,
      period_start,
      period_end,
      order_item_ids: eligibleItems.map((item) => item._id),
      line_count: lineCount,
      gross_amount: grossAmount,
      commission_amount: commissionAmount,
      commission_gst_amount: 0,
      tds_amount: 0,
      chargeback_amount: 0,
      net_payable: netPayable,
      bank_snapshot: bankSnapshot,
      status: "paid",
      payout_provider: "manual",
      initiated_by: adminId || null,
      initiated_at: now,
      processed_at: now,
      notes: "Manual settlement recorded from vendor outstanding release flow.",
    });
    const invoiceNumber = buildSettlementInvoiceNumber(settlementNumber);
    settlement.invoice = {
      invoice_number: invoiceNumber,
      generated_at: now,
      html: buildCommissionInvoiceHtml({
        settlement: {
          ...settlement.toObject(),
          settlement_number: settlementNumber,
          invoice: { invoice_number: invoiceNumber, generated_at: now },
        },
        vendor,
      }),
    };

    if (session) {
      const updateResult = await OrderItem.updateMany(
        {
          _id: { $in: eligibleItems.map((item) => item._id) },
          vendor_id: vendorId,
          payout_status: { $in: ["ready", "on_hold"] },
          payout_settlement_id: null,
        },
        {
          $set: {
            payout_status: "released",
            payout_released_at: now,
            payout_settlement_id: settlementId,
          },
        },
        queryOptions,
      );

      if (Number(updateResult.modifiedCount || 0) !== eligibleItems.length) {
        const error = new Error("Some payout rows were already released by another action. Please refresh and try again.");
        error.status = 409;
        throw error;
      }

      await settlement.save(queryOptions);
    } else {
      await settlement.save();
      const updateResult = await OrderItem.updateMany(
        {
          _id: { $in: eligibleItems.map((item) => item._id) },
          vendor_id: vendorId,
          payout_status: { $in: ["ready", "on_hold"] },
          payout_settlement_id: null,
        },
        {
          $set: {
            payout_status: "released",
            payout_released_at: now,
            payout_settlement_id: settlementId,
          },
        },
      );

      if (Number(updateResult.modifiedCount || 0) !== eligibleItems.length) {
        await VendorSettlement.findByIdAndDelete(settlementId).catch(() => null);
        const error = new Error("Some payout rows were already released by another action. Please refresh and try again.");
        error.status = 409;
        throw error;
      }
    }

    return {
      settlement,
      vendor,
      orderIds,
      released_count: lineCount,
      released_amount: netPayable,
      commission_amount: commissionAmount,
    };
  });
}

const getVendorOutstanding = async (req, res) => {
  try {
    const vendorId = String(req.query.vendor_id || "").trim();
    if (!vendorId) return res.status(400).json({ message: "vendor_id is required" });
    await refreshReadyPayoutItemsForVendor(vendorId);
    const vendor = await Vendor.findById(vendorId).lean();
    if (!vendor) return res.status(404).json({ message: "Vendor not found" });

    const items = await OrderItem.find({ vendor_id: vendorId, vendor_status: "delivered", payout_status: { $in: ["on_hold", "ready"] }, return_status: { $in: ["not_requested", "rejected"] } }).sort({ delivered_at: 1, createdAt: -1 }).lean();
    const orderIds = [...new Set(items.map((item) => String(item.order_id)).filter(Boolean))];
    const orders = await Order.find({ _id: { $in: orderIds } }).lean();
    const orderMap = new Map(orders.map((order) => [String(order._id), order]));
    const bankBlockReason = getVendorBankPayoutBlockReason(vendor);
    const bankReady = !bankBlockReason;

    const rows = items.map((item) => {
      const order = orderMap.get(String(item.order_id));
      if (!order) return null;
      const releaseableAt = getVendorPayoutReleaseDate(item, order);
      const grossAmount = Number(item.price || 0) * Number(item.quantity || 1);
      const hasSnapshot = hasCompleteCommissionSnapshot(item);
      const isEligible = hasSnapshot && isOrderItemEligibleForVendorRelease(item, order);
      return {
        id: String(item._id),
        order_id: String(order._id),
        order_number: order.order_number,
        invoice_number: order.invoice_number || null,
        product_title: item.product_title,
        quantity: item.quantity,
        gross_amount: grossAmount,
        commission_percent: item.commission_percent == null ? null : Number(item.commission_percent),
        commission_amount: Number(item.commission_amount || 0),
        payout_amount: Number(item.payout_amount || 0),
        delivered_at: item.delivered_at || order.delivered_at || null,
        releaseable_at: releaseableAt,
        payout_status: item.payout_status,
        returnable: Boolean(item.returnable),
        return_hold_days: getVendorPayoutHoldDays(item),
        bank_ready: bankReady,
        eligible_for_release: Boolean(isEligible && bankReady),
        hold_reason: !hasSnapshot
          ? "Commission snapshot is incomplete for this order item. Run the payout backfill before releasing."
          : !bankReady
            ? bankBlockReason || "Vendor bank details are missing or not verified"
            : isEligible
              ? null
              : item.returnable
                ? `Return hold active for ${getVendorPayoutHoldDays(item)} days from delivery`
                : "Awaiting payout readiness",
      };
    }).filter(Boolean);

    const eligibleRows = rows.filter((row) => row.eligible_for_release);
    const summary = {
      vendor_id: String(vendor._id),
      vendor_name: vendor.shop_name || vendor.business_name || vendor.owner_name,
      total_orders: eligibleRows.length,
      gross_amount: eligibleRows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
      commission_amount: eligibleRows.reduce((sum, row) => sum + Number(row.commission_amount || 0), 0),
      release_amount: eligibleRows.reduce((sum, row) => sum + Number(row.payout_amount || 0), 0),
      bank_account_holder: vendor.bank_details?.account_holder_name || null,
      bank_account_number: vendor.bank_details?.account_number ? `${String(vendor.bank_details.account_number).slice(0,2)}******${String(vendor.bank_details.account_number).slice(-2)}` : null,
      bank_ifsc: vendor.bank_details?.ifsc_code || null,
      bank_name: vendor.bank_details?.bank_name || null,
      bank_verified: Boolean(vendor.bank_verified),
      bank_ready: bankReady,
      on_hold_count: rows.filter((row) => !row.eligible_for_release).length,
      eligible_count: eligibleRows.length,
    };
    res.json({ vendor: summary, items: rows });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const releaseVendorPayments = async (req, res) => {
  try {
    const vendorId = String(req.body.vendor_id || "").trim();
    const orderItemIds = Array.isArray(req.body.order_item_ids) ? [...new Set(req.body.order_item_ids.map((id) => String(id)).filter(Boolean))] : [];
    if (!vendorId || !orderItemIds.length) return res.status(400).json({ message: "vendor_id and order_item_ids are required" });
    await refreshReadyPayoutItemsForVendor(vendorId);
    const result = await createVendorSettlementRecord({
      vendorId,
      orderItemIds,
      adminId: req.user?._id || null,
    });

    for (const orderId of result.orderIds) {
      const order = await refreshPayoutReadinessForOrder(orderId);
      if (order && order.vendor_payout_status === "released") {
        order.payment_status = "released_to_vendor";
        await order.save();
      }
    }
    res.json({
      message: "Vendor settlement created",
      released_count: result.released_count,
      released_amount: result.released_amount,
      commission_amount: result.commission_amount,
      settlement_id: String(result.settlement._id),
      settlement_number: result.settlement.settlement_number,
      settlement_status: result.settlement.status,
    });
  } catch (err) { res.status(Number(err.status) || 400).json({ message: err.message }); }
};

async function serializeOrderListWithItems(orders = [], isAdmin = false) {
  const orderIds = orders.map((order) => order._id.toString());
  const items = orderIds.length ? await OrderItem.find({ order_id: { $in: orderIds } }).lean() : [];

  let vendorMap = new Map();
  let adminWarehouse = null;
  if (isAdmin) {
    const vendorIds = [...new Set(items.map((item) => item.vendor_id?.toString?.()).filter(Boolean))];
    if (vendorIds.length) {
      const vendors = await Vendor.find({ _id: { $in: vendorIds } }).select("shop_name business_name owner_name city state mobile email commission_percent gstin address pincode").lean();
      vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    }
    const AdminSettings = require("../models/AdminSettings");
    const wh = await AdminSettings.findOne({ key: "warehouse" }).lean();
    if (wh) {
      adminWarehouse = { warehouse_name: wh.warehouse_name || "PinkPaisa Warehouse", warehouse_address: wh.warehouse_address || null, warehouse_city: wh.warehouse_city || null, warehouse_state: wh.warehouse_state || null, warehouse_pincode: wh.warehouse_pincode || null, warehouse_phone: wh.warehouse_phone || null, warehouse_email: wh.warehouse_email || null };
    }
  }

  const itemMap = {};
  items.forEach((item) => {
    const orderId = item.order_id?.toString?.() || String(item.order_id);
    if (!itemMap[orderId]) itemMap[orderId] = [];
    const vendor = item.vendor_id ? vendorMap.get(String(item.vendor_id)) : null;
    const enriched = {
      ...item,
      id: item._id.toString(),
      source_type: item.vendor_id ? "vendor" : "admin",
    };
    if (vendor) {
      enriched.vendor = { id: String(vendor._id), shop_name: vendor.shop_name, business_name: vendor.business_name, owner_name: vendor.owner_name, city: vendor.city, state: vendor.state, mobile: vendor.mobile, email: vendor.email, commission_percent: vendor.commission_percent, gstin: vendor.gstin, address: vendor.address || null, pincode: vendor.pincode || null };
    } else {
      enriched.vendor = null;
      if (adminWarehouse) enriched.admin_warehouse = adminWarehouse;
    }
    itemMap[orderId].push(enriched);
  });

  return orders.map((order) => ({ ...serializeOrder(order), items: itemMap[order._id.toString()] || [], admin_warehouse: adminWarehouse }));
}

const getOrders = async (req, res) => {
  try {
    const isAdmin = req.user?.role === "admin";
    if (!wantsPaginatedOrderList(req.query || {})) {
      let q = Order.find(isAdmin ? {} : { user_id: req.user._id }).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status");
      q = applyQueryParams(q, req);
      if (!req.query._sort) q = q.sort({ createdAt: -1 });
      const orders = await q.lean();
      return res.json(await serializeOrderListWithItems(orders, isAdmin));
    }

    const { page, limit } = parseListPagination(req.query);
    const filter = buildOrderListFilter(req);
    const [orders, total, summaryRows] = await Promise.all([
      Order.find(filter)
        .populate("user_id", "full_name email phone")
        .populate("delivery_partner_id", "name phone company_name status")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
      Order.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total_orders: { $sum: 1 },
            revenue: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["cancelled", "refunded"]] },
                  0,
                  { $ifNull: ["$total", 0] },
                ],
              },
            },
            in_transit: {
              $sum: {
                $cond: [{ $in: ["$status", ["shipped", "picked_up", "pickup_assigned"]] }, 1, 0],
              },
            },
            delivered: {
              $sum: {
                $cond: [{ $eq: ["$status", "delivered"] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    return res.json({
      items: await serializeOrderListWithItems(orders, isAdmin),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
      },
      summary: summaryRows[0] || { total_orders: 0, revenue: 0, in_transit: 0, delivered: 0 },
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status").lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && String(order.user_id?._id || order.user_id) !== String(req.user._id)) return res.status(403).json({ message: "Not authorized to view this order" });
    const items = await OrderItem.find({ order_id: req.params.id }).lean();

    const vendorIds = [...new Set(items.map((item) => item.vendor_id?.toString?.()).filter(Boolean))];
    let vendorMap = new Map();
    if (vendorIds.length) {
      const vendors = await Vendor.find({ _id: { $in: vendorIds } })
        .select("shop_name business_name owner_name city state mobile email commission_percent gstin address pincode")
        .lean();
      vendorMap = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
    }

    const AdminSettings = require("../models/AdminSettings");
    const wh = await AdminSettings.findOne({ key: "warehouse" }).lean();
    const adminWarehouse = wh
      ? {
          warehouse_name: wh.warehouse_name || "PinkPaisa Warehouse",
          warehouse_address: wh.warehouse_address || null,
          warehouse_city: wh.warehouse_city || null,
          warehouse_state: wh.warehouse_state || null,
          warehouse_pincode: wh.warehouse_pincode || null,
          warehouse_phone: wh.warehouse_phone || null,
          warehouse_email: wh.warehouse_email || null,
        }
      : null;

    const enrichedItems = items.map((item) => {
      const vendor = item.vendor_id ? vendorMap.get(String(item.vendor_id)) : null;
      return {
        ...item,
        id: item._id.toString(),
        source_type: item.vendor_id ? "vendor" : "admin",
        vendor: vendor
          ? {
              id: String(vendor._id),
              shop_name: vendor.shop_name,
              business_name: vendor.business_name,
              owner_name: vendor.owner_name,
              city: vendor.city,
              state: vendor.state,
              mobile: vendor.mobile,
              email: vendor.email,
              commission_percent: vendor.commission_percent,
              gstin: vendor.gstin,
              address: vendor.address || null,
              pincode: vendor.pincode || null,
            }
          : null,
        admin_warehouse: !item.vendor_id && adminWarehouse ? adminWarehouse : undefined,
      };
    });

    res.json({ ...serializeOrder(order), items: enrichedItems, admin_warehouse: adminWarehouse });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getOrderReceipt = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });

    const isAdmin = req.user?.role === "admin";
    const ownsOrder = Boolean(req.user?._id) && String(order.user_id || "") === String(req.user._id);

    if (!isAdmin && !ownsOrder) {
      const token = String(req.query.t || "").trim();
      if (!token) return res.status(401).json({ message: "Receipt token is required" });
      verifyGuestOrderReceiptToken(token, req.params.id);
    }

    const items = await OrderItem.find({ order_id: req.params.id }).lean();
    res.json(buildPublicOrderReceipt(order, items));
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

const getOrderItems = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && String(order.user_id) !== String(req.user._id)) return res.status(403).json({ message: "Not authorized to view this order" });
    const items = await OrderItem.find({ order_id: req.params.id }).lean();
    res.json(items.map((item) => ({ ...item, id: item._id.toString() })));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.user_id || "") !== String(req.user._id)) {
      return res.status(403).json({ message: "Not authorized to cancel this order" });
    }
    if (order.status === "cancelled") {
      return res.json({ message: "Order is already cancelled", order: serializeOrder(order.toObject()) });
    }

    const items = await OrderItem.find({ order_id: order._id.toString() });
    if (!items.length) {
      return res.status(400).json({ message: "Order items are missing for this order" });
    }

    const blockedStatuses = new Set([
      "picked_up",
      "shipped",
      "out_for_delivery",
      "delivered",
      "return_requested",
      "out_for_return_pickup",
      "return_pickup_done",
      "in_transit_return",
      "return_in_transit",
      "returned",
      "refunded",
    ]);
    const blockingItem = items.find((item) => blockedStatuses.has(String(item.vendor_status || "")));
    if (blockingItem) {
      return res.status(400).json({ message: "This order can no longer be cancelled because fulfillment has already started" });
    }

    const activeItems = items.filter((item) => !["rejected", "returned", "refunded"].includes(String(item.vendor_status || "")));
    if (activeItems.length) {
      await releaseInventoryForOrderItems(buildInventoryReleaseReservationsFromItems(activeItems));
    }

    for (const item of activeItems) {
      item.vendor_status = "rejected";
      item.payout_status = "blocked";
      await item.save();
    }

    order.status = "cancelled";
    order.delivery_status = "pending";
    order.vendor_payout_status = "blocked";

    let refundMessage = null;
    const refundableAmount = Math.max(Number(order.total || 0) - Number(order.refunded_amount || 0), 0);

    if (order.payment_method === "wallet" && refundableAmount > 0) {
      const creditedUser = await creditWalletBalance(order.user_id, refundableAmount);
      if (!creditedUser) {
        throw new Error("Order was cancelled, but the wallet refund could not be completed automatically");
      }
      await WalletTransaction.create({
        user_id: order.user_id,
        type: "credit",
        amount: refundableAmount,
        source: "refund",
        note: `Order cancellation refund for ${order.order_number || order._id.toString().slice(-6).toUpperCase()}`,
        balance_after: Number(creditedUser.wallet_balance || 0),
        order_id: order._id,
      });
      markOrderRefundTotals(order, refundableAmount);
      for (const item of activeItems) {
        item.refund_status = "processed";
        item.refund_initiated_at = new Date();
        item.refund_id = null;
        await item.save();
      }
    } else if (order.payment_method === "phonepe" && refundableAmount > 0) {
      try {
        const orderRefundId = `RFC_${String(order.order_number || order._id).replace(/[^A-Z0-9]/gi, "").slice(-16).toUpperCase()}`;
        const result = await initiatePhonepeRefund({
          order,
          merchantRefundId: orderRefundId,
          amount: refundableAmount,
        });
        markOrderRefundTotals(order, refundableAmount);
        for (const item of activeItems) {
          item.refund_status = "initiated";
          item.refund_initiated_at = new Date();
          item.refund_id =
            result?.response?.refundId ||
            result?.response?.data?.refundId ||
            result?.response?.refundDetail?.refundId ||
            orderRefundId;
          await item.save();
        }
      } catch (error) {
        logger.error({ err: error, order_id: String(order._id) }, "phonepe refund initiation failed during order cancellation");
        refundMessage = "Order cancelled. Your refund is taking longer than usual and will be reviewed manually.";
        for (const item of activeItems) {
          item.refund_status = "failed";
          item.refund_initiated_at = new Date();
          await item.save();
        }
      }
    } else if (order.payment_method === "cod") {
      order.payment_status = "failed";
    }

    await order.save();
    const refreshed = await Order.findById(order._id)
      .populate("user_id", "full_name email phone")
      .populate("delivery_partner_id", "name phone company_name status")
      .lean();
    const refreshedItems = await OrderItem.find({ order_id: order._id.toString() }).lean();
    res.json({
      message: refundMessage || "Order cancelled successfully",
      order: {
        ...serializeOrder(refreshed || order.toObject()),
        items: refreshedItems.map((item) => ({ ...item, id: item._id.toString() })),
      },
      refund_attention_needed: Boolean(refundMessage),
    });
  } catch (err) {
    res.status(Number(err.status) || 400).json({ message: err.message });
  }
};

const createOrder = async (req, res) => {
  try {
    const { items = [], payment_method = "wallet" } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "Cart items are required" });

    if (!["wallet", "cod"].includes(payment_method)) {
      return res.status(400).json({ message: "Unsupported payment method" });
    }

    const user = req.user?._id ? await User.findById(req.user._id) : null;
    if (req.user?._id && !user) return res.status(404).json({ message: "User not found" });
    if (payment_method === "wallet" && (!user || user.role !== "user")) {
      return res.status(401).json({ message: "Login required for wallet checkout" });
    }

    const enriched = await enrichOrderItemsWithProductData(items);
    const subtotal = enriched.reduce((sum, item) => sum + Number(item.order_item.price) * Number(item.order_item.quantity), 0);
    const shipping_cost = calculateShippingCost(subtotal);
    const total = subtotal + shipping_cost;
    if (payment_method === "wallet" && Number(user.wallet_balance || 0) < total) return res.status(400).json({ message: "Insufficient wallet balance" });

    const checkoutDetails = normalizeGuestCheckoutDetails(req.body, user);
    validateCheckoutContactDetails(checkoutDetails);

    const orderPayload = {
      user_id: user?._id || null,
      ...checkoutDetails,
      subtotal,
      shipping_cost,
      total,
      payment_method,
      wallet_used: payment_method === "wallet" ? total : 0,
      status: "confirmed",
      payment_status: payment_method === "wallet" ? "paid" : "pending",
      vendor_payout_status: "not_ready",
    };

    const draftOrderItems = enriched.map((entry) => ({ ...entry.order_item }));
    let reservations = [];
    let debitedUser = null;
    let order = null;
    let orderItems = [];

    try {
      reservations = await reserveInventoryForOrderItems(draftOrderItems);

      if (payment_method === "wallet") {
        debitedUser = await debitWalletBalance(user._id, total);
        if (!debitedUser) {
          await releaseInventoryForOrderItems(reservations).catch(() => null);
          return res.status(400).json({ message: "Insufficient wallet balance" });
        }
      }

      order = await Order.create(orderPayload);
      orderItems = draftOrderItems.map((entry) => ({ ...entry, order_id: order._id.toString() }));

      await OrderItem.insertMany(orderItems);

      if (payment_method === "wallet") {
        await WalletTransaction.create({
          user_id: user._id,
          type: "debit",
          amount: total,
          source: "order_payment",
          note: `Wallet payment for order ${order.order_number}`,
          balance_after: debitedUser.wallet_balance,
          order_id: order._id,
        });
      }

      await applyOrderSideEffects(order, orderItems, { releaseStock: false });
      await order.save();

      const responsePayload = {
        ...serializeOrder(order.toObject()),
        items: orderItems,
        receipt_token: user ? null : createGuestOrderReceiptToken(order),
      };
      queueOrderConfirmationEmail(order, orderItems);

      res.status(201).json(responsePayload);
    } catch (err) {
      await releaseInventoryForOrderItems(reservations).catch(() => null);
      if (payment_method === "wallet" && debitedUser) {
        await creditWalletBalance(user._id, total).catch(() => null);
      }
      if (order?._id) {
        await WalletTransaction.deleteMany({ order_id: order._id, source: "order_payment", type: "debit" }).catch(() => null);
        await OrderItem.deleteMany({ order_id: order._id.toString() }).catch(() => null);
        await Order.findByIdAndDelete(order._id).catch(() => null);
      }
      throw err;
    }
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const updateOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const nextStatus = req.body.status;
    if (nextStatus && !canMove(order.status, nextStatus, ORDER_STATUS_FLOW)) return res.status(400).json({ message: `Invalid order status transition from ${order.status} to ${nextStatus}` });
    if (nextStatus) order.status = nextStatus;
    if (req.body.payment_status) order.payment_status = req.body.payment_status;
    if (req.body.delivery_status) {
      if (!canMove(order.delivery_status, req.body.delivery_status, DELIVERY_STATUS_FLOW)) return res.status(400).json({ message: `Invalid delivery status transition from ${order.delivery_status} to ${req.body.delivery_status}` });
      order.delivery_status = req.body.delivery_status;
    }
    if (order.delivery_status === "delivered" && !order.delivered_at) order.delivered_at = new Date();
    await order.save();
    await propagateVendorStatusesForAdmin(order);
    const synced = await syncOrderFromItems(order._id);
    const fresh = await Order.findById(order._id).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status").lean();
    res.json(serializeOrder(fresh || (synced || order)));
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const assignDeliveryPartner = async (req, res) => {
  try {
    const { delivery_partner_id, delivery_status, status } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (delivery_partner_id) {
      const partner = await DeliveryPartner.findById(delivery_partner_id).lean();
      if (!partner) return res.status(404).json({ message: "Delivery partner not found" });
      order.delivery_partner_id = partner._id;
      order.delivery_partner_name = partner.name;
      const nextDeliveryStatus = delivery_status || "pickup_assigned";
      if (!canMove(order.delivery_status, nextDeliveryStatus, DELIVERY_STATUS_FLOW)) return res.status(400).json({ message: "Invalid delivery status transition" });
      order.delivery_status = nextDeliveryStatus;
      const nextStatus = status || (nextDeliveryStatus === "pickup_assigned" ? "pickup_assigned" : order.status);
      if (["pending", "confirmed", "processing"].includes(order.status) || canMove(order.status, nextStatus, ORDER_STATUS_FLOW)) order.status = nextStatus;
    }
    if (order.delivery_status === "delivered" && !order.delivered_at) order.delivered_at = new Date();
    await order.save();
    await propagateVendorStatusesForAdmin(order);
    await syncOrderFromItems(order._id);
    const refreshed = await Order.findById(order._id).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status").lean();
    res.json({ message: "Delivery partner updated", order: serializeOrder(refreshed) });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const requestReturn = async (req, res) => {
  try {
    const { order_item_id, reason } = req.body;
    const item = await OrderItem.findById(order_item_id);
    if (!item) return res.status(404).json({ message: "Order item not found" });
    const order = await Order.findById(item.order_id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.user_id) !== String(req.user._id) && req.user.role !== "admin") return res.status(403).json({ message: "Not authorized to request return" });
    if (!item.returnable) return res.status(400).json({ message: "This product is not returnable" });
    if (item.vendor_status !== "delivered") return res.status(400).json({ message: "Return can be requested only after delivery" });
    if (item.delivered_at) {
      const expiresAt = new Date(item.delivered_at);
      expiresAt.setDate(expiresAt.getDate() + Number(item.return_window_days || 0));
      if (new Date() > expiresAt) return res.status(400).json({ message: "Return window is over for this product" });
    }
    item.return_status = "requested";
    item.return_reason = String(reason || "").trim() || null;
    item.return_requested_at = new Date();
    item.vendor_status = "return_requested";
    item.payout_status = "blocked";
    await item.save();
    order.status = "return_requested";
    order.delivery_status = "return_requested";
    order.vendor_payout_status = "blocked";
    await order.save();
    res.json({ message: "Return requested successfully" });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const processReturnRefund = async (req, res) => {
  try {
    const { order_item_id } = req.body;
    const item = await OrderItem.findById(order_item_id);
    if (!item) return res.status(404).json({ message: "Order item not found" });
    const order = await Order.findById(item.order_id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!["requested", "approved", "in_transit", "returned"].includes(item.return_status)) return res.status(400).json({ message: "Refund can be processed only after a return request" });
    const refundResult = await processRefundForOrderItem(order, item, "Return refund");
    item.return_status = "refunded";
    item.vendor_status = "refunded";
    item.payout_status = "blocked";
    await item.save();
    await Product.findByIdAndUpdate(item.product_id, { $inc: { stock_quantity: Number(item.quantity || 1) } }).catch(() => null);
    if (item.vendor_product_id) await VendorProduct.findByIdAndUpdate(item.vendor_product_id, { $inc: { stock_quantity: Number(item.quantity || 1) } }).catch(() => null);
    order.status = "refunded";
    order.delivery_status = "returned";
    await order.save();
    const message =
      refundResult.mode === "wallet"
        ? "Refund processed to buyer wallet"
        : refundResult.mode === "phonepe"
          ? "PhonePe refund initiated successfully"
          : refundResult.mode === "manual"
            ? "Return marked for manual refund handling"
            : "Refund processed";
    res.json({ message, refund_status: refundResult.refund_status || item.refund_status });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

const downloadOrderInvoice = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("user_id", "full_name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && String(order.user_id?._id || order.user_id) !== String(req.user._id)) return res.status(403).json({ message: "Not authorized to download this invoice" });
    if (order.status !== "delivered" && !order.invoice_number) return res.status(400).json({ message: "Invoice is available only after delivery" });
    await ensureInvoiceGenerated(order);
    const items = await OrderItem.find({ order_id: order._id.toString() }).lean();
    const html = buildInvoiceHtml(order.toObject ? order.toObject() : order, items);
    const filename = `${order.invoice_number || buildInvoiceNumber(order)}.html`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/* ── Per-Shipment Status Update ── */
const SHIPMENT_STATUS_FLOW = {
  new: ["picked_up", "rejected"],
  accepted: ["picked_up", "rejected"],
  pickup_assigned: ["picked_up", "rejected"],
  picked_up: ["shipped"],
  shipped: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: ["return_requested"],
  return_requested: ["out_for_return_pickup"],
  out_for_return_pickup: ["return_pickup_done"],
  return_pickup_done: ["in_transit_return"],
  in_transit_return: ["returned"],
  returned: [],
  rejected: [],
  refunded: [],
};

const updateShipmentStatus = async (req, res) => {
  try {
    const { shipment_key, status } = req.body;
    if (!shipment_key || !status) return res.status(400).json({ message: "shipment_key and status are required" });

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Find items belonging to this shipment group
    let filter = { order_id: order._id.toString() };
    if (shipment_key === "admin") {
      filter.vendor_id = null;
    } else if (shipment_key.startsWith("vendor-")) {
      const vendorId = shipment_key.replace("vendor-", "");
      filter.vendor_id = vendorId;
    } else {
      return res.status(400).json({ message: "Invalid shipment_key" });
    }

    const items = await OrderItem.find(filter);
    if (!items.length) return res.status(404).json({ message: "No items found for this shipment" });

    // Validate transition for each item
    for (const item of items) {
      const currentStatus = item.vendor_status || "new";
      const allowed = SHIPMENT_STATUS_FLOW[currentStatus] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: `Cannot move from "${currentStatus}" to "${status}" for item "${item.product_title}"` });
      }
    }

    // Apply the status update
    for (const item of items) {
      item.vendor_status = status;

      // Handle delivered
      if (status === "delivered" && !item.delivered_at) {
        item.delivered_at = new Date();
      }

      // Handle return statuses
      if (status === "return_requested") {
        item.return_status = "requested";
        item.return_requested_at = new Date();
        item.payout_status = "blocked";
      } else if (status === "out_for_return_pickup") {
        item.return_status = "approved";
      } else if (status === "return_pickup_done") {
        item.return_status = "in_transit";
        item.payout_status = "blocked";
      } else if (status === "in_transit_return") {
        item.return_status = "in_transit";
      } else if (status === "returned") {
        item.return_status = "returned";
        item.payout_status = "blocked";
      } else if (status === "rejected") {
        item.payout_status = "blocked";
      }

      await item.save();
    }

    // Sync order-level status from all items
    await order.save();
    const synced = await syncOrderFromItems(order._id);

    // Return refreshed order
    const fresh = await Order.findById(order._id).populate("user_id", "full_name email phone").populate("delivery_partner_id", "name phone company_name status").lean();
    const allItems = await OrderItem.find({ order_id: order._id.toString() }).lean();

    // Enrich items with vendor info (same as getOrders)
    const vendorIds = [...new Set(allItems.map((i) => i.vendor_id?.toString?.()).filter(Boolean))];
    let vendorMap = new Map();
    if (vendorIds.length) {
      const vendors = await Vendor.find({ _id: { $in: vendorIds } }).select("shop_name business_name owner_name city state mobile email commission_percent gstin address pincode").lean();
      vendorMap = new Map(vendors.map((v) => [String(v._id), v]));
    }
    const AdminSettings = require("../models/AdminSettings");
    const wh = await AdminSettings.findOne({ key: "warehouse" }).lean();
    const adminWarehouse = wh ? { warehouse_name: wh.warehouse_name || "PinkPaisa Warehouse", warehouse_address: wh.warehouse_address || null, warehouse_city: wh.warehouse_city || null, warehouse_state: wh.warehouse_state || null, warehouse_pincode: wh.warehouse_pincode || null } : null;

    const enrichedItems = allItems.map((item) => {
      const vendor = item.vendor_id ? vendorMap.get(String(item.vendor_id)) : null;
      return {
        ...item,
        id: item._id.toString(),
        source_type: item.vendor_id ? "vendor" : "admin",
        vendor: vendor ? { id: String(vendor._id), shop_name: vendor.shop_name, business_name: vendor.business_name, owner_name: vendor.owner_name, city: vendor.city, state: vendor.state, mobile: vendor.mobile, email: vendor.email, commission_percent: vendor.commission_percent, gstin: vendor.gstin, address: vendor.address || null, pincode: vendor.pincode || null } : null,
        admin_warehouse: !item.vendor_id && adminWarehouse ? adminWarehouse : undefined,
      };
    });

    res.json({ message: `Shipment updated to ${status}`, order: { ...serializeOrder(fresh || synced || order), items: enrichedItems, admin_warehouse: adminWarehouse } });
  } catch (err) { res.status(400).json({ message: err.message }); }
};

module.exports = {
  getOrders,
  getOrder,
  getOrderReceipt,
  getOrderItems,
  createOrder,
  cancelOrder,
  updateOrder,
  assignDeliveryPartner,
  requestReturn,
  processReturnRefund,
  downloadOrderInvoice,
  getVendorOutstanding,
  releaseVendorPayments,
  updateShipmentStatus,
  applyQueryParams,
  serializeOrder,
  ORDER_STATUS_FLOW,
  DELIVERY_STATUS_FLOW,
  enrichOrderItemsWithProductData,
  reserveInventoryForOrderItems,
  releaseInventoryForOrderItems,
  debitWalletBalance,
  creditWalletBalance,
  applyOrderSideEffects,
  refreshPayoutReadinessForOrder,
  syncOrderFromItems,
  _private: {
    parseListPagination,
    wantsPaginatedOrderList,
    buildOrderListFilter,
    resolveCheckoutUnitPrice,
  },
};
