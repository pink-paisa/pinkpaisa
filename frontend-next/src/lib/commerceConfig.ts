const parsePositiveNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export const STANDARD_SHIPPING_COST = parsePositiveNumber(process.env.NEXT_PUBLIC_STANDARD_SHIPPING_COST, 79);
export const FREE_SHIPPING_THRESHOLD = parsePositiveNumber(process.env.NEXT_PUBLIC_FREE_SHIPPING_THRESHOLD, 999);

export const calculateShippingCost = (subtotal: number) => {
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  if (FREE_SHIPPING_THRESHOLD > 0 && safeSubtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return STANDARD_SHIPPING_COST;
};
