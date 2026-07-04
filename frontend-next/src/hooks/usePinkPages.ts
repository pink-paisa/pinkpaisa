/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Types
export type PinkPagesCategory = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PinkPagesListing = {
  id: string;
  category_id: string | null;
  business_name: string;
  slug: string;
  short_description: string | null;
  full_description: string | null;
  contact_person: string | null;
  phone: string;
  email: string;
  whatsapp: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  logo: string | null;
  featured: boolean;
  verified: boolean;
  status: string;
  sort_order: number;
  meta_title: string | null;
  meta_description: string | null;
  created_at: string;
  updated_at: string;
  // joined
  category_name?: string;
};

// ─── Categories ───

export const usePinkPagesCategories = (activeOnly = false) =>
  useQuery({
    queryKey: ["pink_pages_categories", activeOnly],
    queryFn: async () => {
      let q = supabase
        .from("pink_pages_categories" as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (activeOnly) q = q.eq("status", "active");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PinkPagesCategory[];
    },
  });

export const usePinkPagesCategoryMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pink_pages_categories"] });

  const upsert = useMutation({
    mutationFn: async (cat: Partial<PinkPagesCategory> & { name: string; slug: string }) => {
      if (cat.id) {
        const { error } = await supabase.from("pink_pages_categories" as any).update({ ...cat, updated_at: new Date().toISOString() } as any).eq("id", cat.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pink_pages_categories" as any).insert(cat as any);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pink_pages_categories" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { upsert, remove };
};

// ─── Listings ───

export const usePinkPagesListings = (opts?: { activeOnly?: boolean; verifiedOnly?: boolean }) =>
  useQuery({
    queryKey: ["pink_pages_listings", opts],
    queryFn: async () => {
      let q = supabase
        .from("pink_pages_listings" as any)
        .select("*, pink_pages_categories(name)")
        .order("sort_order", { ascending: true });
      if (opts?.activeOnly) q = q.eq("status", "active");
      if (opts?.verifiedOnly) q = q.eq("verified", true);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((d: any) => ({
        ...d,
        category_name: d.category_name ?? d.pink_pages_categories?.name ?? null,
      })) as PinkPagesListing[];
    },
  });

export const usePinkPagesListingMutations = () => {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["pink_pages_listings"] });

  const upsert = useMutation({
    mutationFn: async (listing: Partial<PinkPagesListing> & { business_name: string; slug: string; phone: string; email: string }) => {
      const payload = { ...listing, updated_at: new Date().toISOString() } as any;
      delete payload.category_name;
      delete payload.pink_pages_categories;
      if (listing.id) {
        const { error } = await supabase.from("pink_pages_listings" as any).update(payload).eq("id", listing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("pink_pages_listings" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pink_pages_listings" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const toggleField = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: any }) => {
      const { error } = await supabase.from("pink_pages_listings" as any).update({ [field]: value, updated_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { upsert, remove, toggleField };
};
