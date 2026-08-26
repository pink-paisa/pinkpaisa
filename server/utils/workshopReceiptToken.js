const jwt = require("jsonwebtoken");
const { getJwtSecret } = require("./authConfig");

const GUEST_WORKSHOP_RECEIPT_TYPE = "guest_workshop_receipt";

function createGuestWorkshopReceiptToken(booking) {
  return jwt.sign(
    {
      type: GUEST_WORKSHOP_RECEIPT_TYPE,
      booking_id: String(booking?._id || booking?.id || ""),
    },
    getJwtSecret(),
    { expiresIn: "30d" }
  );
}

function verifyGuestWorkshopReceiptToken(token, bookingId) {
  const decoded = jwt.verify(String(token || ""), getJwtSecret());
  if (decoded?.type !== GUEST_WORKSHOP_RECEIPT_TYPE) {
    const error = new Error("Receipt token is invalid");
    error.status = 401;
    throw error;
  }
  if (String(decoded.booking_id || "") !== String(bookingId || "")) {
    const error = new Error("Receipt token does not match this booking");
    error.status = 401;
    throw error;
  }
  return decoded;
}

module.exports = {
  createGuestWorkshopReceiptToken,
  verifyGuestWorkshopReceiptToken,
};
