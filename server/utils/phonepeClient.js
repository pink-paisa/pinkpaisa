const { StandardCheckoutClient, RefundRequest, Env } = require("@phonepe-pg/pg-sdk-node");
const logger = require("./logger");

let phonepeClient = null;

function getPhonepeClient() {
  if (phonepeClient) return phonepeClient;

  const clientId = String(process.env.PHONEPE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PHONEPE_CLIENT_SECRET || "").trim();
  const clientVersion = Number(process.env.PHONEPE_CLIENT_VERSION || 1);
  const env = String(process.env.PHONEPE_ENV || "SANDBOX").toUpperCase() === "PRODUCTION" ? Env.PRODUCTION : Env.SANDBOX;

  if (!clientId || !clientSecret) {
    logger.warn("PhonePe credentials are not configured");
    return null;
  }

  phonepeClient = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, env);
  return phonepeClient;
}

async function initiatePhonepeRefund({ order, merchantRefundId, amount }) {
  const client = getPhonepeClient();
  if (!client) {
    const error = new Error("Payment gateway is not configured");
    error.status = 503;
    throw error;
  }

  const originalMerchantOrderId = String(order?.phonepe_order_id || "").trim();
  if (!originalMerchantOrderId) {
    const error = new Error("PhonePe order reference is missing for this refund");
    error.status = 400;
    throw error;
  }

  const amountPaise = Math.round(Number(amount || 0) * 100);
  if (amountPaise <= 0) {
    return { merchant_refund_id: merchantRefundId, skipped: true, amount_paise: 0 };
  }

  const request = RefundRequest.builder()
    .merchantRefundId(merchantRefundId)
    .originalMerchantOrderId(originalMerchantOrderId)
    .amount(amountPaise)
    .build();

  const response = await client.refund(request);
  return {
    merchant_refund_id: merchantRefundId,
    amount_paise: amountPaise,
    response,
  };
}

module.exports = {
  getPhonepeClient,
  initiatePhonepeRefund,
};
