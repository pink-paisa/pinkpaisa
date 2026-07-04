const parsePositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const STANDARD_SHIPPING_COST = parsePositiveNumber(process.env.STANDARD_SHIPPING_COST, 79);
const FREE_SHIPPING_THRESHOLD = parsePositiveNumber(process.env.FREE_SHIPPING_THRESHOLD, 999);

const calculateShippingCost = (subtotal) => {
  const safeSubtotal = parsePositiveNumber(subtotal, 0);
  if (FREE_SHIPPING_THRESHOLD > 0 && safeSubtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return STANDARD_SHIPPING_COST;
};

module.exports = {
  STANDARD_SHIPPING_COST,
  FREE_SHIPPING_THRESHOLD,
  calculateShippingCost,
};
