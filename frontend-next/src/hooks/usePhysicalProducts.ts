import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type PhysicalProduct = {
  id: string;
  title: string;
  slug: string;
  source_type?: "admin" | "vendor";
  is_affiliate?: boolean;
  affiliate_url?: string | null;
  affiliate_external_id?: string | null;
  affiliate_source_platform?: string | null;
  affiliate_asin?: string | null;
  affiliate_marketplace?: "amazon_in" | "amazon_us" | null;
  affiliate_tag?: string | null;
  affiliate_data_source?: string | null;
  affiliate_data_last_refreshed_at?: string | null;
  affiliate_data_expires_at?: string | null;
  affiliate_api_error?: string | null;
  affiliate_compliance_status?: "needs_review" | "compliant" | "non_compliant" | "paused" | null;
  affiliate_compliance_flags?: string[];
  buying_intent?: string | null;
  campaign_label?: string | null;
  pros?: string[];
  cons?: string[];
  seo_title?: string | null;
  seo_description?: string | null;
  is_featured_affiliate?: boolean;
  affiliate_sort_order?: number;
  affiliate_is_instagram_pick?: boolean;
  short_description: string | null;
  full_description: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  category: string;
  subcategory?: string | null;
  images: string[];
  image_items?: Array<{ url: string; alt: string | null; position: number }>;
  featured_image: string | null;
  price: number;
  sale_price: number | null;
  effective_price?: number;
  mrp?: number | null;
  cost_price: number | null;
  gst_rate_percent?: number;
  hsn_code?: string | null;
  brand_name?: string | null;
  country_of_origin?: string | null;
  sku: string | null;
  stock_quantity: number;
  tags: string[];
  weight: number | null;
  dimensions: string | null;
  seo_meta_title?: string | null;
  seo_meta_description?: string | null;
  seo_keywords?: string[];
  attributes?: Record<string, unknown>;
  status: string;
  is_visible?: boolean;
  returnable?: boolean;
  return_window_days?: number;
  return_liability?: "vendor" | "pinkpaisa";
  featured: boolean;
  bestseller: boolean;
  sort_order: number;
  created_at?: string;
  createdAt?: string;
};

export const usePhysicalProducts = (includeAll = false, sourceType?: "admin" | "vendor", affiliateFilter?: boolean) => {
  return useQuery({
    queryKey: ["physical_products", includeAll, sourceType, affiliateFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (includeAll) params.set("all", "true");
      if (sourceType) params.set("source_type", sourceType);
      if (affiliateFilter !== undefined) params.set("is_affiliate", String(affiliateFilter));
      const query = params.toString();
      return apiFetch<PhysicalProduct[]>(`/products${query ? `?${query}` : ""}`);
    },
  });
};
