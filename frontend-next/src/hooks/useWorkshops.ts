/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Workshop = {
  id: string;
  title: string;
  slug: string;
  workshop_type: string;
  short_description: string | null;
  full_description: string | null;
  duration: string | null;
  min_people: number;
  price: number;
  original_price: number | null;
  discount_text: string | null;
  image_url: string | null;
  icon: string;
  popular: boolean;
  featured: boolean;
  category: string;
  tags: string[] | null;
  inclusions: string[];
  certificate_included: boolean;
  recording_addon_available: boolean;
  recording_addon_price: number;
  certification_addon_available: boolean;
  certification_addon_price: number;
  status: string;
  custom_quote_enabled: boolean;
  sort_order: number;
  benefits: string[];
  created_at: string;
};

export const useWorkshops = (includeAll = false, initialData?: Workshop[]) => {
  return useQuery({
    queryKey: ["workshops", includeAll],
    queryFn: async () => {
      let query = (supabase as any)
        .from("workshops")
        .select("*")
        .order("sort_order", { ascending: true });

      if (!includeAll) {
        query = query.eq("status", "active");
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Workshop[];
    },
    initialData,
  });
};
