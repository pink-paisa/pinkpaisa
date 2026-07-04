/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Blog = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  author: string;
  category: string | null;
  tags: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string;
  featured: boolean | null;
  sort_order: number | null;
  published_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const useBlogs = (includeAll = false, initialData?: Blog[]) => {
  return useQuery({
    queryKey: ["blogs", includeAll],
    queryFn: async () => {
      let query = (supabase as any).from("blogs").select("*").order("published_at", { ascending: false });
      if (!includeAll) {
        query = query.eq("status", "published");
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Blog[];
    },
    initialData,
  });
};

export const useBlog = (slug: string, initialData?: Blog | null) => {
  return useQuery({
    queryKey: ["blog", slug],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("blogs")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      if (error) throw error;
      return data as Blog;
    },
    enabled: !!slug,
    initialData: initialData ?? undefined,
  });
};
