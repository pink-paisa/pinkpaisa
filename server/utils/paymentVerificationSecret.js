const crypto = require("crypto");

const PAYMENT_VERIFICATION_SECRET_BYTES = 32;
const PAYMENT_VERIFICATION_SECRET_HEADER = "x-payment-verification-secret";

function hashPaymentVerificationSecret(secret) {
  return crypto
    .createHash("sha256")
    .update(String(secret || ""), "utf8")
    .digest("hex");
}

function createPaymentVerificationSecret() {
  const secret = crypto.randomBytes(PAYMENT_VERIFICATION_SECRET_BYTES).toString("base64url");
  return {
    secret,
    secret_hash: hashPaymentVerificationSecret(secret),
  };
}

function verifyPaymentVerificationSecret(secret, expectedHash) {
  const candidate = String(secret || "").trim();
  const normalizedExpectedHash = String(expectedHash || "").trim().toLowerCase();
  if (!candidate || !/^[a-f0-9]{64}$/.test(normalizedExpectedHash)) return false;

  const candidateHash = hashPaymentVerificationSecret(candidate);
  return crypto.timingSafeEqual(
    Buffer.from(candidateHash, "hex"),
    Buffer.from(normalizedExpectedHash, "hex")
  );
}

function getPaymentVerificationSecret(req) {
  return String(
    req?.headers?.[PAYMENT_VERIFICATION_SECRET_HEADER]
      || req?.body?.verification_secret
      || ""
  ).trim();
}

function isPendingPaymentOwnedByUser(pending, user) {
  if (!pending || !user) return false;
  if (user.role === "admin") return true;
  return Boolean(user._id && pending.user_id)
    && String(user._id) === String(pending.user_id);
}

function canVerifyPendingPayment({ pending, user, verificationSecret }) {
  if (isPendingPaymentOwnedByUser(pending, user)) return true;
  return verifyPaymentVerificationSecret(
    verificationSecret,
    pending?.verification_secret_hash
  );
}

module.exports = {
  PAYMENT_VERIFICATION_SECRET_BYTES,
  PAYMENT_VERIFICATION_SECRET_HEADER,
  hashPaymentVerificationSecret,
  createPaymentVerificationSecret,
  verifyPaymentVerificationSecret,
  getPaymentVerificationSecret,
  isPendingPaymentOwnedByUser,
  canVerifyPendingPayment,
};
