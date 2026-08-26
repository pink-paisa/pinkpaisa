const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "pink-paisa-test-secret-with-32-chars";

const WorkshopBooking = require("../models/WorkshopBooking");
const workshopController = require("../controllers/workshopBookingController");
const {
  createGuestWorkshopReceiptToken,
  verifyGuestWorkshopReceiptToken,
} = require("../utils/workshopReceiptToken");
const { createGuestOrderReceiptToken } = require("../utils/orderReceiptToken");
const { isDirectPaymentsLive } = require("../utils/phonepeClient");
const { getCaptchaConfig, verifyCaptchaToken } = require("../middleware/captcha");
const PendingPayment = require("../models/PendingPayment");
const Order = require("../models/Order");
const {
  PAYMENT_VERIFICATION_SECRET_BYTES,
  createPaymentVerificationSecret,
  canVerifyPendingPayment,
} = require("../utils/paymentVerificationSecret");
const phonepeRoute = require("../routes/phonepe");

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("guest workshop receipt tokens are scoped to one booking without embedding guest PII", () => {
  const token = createGuestWorkshopReceiptToken({ _id: "booking-a", email: "Guest@Example.com" });
  const decoded = verifyGuestWorkshopReceiptToken(token, "booking-a");
  assert.equal(decoded.booking_id, "booking-a");
  assert.equal(Object.hasOwn(decoded, "guest_email"), false);
  assert.equal(JSON.stringify(decoded).includes("guest@example.com"), false);
  assert.throws(() => verifyGuestWorkshopReceiptToken(token, "booking-b"), /does not match/);
});

test("guest order receipt tokens do not embed the customer email", () => {
  const token = createGuestOrderReceiptToken({
    _id: "64f000000000000000000099",
    guest_email: "customer@example.com",
  });
  const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(decoded.order_id, "64f000000000000000000099");
  assert.equal(Object.hasOwn(decoded, "guest_email"), false);
  assert.equal(JSON.stringify(decoded).includes("customer@example.com"), false);
});

test("guest payment verification uses a high-entropy capability stored only as a hash", () => {
  const issued = createPaymentVerificationSecret();
  assert.equal(Buffer.from(issued.secret, "base64url").length, PAYMENT_VERIFICATION_SECRET_BYTES);
  assert.match(issued.secret_hash, /^[a-f0-9]{64}$/);
  assert.equal(issued.secret_hash.includes(issued.secret), false);

  const hashPath = PendingPayment.schema.path("verification_secret_hash");
  assert.ok(hashPath);
  assert.equal(hashPath.options.select, false);
});

test("guessed or cross-guest payment IDs cannot authorize provider verification", () => {
  const firstGuest = createPaymentVerificationSecret();
  const secondGuest = createPaymentVerificationSecret();
  const pending = {
    merchant_order_id: "PP_GUEST_123",
    user_id: null,
    verification_secret_hash: firstGuest.secret_hash,
  };

  assert.equal(canVerifyPendingPayment({
    pending,
    user: null,
    verificationSecret: "merchant-order-id-is-not-a-secret",
  }), false);
  assert.equal(canVerifyPendingPayment({
    pending,
    user: null,
    verificationSecret: secondGuest.secret,
  }), false);
  assert.equal(canVerifyPendingPayment({
    pending,
    user: null,
    verificationSecret: firstGuest.secret,
  }), true);
});

test("legacy pending payments remain recoverable only by their authenticated owner or an admin", () => {
  const legacyPending = {
    merchant_order_id: "PP_LEGACY_123",
    user_id: "customer-a",
    verification_secret_hash: null,
  };

  assert.equal(canVerifyPendingPayment({
    pending: legacyPending,
    user: null,
    verificationSecret: "PP_LEGACY_123",
  }), false);
  assert.equal(canVerifyPendingPayment({
    pending: legacyPending,
    user: { _id: "customer-b", role: "customer" },
    verificationSecret: "",
  }), false);
  assert.equal(canVerifyPendingPayment({
    pending: legacyPending,
    user: { _id: "customer-a", role: "customer" },
    verificationSecret: "",
  }), true);
  assert.equal(canVerifyPendingPayment({
    pending: legacyPending,
    user: { _id: "admin-a", role: "admin" },
    verificationSecret: "",
  }), true);
});

