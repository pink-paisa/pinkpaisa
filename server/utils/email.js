const logger = require("./logger");
const { createGuestOrderReceiptToken } = require("./orderReceiptToken");

let smtpTransporter = null;

function getServerBaseUrl() {
  return String(process.env.SERVER_URL || "http://localhost:5001").replace(/\/$/, "");
}

function getPublicAppUrl() {
  return String(process.env.PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function getEmailProvider() {
  return String(process.env.EMAIL_PROVIDER || "log").trim().toLowerCase() || "log";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASSWORD || "").trim();

  if (!host) {
    throw new Error("SMTP_HOST is required when EMAIL_PROVIDER=smtp");
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT must be a valid positive number");
  }

  return {
    host,
    port,
    secure: parseBoolean(process.env.SMTP_SECURE, port === 465),
    auth: user || pass ? { user, pass } : undefined,
    tls: {
      rejectUnauthorized: parseBoolean(process.env.SMTP_REJECT_UNAUTHORIZED, true),
    },
  };
}

function assertEmailConfigForProduction() {
  if (!isProduction()) return;
  const provider = getEmailProvider();
  if (provider !== "smtp") {
    throw new Error("EMAIL_PROVIDER=smtp is required in production");
  }

  const config = getSmtpConfig();
  if (!config.auth?.user || !config.auth?.pass) {
    throw new Error("SMTP_USER and SMTP_PASSWORD are required in production");
  }
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const nodemailer = require("nodemailer");
  smtpTransporter = nodemailer.createTransport(getSmtpConfig());
  return smtpTransporter;
}

function getEmailFrom() {
  return String(process.env.EMAIL_FROM || "no-reply@pinkpaisa.in").trim();
}

function getEmailReplyTo() {
  return String(process.env.EMAIL_REPLY_TO || process.env.SUPPORT_EMAIL || "").trim() || undefined;
}

function redactEmailMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta || {}).map(([key, value]) => {
      const normalizedKey = String(key || "").toLowerCase();
      if (normalizedKey.includes("token") || normalizedKey.includes("url")) {
        return [key, "[redacted]"];
      }
      return [key, value];
    }),
  );
}

async function sendEmail({ to, subject, text, html, meta = {} }) {
  const safeMeta = redactEmailMeta(meta);

  if (getEmailProvider() === "smtp") {
    try {
      const info = await getSmtpTransporter().sendMail({
        from: getEmailFrom(),
        replyTo: getEmailReplyTo(),
        to,
        subject,
        text,
        html,
      });
      logger.info(
        {
          to,
          subject,
          provider: "smtp",
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          meta: safeMeta,
        },
        "Email sent via SMTP transport",
      );
      return { delivered: true, message_id: info.messageId };
    } catch (error) {
      logger.error(
        {
          err: error,
          to,
          subject,
          provider: "smtp",
          meta: safeMeta,
        },
        "SMTP email delivery failed",
      );
      return { delivered: false, error: error.message };
    }
  }

  logger.info(
    {
      to,
      subject,
      provider: getEmailProvider(),
      meta: safeMeta,
      preview_available: Boolean(text || html),
    },
    "Email queued via fallback logger transport",
  );
  return { delivered: false };
}

function buildCustomerVerificationUrl(token) {
  return `${getServerBaseUrl()}/api/auth/verify/confirm?token=${encodeURIComponent(token)}`;
}

function buildVendorVerificationUrl(token) {
  return `${getServerBaseUrl()}/api/vendors/verify/confirm?token=${encodeURIComponent(token)}`;
}

function buildCustomerPasswordResetUrl(token) {
  return `${getPublicAppUrl()}/account/reset-password?token=${encodeURIComponent(token)}`;
}

function buildAdminPasswordResetUrl(token) {
  return `${getPublicAppUrl()}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

function buildVendorPasswordResetUrl(token) {
  return `${getPublicAppUrl()}/vendor/reset-password?token=${encodeURIComponent(token)}`;
}

async function sendCustomerVerificationEmail({ email, fullName, token }) {
  const verificationUrl = buildCustomerVerificationUrl(token);
  await sendEmail({
    to: email,
    subject: "Verify your Pink Paisa account",
    text: `Hi ${fullName || "there"}, verify your account: ${verificationUrl}`,
    html: `<p>Hi ${fullName || "there"},</p><p>Verify your Pink Paisa account:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
    meta: { verificationUrl, flow: "customer-verify" },
  });
  return { verification_url: verificationUrl };
}

