export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      blogs: {
        Row: {
          author: string
          category: string | null
          content: string | null
          cover_image: string | null
          created_at: string | null
          excerpt: string | null
          featured: boolean | null
          id: string
          published_at: string | null
          seo_description: string | null
          seo_title: string | null
          slug: string
          sort_order: number | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          author?: string
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string | null
          excerpt?: string | null
          featured?: boolean | null
          id?: string
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug: string
          sort_order?: number | null
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          author?: string
          category?: string | null
          content?: string | null
          cover_image?: string | null
          created_at?: string | null
          excerpt?: string | null
          featured?: boolean | null
          id?: string
          published_at?: string | null
          seo_description?: string | null
          seo_title?: string | null
          slug?: string
          sort_order?: number | null
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          price: number
          product_id: string
          product_title: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          price: number
          product_id: string
          product_title: string
          quantity?: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          price?: number
          product_id?: string
          product_title?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          guest_email: string
          guest_name: string
          guest_phone: string
          id: string
          phonepe_order_id: string | null
          phonepe_transaction_id: string | null
          shipping_address: string
          shipping_city: string
          shipping_cost: number
          shipping_pincode: string
          shipping_state: string
          status: string
          subtotal: number
          total: number
        }
        Insert: {
          created_at?: string
          guest_email: string
          guest_name: string
          guest_phone: string
          id?: string
          phonepe_order_id?: string | null
          phonepe_transaction_id?: string | null
          shipping_address: string
          shipping_city: string
          shipping_cost?: number
          shipping_pincode: string
          shipping_state: string
          status?: string
          subtotal: number
          total: number
        }
        Update: {
          created_at?: string
          guest_email?: string
          guest_name?: string
          guest_phone?: string
          id?: string
          phonepe_order_id?: string | null
          phonepe_transaction_id?: string | null
          shipping_address?: string
          shipping_city?: string
          shipping_cost?: number
          shipping_pincode?: string
          shipping_state?: string
          status?: string
          subtotal?: number
          total?: number
        }
        Relationships: []
      }
      physical_products: {
        Row: {
          bestseller: boolean | null
          category: string
          created_at: string | null
          dimensions: string | null
          featured: boolean | null
          featured_image: string | null
          full_description: string | null
          id: string
          images: Json | null
          price: number
          sale_price: number | null
          short_description: string | null
          sku: string | null
          slug: string
          sort_order: number | null
          status: string
          stock_quantity: number
          tags: string[] | null
          title: string
          weight: number | null
        }
        Insert: {
          bestseller?: boolean | null
          category?: string
          created_at?: string | null
          dimensions?: string | null
          featured?: boolean | null
          featured_image?: string | null
          full_description?: string | null
          id?: string
          images?: Json | null
          price: number
          sale_price?: number | null
          short_description?: string | null
          sku?: string | null
          slug: string
          sort_order?: number | null
          status?: string
          stock_quantity?: number
          tags?: string[] | null
          title: string
          weight?: number | null
        }
        Update: {
          bestseller?: boolean | null
          category?: string
          created_at?: string | null
          dimensions?: string | null
          featured?: boolean | null
          featured_image?: string | null
          full_description?: string | null
          id?: string
          images?: Json | null
          price?: number
          sale_price?: number | null
          short_description?: string | null
          sku?: string | null
          slug?: string
          sort_order?: number | null
          status?: string
          stock_quantity?: number
          tags?: string[] | null
          title?: string
          weight?: number | null
        }
        Relationships: []
      }
      pink_pages_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          name: string
          slug: string
          sort_order: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pink_pages_listings: {
        Row: {
          address: string | null
          business_name: string
          category_id: string | null
          city: string | null
          contact_person: string | null
          created_at: string | null
          email: string
          featured: boolean | null
          full_description: string | null
          id: string
          logo: string | null
          meta_description: string | null
          meta_title: string | null
          phone: string
          pincode: string | null
          short_description: string | null
          slug: string
          sort_order: number | null
          state: string | null
          status: string
          updated_at: string | null
          verified: boolean | null
          website: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          business_name: string
          category_id?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string | null
          email: string
          featured?: boolean | null
          full_description?: string | null
          id?: string
          logo?: string | null
          meta_description?: string | null
          meta_title?: string | null
          phone: string
          pincode?: string | null
          short_description?: string | null
          slug: string
          sort_order?: number | null
          state?: string | null
          status?: string
          updated_at?: string | null
          verified?: boolean | null
          website?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string
          category_id?: string | null
          city?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string
          featured?: boolean | null
          full_description?: string | null
          id?: string
          logo?: string | null
          meta_description?: string | null
          meta_title?: string | null
          phone?: string
          pincode?: string | null
          short_description?: string | null
          slug?: string
          sort_order?: number | null
          state?: string | null
          status?: string
          updated_at?: string | null
          verified?: boolean | null
          website?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pink_pages_listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "pink_pages_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_comments: {
        Row: {
          author_name: string
          content: string
          created_at: string
          id: string
          poll_id: string
        }
        Insert: {
          author_name?: string
          content: string
          created_at?: string
          id?: string
          poll_id: string
        }
        Update: {
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_comments_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          poll_id: string
          vote: string
          voter_fingerprint: string
        }
        Insert: {
          created_at?: string
          id?: string
          poll_id: string
          vote: string
          voter_fingerprint: string
        }
        Update: {
          created_at?: string
          id?: string
          poll_id?: string
          vote?: string
          voter_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          category: string
          created_at: string
          ends_at: string | null
          id: string
          image_emoji: string | null
          no_count: number
          question: string
          yes_count: number
        }
        Insert: {
          category?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          image_emoji?: string | null
          no_count?: number
          question: string
          yes_count?: number
        }
        Update: {
          category?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          image_emoji?: string | null
          no_count?: number
          question?: string
          yes_count?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          badge: string | null
          badge_color: string | null
          created_at: string | null
          description: string | null
          format: string | null
          icon: string
          id: string
          includes: Json | null
          is_active: boolean | null
          price: number
          price_max: number | null
          slug: string
          sort_order: number | null
          status: string
          subtitle: string | null
          title: string
        }
        Insert: {
          badge?: string | null
          badge_color?: string | null
          created_at?: string | null
          description?: string | null
          format?: string | null
          icon?: string
          id?: string
          includes?: Json | null
          is_active?: boolean | null
          price: number
          price_max?: number | null
          slug: string
          sort_order?: number | null
          status?: string
          subtitle?: string | null
          title: string
        }
        Update: {
          badge?: string | null
          badge_color?: string | null
          created_at?: string | null
          description?: string | null
          format?: string | null
          icon?: string
          id?: string
          includes?: Json | null
          is_active?: boolean | null
          price?: number
          price_max?: number | null
          slug?: string
          sort_order?: number | null
          status?: string
          subtitle?: string | null
          title?: string
        }
        Relationships: []
      }
      workshop_bookings: {
        Row: {
          addons_total: number
          booking_status: string
          certificate_url: string | null
          certification_addon: boolean | null
          city: string | null
          company_name: string | null
          contact_person: string | null
          created_at: string | null
          delivery_mode: string | null
          email: string
          full_name: string
          id: string
          internal_notes: string | null
          notes: string | null
          organization_type: string | null
          payment_status: string
          phone: string
          preferred_date: string | null
          preferred_time: string | null
          phonepe_order_id: string | null
          phonepe_transaction_id: string | null
          recording_addon: boolean | null
          subtotal: number
          team_size: number | null
          total: number
          venue_address: string | null
          workshop_id: string | null
          workshop_title: string
        }
        Insert: {
          addons_total?: number
          booking_status?: string
          certificate_url?: string | null
          certification_addon?: boolean | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string | null
          delivery_mode?: string | null
          email: string
          full_name: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          organization_type?: string | null
          payment_status?: string
          phone: string
          preferred_date?: string | null
          preferred_time?: string | null
          phonepe_order_id?: string | null
          phonepe_transaction_id?: string | null
          recording_addon?: boolean | null
          subtotal?: number
          team_size?: number | null
          total?: number
          venue_address?: string | null
          workshop_id?: string | null
          workshop_title: string
        }
        Update: {
          addons_total?: number
          booking_status?: string
          certificate_url?: string | null
          certification_addon?: boolean | null
          city?: string | null
          company_name?: string | null
          contact_person?: string | null
          created_at?: string | null
          delivery_mode?: string | null
          email?: string
          full_name?: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          organization_type?: string | null
          payment_status?: string
          phone?: string
          preferred_date?: string | null
          preferred_time?: string | null
          phonepe_order_id?: string | null
          phonepe_transaction_id?: string | null
          recording_addon?: boolean | null
          subtotal?: number
          team_size?: number | null
          total?: number
          venue_address?: string | null
          workshop_id?: string | null
          workshop_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshop_bookings_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      workshop_quote_requests: {
        Row: {
          budget: string | null
          company_name: string
          contact_name: string
          created_at: string | null
          email: string
          goals: string | null
          id: string
          internal_notes: string | null
          phone: string
          preferred_format: string | null
          status: string
          team_size: number | null
        }
        Insert: {
          budget?: string | null
          company_name: string
          contact_name: string
          created_at?: string | null
          email: string
          goals?: string | null
          id?: string
          internal_notes?: string | null
          phone: string
          preferred_format?: string | null
          status?: string
          team_size?: number | null
        }
        Update: {
          budget?: string | null
          company_name?: string
          contact_name?: string
          created_at?: string | null
          email?: string
          goals?: string | null
          id?: string
          internal_notes?: string | null
          phone?: string
          preferred_format?: string | null
          status?: string
          team_size?: number | null
        }
        Relationships: []
      }
      workshop_sessions: {
        Row: {
          booking_ids: string[] | null
          created_at: string | null
          delivery_mode: string | null
          duration: string | null
          id: string
          internal_notes: string | null
          max_participants: number | null
          session_date: string | null
          session_time: string | null
          status: string
          title: string
          total_participants: number | null
          trainer: string | null
          venue_or_link: string | null
          workshop_id: string | null
        }
        Insert: {
          booking_ids?: string[] | null
          created_at?: string | null
          delivery_mode?: string | null
          duration?: string | null
          id?: string
          internal_notes?: string | null
          max_participants?: number | null
          session_date?: string | null
          session_time?: string | null
          status?: string
          title: string
          total_participants?: number | null
          trainer?: string | null
          venue_or_link?: string | null
          workshop_id?: string | null
        }
        Update: {
          booking_ids?: string[] | null
          created_at?: string | null
          delivery_mode?: string | null
          duration?: string | null
          id?: string
          internal_notes?: string | null
          max_participants?: number | null
          session_date?: string | null
          session_time?: string | null
          status?: string
          title?: string
          total_participants?: number | null
          trainer?: string | null
          venue_or_link?: string | null
          workshop_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workshop_sessions_workshop_id_fkey"
            columns: ["workshop_id"]
            isOneToOne: false
            referencedRelation: "workshops"
            referencedColumns: ["id"]
          },
        ]
      }
      workshops: {
        Row: {
          benefits: Json | null
          category: string | null
          certificate_included: boolean | null
          certification_addon_available: boolean | null
          certification_addon_price: number | null
          created_at: string | null
          custom_quote_enabled: boolean | null
          discount_text: string | null
          duration: string | null
          featured: boolean | null
          full_description: string | null
          icon: string | null
          id: string
          image_url: string | null
          inclusions: Json | null
          min_people: number | null
          original_price: number | null
          popular: boolean | null
          price: number
          recording_addon_available: boolean | null
          recording_addon_price: number | null
          short_description: string | null
          slug: string
          sort_order: number | null
          status: string
          tags: string[] | null
          title: string
          workshop_type: string
        }
        Insert: {
          benefits?: Json | null
          category?: string | null
          certificate_included?: boolean | null
          certification_addon_available?: boolean | null
          certification_addon_price?: number | null
          created_at?: string | null
          custom_quote_enabled?: boolean | null
          discount_text?: string | null
          duration?: string | null
          featured?: boolean | null
          full_description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          inclusions?: Json | null
          min_people?: number | null
          original_price?: number | null
          popular?: boolean | null
          price?: number
          recording_addon_available?: boolean | null
          recording_addon_price?: number | null
          short_description?: string | null
          slug: string
          sort_order?: number | null
          status?: string
          tags?: string[] | null
          title: string
          workshop_type?: string
        }
        Update: {
          benefits?: Json | null
          category?: string | null
          certificate_included?: boolean | null
          certification_addon_available?: boolean | null
          certification_addon_price?: number | null
          created_at?: string | null
          custom_quote_enabled?: boolean | null
          discount_text?: string | null
          duration?: string | null
          featured?: boolean | null
          full_description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          inclusions?: Json | null
          min_people?: number | null
          original_price?: number | null
          popular?: boolean | null
          price?: number
          recording_addon_available?: boolean | null
          recording_addon_price?: number | null
          short_description?: string | null
          slug?: string
          sort_order?: number | null
          status?: string
          tags?: string[] | null
          title?: string
          workshop_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cast_vote: {
        Args: { p_fingerprint: string; p_poll_id: string; p_vote: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