test("verify-payment gives guessed and cross-account IDs the same minimal response", async () => {
  const originalFind = PendingPayment.find;
  const originalFindOne = PendingPayment.findOne;
  const issued = createPaymentVerificationSecret();
  const pending = {
    merchant_order_id: "PP_CUSTOMER_A_123",
    user_id: "customer-a",
    verification_secret_hash: issued.secret_hash,
  };

  try {
    PendingPayment.find = async () => [];
    PendingPayment.findOne = ({ merchant_order_id }) => ({
      select: async () => merchant_order_id === pending.merchant_order_id ? pending : null,
    });

    const crossAccount = createResponse();
    await phonepeRoute._private.verifyPayment({
      body: { merchant_order_id: pending.merchant_order_id },
      headers: {},
      user: { _id: "customer-b", role: "customer" },
    }, crossAccount);

    const guessed = createResponse();
    await phonepeRoute._private.verifyPayment({
      body: { merchant_order_id: "PP_GUESSED_999" },
      headers: {},
      user: null,
    }, guessed);

    assert.equal(crossAccount.statusCode, 404);
    assert.deepEqual(crossAccount.payload, { verified: false, status: "UNAVAILABLE" });
    assert.equal(guessed.statusCode, 404);
    assert.deepEqual(guessed.payload, crossAccount.payload);
    assert.deepEqual(Object.keys(crossAccount.payload).sort(), ["status", "verified"]);
  } finally {
    PendingPayment.find = originalFind;
    PendingPayment.findOne = originalFindOne;
  }
});

test("completed payment verification remains idempotent and does not recreate an order", async () => {
  const originalPendingFindOne = PendingPayment.findOne;
  const originalOrderFindOne = Order.findOne;
  const pending = {
    merchant_order_id: "PP_COMPLETED_123",
    purpose: "order",
    status: "completed",
  };
  const completedOrder = { _id: "order-a", phonepe_order_id: pending.merchant_order_id };
  let orderReads = 0;

  try {
    PendingPayment.findOne = async () => pending;
    Order.findOne = async () => {
      orderReads += 1;
      return completedOrder;
    };

    const first = await phonepeRoute._private.finalizePendingPayment(pending.merchant_order_id);
    const repeated = await phonepeRoute._private.finalizePendingPayment(pending.merchant_order_id);

    assert.equal(first.verified, true);
    assert.equal(repeated.verified, true);
    assert.equal(first.order, completedOrder);
    assert.equal(repeated.order, completedOrder);
    assert.equal(orderReads, 2);
  } finally {
    PendingPayment.findOne = originalPendingFindOne;
    Order.findOne = originalOrderFindOne;
  }
});

test("public workshop receipts omit private and provider-only fields", () => {
  const receipt = workshopController._private.buildPublicWorkshopReceipt({
    _id: "booking-a",
    workshop_id: "workshop-a",
    workshop_title: "Money confidence",
    full_name: "A Guest",
    email: "private@example.com",
    phone: "9999999999",
    internal_notes: "private note",
    merchant_order_id: "merchant-secret",
    team_size: 3,
    total: 1500,
    payment_status: "paid",
    booking_status: "confirmed",
  });
  assert.equal(receipt.id, "booking-a");
  assert.equal(receipt.total, 1500);
  assert.equal(Object.hasOwn(receipt, "email"), false);
  assert.equal(Object.hasOwn(receipt, "phone"), false);
  assert.equal(Object.hasOwn(receipt, "internal_notes"), false);
  assert.equal(Object.hasOwn(receipt, "merchant_order_id"), false);
});

test("workshop booking details require ownership, admin access or a signed receipt token", async () => {
  const originalFindById = WorkshopBooking.findById;
  const booking = {
    _id: "booking-a",
    user_id: null,
    email: "guest@example.com",
    workshop_title: "Money confidence",
    full_name: "A Guest",
    payment_status: "paid",
    booking_status: "confirmed",
  };
  WorkshopBooking.findById = () => ({ lean: async () => booking });
  try {
    const denied = createResponse();
    await workshopController.getBooking({ params: { id: "booking-a" }, query: {}, headers: {}, user: null }, denied);
    assert.equal(denied.statusCode, 401);

    const token = createGuestWorkshopReceiptToken(booking);
    const allowed = createResponse();
    await workshopController.getBooking({
      params: { id: "booking-a" },
      query: {},
      headers: { "x-workshop-receipt-token": token },
      user: null,
    }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.payload.id, "booking-a");

    const legacyAllowed = createResponse();
    await workshopController.getBooking({
      params: { id: "booking-a" },
      query: { t: token },
      headers: {},
      user: null,
    }, legacyAllowed);
    assert.equal(legacyAllowed.statusCode, 200);
  } finally {
    WorkshopBooking.findById = originalFindById;
  }
});