async function sendVendorVerificationEmail({ email, ownerName, token }) {
  const verificationUrl = buildVendorVerificationUrl(token);
  await sendEmail({
    to: email,
    subject: "Verify your Pink Paisa vendor account",
    text: `Hi ${ownerName || "there"}, verify your vendor account: ${verificationUrl}`,
    html: `<p>Hi ${ownerName || "there"},</p><p>Verify your Pink Paisa vendor account:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p>`,
    meta: { verificationUrl, flow: "vendor-verify" },
  });
  return { verification_url: verificationUrl };
}

async function sendCustomerPasswordResetEmail({ email, fullName, token }) {
  const resetUrl = buildCustomerPasswordResetUrl(token);
  await sendEmail({
    to: email,
    subject: "Reset your Pink Paisa password",
    text: `Hi ${fullName || "there"}, reset your password: ${resetUrl}`,
    html: `<p>Hi ${fullName || "there"},</p><p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    meta: { resetUrl, flow: "customer-reset" },
  });
  return { reset_url: resetUrl };
}

async function sendAdminPasswordResetEmail({ email, fullName, token }) {
  const resetUrl = buildAdminPasswordResetUrl(token);
  await sendEmail({
    to: email,
    subject: "Reset your Pink Paisa admin password",
    text: `Hi ${fullName || "Admin"}, reset your admin password: ${resetUrl}`,
    html: `<p>Hi ${fullName || "Admin"},</p><p>Reset your Pink Paisa admin password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    meta: { resetUrl, flow: "admin-reset" },
  });
  return { reset_url: resetUrl };
}

