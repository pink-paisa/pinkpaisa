import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type Product = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  icon: string;
  badge: string | null;
  badge_color: string | null;
  includes: string[];
  price: number;
  price_max: number | null;
  format: string | null;
  is_active: boolean;
  sort_order: number;
  status: string;
};

export const useProducts = (includeAll = false, initialData?: Product[]) => {
  return useQuery({
    queryKey: ["products", includeAll],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!includeAll) {
        params.set("is_active", "true");
        params.set("status", "active");
      }
      const query = params.toString();
      return apiFetch<Product[]>(`/virtual-products${query ? `?${query}` : ""}`);
    },
    initialData,
  });
};