test("direct payments require both production PhonePe and an explicit launch flag", () => {
  const previousEnv = process.env.PHONEPE_ENV;
  const previousFlag = process.env.DIRECT_PAYMENTS_ENABLED;
  try {
    process.env.PHONEPE_ENV = "SANDBOX";
    process.env.DIRECT_PAYMENTS_ENABLED = "true";
    assert.equal(isDirectPaymentsLive(), false);
    process.env.PHONEPE_ENV = "PRODUCTION";
    process.env.DIRECT_PAYMENTS_ENABLED = "false";
    assert.equal(isDirectPaymentsLive(), false);
    process.env.DIRECT_PAYMENTS_ENABLED = "true";
    assert.equal(isDirectPaymentsLive(), true);
  } finally {
    if (previousEnv === undefined) delete process.env.PHONEPE_ENV;
    else process.env.PHONEPE_ENV = previousEnv;
    if (previousFlag === undefined) delete process.env.DIRECT_PAYMENTS_ENABLED;
    else process.env.DIRECT_PAYMENTS_ENABLED = previousFlag;
  }
});

test("Turnstile is selected explicitly and fails closed when production credentials are missing", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.CAPTCHA_PROVIDER,
    secret: process.env.TURNSTILE_SECRET,
    bypass: process.env.CAPTCHA_ALLOW_UNCONFIGURED,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.CAPTCHA_PROVIDER = "turnstile";
    delete process.env.TURNSTILE_SECRET;
    process.env.CAPTCHA_ALLOW_UNCONFIGURED = "true";
    assert.equal(getCaptchaConfig().provider, "turnstile");
    const result = await verifyCaptchaToken("token", "127.0.0.1", { expectedAction: "wealthness_lead" });
    assert.equal(result.ok, false);
    assert.match(result.message, /not configured/i);
  } finally {
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.provider === undefined) delete process.env.CAPTCHA_PROVIDER; else process.env.CAPTCHA_PROVIDER = previous.provider;
    if (previous.secret === undefined) delete process.env.TURNSTILE_SECRET; else process.env.TURNSTILE_SECRET = previous.secret;
    if (previous.bypass === undefined) delete process.env.CAPTCHA_ALLOW_UNCONFIGURED; else process.env.CAPTCHA_ALLOW_UNCONFIGURED = previous.bypass;
  }
});

test("Turnstile verifies both the form action and allowed hostname", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.CAPTCHA_PROVIDER,
    secret: process.env.TURNSTILE_SECRET,
    hostnames: process.env.TURNSTILE_ALLOWED_HOSTNAMES,
  };
  const originalFetch = global.fetch;
  try {
    process.env.NODE_ENV = "production";
    process.env.CAPTCHA_PROVIDER = "turnstile";
    process.env.TURNSTILE_SECRET = "turnstile-test-secret";
    process.env.TURNSTILE_ALLOWED_HOSTNAMES = "pinkpaisa.in,www.pinkpaisa.in";
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, action: "wealthness_lead", hostname: "pinkpaisa.in" }),
    });
    const accepted = await verifyCaptchaToken("token", "127.0.0.1", { expectedAction: "wealthness_lead" });
    assert.equal(accepted.ok, true);
    const wrongAction = await verifyCaptchaToken("token", "127.0.0.1", { expectedAction: "workshop_quote" });
    assert.equal(wrongAction.ok, false);

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, action: "wealthness_lead", hostname: "attacker.example" }),
    });
    const wrongHostname = await verifyCaptchaToken("token", "127.0.0.1", { expectedAction: "wealthness_lead" });
    assert.equal(wrongHostname.ok, false);
  } finally {
    global.fetch = originalFetch;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.provider === undefined) delete process.env.CAPTCHA_PROVIDER; else process.env.CAPTCHA_PROVIDER = previous.provider;
    if (previous.secret === undefined) delete process.env.TURNSTILE_SECRET; else process.env.TURNSTILE_SECRET = previous.secret;
    if (previous.hostnames === undefined) delete process.env.TURNSTILE_ALLOWED_HOSTNAMES; else process.env.TURNSTILE_ALLOWED_HOSTNAMES = previous.hostnames;
  }
});