async function sendVendorPasswordResetEmail({ email, ownerName, token }) {
  const resetUrl = buildVendorPasswordResetUrl(token);
  await sendEmail({
    to: email,
    subject: "Reset your Pink Paisa vendor password",
    text: `Hi ${ownerName || "there"}, reset your vendor password: ${resetUrl}`,
    html: `<p>Hi ${ownerName || "there"},</p><p>Reset your vendor password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
    meta: { resetUrl, flow: "vendor-reset" },
  });
  return { reset_url: resetUrl };
}

function buildOrderConfirmationUrl(order) {
  if (order?.user_id) {
    return `${getPublicAppUrl()}/account?tab=orders`;
  }
  const receiptToken = createGuestOrderReceiptToken(order);
  return `${getPublicAppUrl()}/order-confirmation/${order._id.toString()}?t=${encodeURIComponent(receiptToken)}`;
}

function getSupportInbox() {
  return String(process.env.SUPPORT_EMAIL || process.env.ADMIN_ALERT_EMAIL || "").trim().toLowerCase() || null;
}

async function sendOrderConfirmationEmail({ order, items = [] }) {
  const orderUrl = buildOrderConfirmationUrl(order);
  const lineItemsHtml = items
    .map((item) => {
      const quantity = Number(item.quantity || 1);
      const lineTotal = Number(item.price || 0) * quantity;
      return `<tr><td style="padding:8px 0;">${item.product_title}</td><td style="padding:8px 0;text-align:center;">${quantity}</td><td style="padding:8px 0;text-align:right;">₹${lineTotal.toLocaleString("en-IN")}</td></tr>`;
    })
    .join("");
  const shippingAddress = [
    order.shipping_address,
    order.shipping_city,
    order.shipping_state,
    order.shipping_pincode,
  ]
    .filter(Boolean)
    .join(", ");

  await sendEmail({
    to: order.guest_email,
    subject: `Pink Paisa order confirmed${order.order_number ? ` - ${order.order_number}` : ""}`,
    text: `Your Pink Paisa order ${order.order_number || order._id.toString().slice(-8).toUpperCase()} is confirmed. Track it here: ${orderUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f1720;">
        <h2 style="margin:0 0 12px;">Order confirmed</h2>
        <p style="margin:0 0 12px;">Hi ${order.guest_name || "there"}, your Pink Paisa order has been confirmed.</p>
        <p style="margin:0 0 6px;"><strong>Order number:</strong> ${order.order_number || order._id.toString().slice(-8).toUpperCase()}</p>
        <p style="margin:0 0 16px;"><strong>Total:</strong> ₹${Number(order.total || 0).toLocaleString("en-IN")}</p>
        ${shippingAddress ? `<p style="margin:0 0 16px;"><strong>Shipping to:</strong> ${shippingAddress}</p>` : ""}
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
          <thead>
            <tr>
              <th style="text-align:left;border-bottom:1px solid #ead8dd;padding:8px 0;">Item</th>
              <th style="text-align:center;border-bottom:1px solid #ead8dd;padding:8px 0;">Qty</th>
              <th style="text-align:right;border-bottom:1px solid #ead8dd;padding:8px 0;">Amount</th>
            </tr>
          </thead>
          <tbody>${lineItemsHtml}</tbody>
        </table>
        <p style="margin:16px 0;"><a href="${orderUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#e24d7b;color:#fff;text-decoration:none;font-weight:600;">View your order</a></p>
        <p style="margin:0;color:#6f5c64;">We will keep you posted as your order moves forward.</p>
      </div>
    `,
    meta: { orderId: String(order._id), flow: "order-confirmation", orderUrl },
  });
  return { order_url: orderUrl };
}

async function sendWorkshopBookingConfirmationEmail({ booking }) {
  const bookingUrl = `${getPublicAppUrl()}/workshop-booking-confirmation/${booking._id?.toString?.() || booking.id}`;
  await sendEmail({
    to: booking.email,
    subject: `Pink Paisa workshop booking confirmed - ${booking.workshop_title}`,
    text: `Hi ${booking.full_name || "there"}, your booking for ${booking.workshop_title} is confirmed. Amount paid: Rs. ${Number(booking.total || 0).toLocaleString("en-IN")}. View details: ${bookingUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f1720;">
        <h2 style="margin:0 0 12px;">Workshop booking confirmed</h2>
        <p style="margin:0 0 12px;">Hi ${booking.full_name || "there"}, your workshop booking is confirmed.</p>
        <p style="margin:0 0 6px;"><strong>Workshop:</strong> ${booking.workshop_title}</p>
        <p style="margin:0 0 6px;"><strong>Booking status:</strong> ${String(booking.booking_status || "confirmed").replace(/_/g, " ")}</p>
        <p style="margin:0 0 6px;"><strong>Payment status:</strong> ${String(booking.payment_status || "paid").replace(/_/g, " ")}</p>
        <p style="margin:0 0 16px;"><strong>Total paid:</strong> Rs. ${Number(booking.total || 0).toLocaleString("en-IN")}</p>
        <p style="margin:16px 0;"><a href="${bookingUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#e24d7b;color:#fff;text-decoration:none;font-weight:600;">View booking details</a></p>
        <p style="margin:0;color:#6f5c64;">We will share scheduling details separately.</p>
      </div>
    `,
    meta: { bookingId: String(booking._id || booking.id), flow: "workshop-booking-confirmation", bookingUrl },
  });
  return { booking_url: bookingUrl };
}

async function sendQuoteRequestReceivedEmails({ quoteRequest }) {
  const requesterName = quoteRequest.contact_name || "there";
  await sendEmail({
    to: quoteRequest.email,
    subject: "We received your Pink Paisa workshop quote request",
    text: `Hi ${requesterName}, we received your quote request and will get back to you soon.`,
    html: `<p>Hi ${requesterName},</p><p>We received your workshop quote request and will get back to you soon.</p>`,
    meta: { quoteRequestId: String(quoteRequest._id || quoteRequest.id), flow: "quote-request-confirmation" },
  });

  const supportInbox = getSupportInbox();
  if (supportInbox) {
    await sendEmail({
      to: supportInbox,
      subject: `New workshop quote request - ${quoteRequest.company_name}`,
      text: `New quote request from ${quoteRequest.company_name}. Contact: ${quoteRequest.contact_name}, ${quoteRequest.email}, ${quoteRequest.phone}.`,
      html: `
        <p>New workshop quote request received.</p>
        <p><strong>Company:</strong> ${quoteRequest.company_name}</p>
        <p><strong>Contact:</strong> ${quoteRequest.contact_name}</p>
        <p><strong>Email:</strong> ${quoteRequest.email}</p>
        <p><strong>Phone:</strong> ${quoteRequest.phone}</p>
      `,
      meta: { quoteRequestId: String(quoteRequest._id || quoteRequest.id), flow: "quote-request-admin-alert" },
    });
  }
}

module.exports = {
  assertEmailConfigForProduction,
  getPublicAppUrl,
  sendAdminPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendQuoteRequestReceivedEmails,
  sendCustomerPasswordResetEmail,
  sendCustomerVerificationEmail,
  sendVendorPasswordResetEmail,
  sendVendorVerificationEmail,
  sendWorkshopBookingConfirmationEmail,
  _private: {
    redactEmailMeta,
  },
};
