const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./authConfig");

const GUEST_ORDER_RECEIPT_TYPE = "guest_order_receipt";

function createGuestOrderReceiptToken(order) {
  return jwt.sign(
    {
      type: GUEST_ORDER_RECEIPT_TYPE,
      order_id: String(order?._id || ""),
      guest_email: String(order?.guest_email || "").toLowerCase(),
    },
    getJwtSecret(),
    { expiresIn: "30d" }
  );
}

function verifyGuestOrderReceiptToken(token, orderId) {
  const decoded = jwt.verify(String(token || ""), getJwtSecret());
  if (decoded?.type !== GUEST_ORDER_RECEIPT_TYPE) {
    const error = new Error("Receipt token is invalid");
    error.status = 401;
    throw error;
  }
  if (String(decoded.order_id || "") !== String(orderId || "")) {
    const error = new Error("Receipt token does not match this order");
    error.status = 401;
    throw error;
  }
  return decoded;
}

module.exports = {
  createGuestOrderReceiptToken,
  verifyGuestOrderReceiptToken,
};
