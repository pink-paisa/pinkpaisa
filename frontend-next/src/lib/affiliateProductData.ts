type AffiliateProductData = {
  is_affiliate?: boolean;
  affiliate_data_source?: string | null;
  affiliate_data_last_refreshed_at?: string | null;
  affiliate_data_expires_at?: string | null;
  price?: number | null;
  sale_price?: number | null;
};

export function hasFreshAffiliateApiData(product?: AffiliateProductData | null) {
  if (!product?.is_affiliate) return false;
  if (product.affiliate_data_source !== "creators_api" && product.affiliate_data_source !== "pa_api") return false;
  if (!product.affiliate_data_expires_at) return false;
  const expiresAt = new Date(product.affiliate_data_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function hasVisibleAffiliatePrice(product?: AffiliateProductData | null) {
  if (!hasFreshAffiliateApiData(product)) return false;
  const value = Number(product?.sale_price ?? product?.price ?? 0);
  return Number.isFinite(value) && value > 0;
}

export function formatAffiliateDataRefreshTime(product?: AffiliateProductData | null) {
  if (!product?.affiliate_data_last_refreshed_at) return null;
  const refreshedAt = new Date(product.affiliate_data_last_refreshed_at);
  if (Number.isNaN(refreshedAt.getTime())) return null;
  return refreshedAt.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
