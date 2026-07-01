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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      editorial_client_channels: {
        Row: {
          canale: string
          created_at: string
          handle: string
          id: string
          url: string
        }
        Insert: {
          canale: string
          created_at?: string
          handle: string
          id?: string
          url: string
        }
        Update: {
          canale?: string
          created_at?: string
          handle?: string
          id?: string
          url?: string
        }
        Relationships: []
      }
      editorial_plans: {
        Row: {
          created_at: string
          id: string
          month: number
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          year?: number
        }
        Relationships: []
      }
      editorial_post_approvals: {
        Row: {
          component: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          component: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          component?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_post_approvals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_post_comments: {
        Row: {
          body: string
          component: string
          created_at: string
          id: string
          post_id: string
        }
        Insert: {
          body: string
          component: string
          created_at?: string
          id?: string
          post_id: string
        }
        Update: {
          body?: string
          component?: string
          created_at?: string
          id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_post_media: {
        Row: {
          created_at: string
          id: string
          position: number
          post_id: string
          type: string | null
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          post_id: string
          type?: string | null
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          post_id?: string
          type?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_posts: {
        Row: {
          budget_media: number | null
          canali: string[]
          channel_copies: Json
          copy_visual: string | null
          created_at: string
          disclaimer: string | null
          formato: string | null
          id: string
          obiettivo_media: string | null
          plan_id: string
          post_date: string
          programmato: boolean
          rubrica: string | null
          topic: string | null
          visual_type: string | null
          visual_url: string | null
        }
        Insert: {
          budget_media?: number | null
          canali?: string[]
          channel_copies?: Json
          copy_visual?: string | null
          created_at?: string
          disclaimer?: string | null
          formato?: string | null
          id?: string
          obiettivo_media?: string | null
          plan_id: string
          post_date: string
          programmato?: boolean
          rubrica?: string | null
          topic?: string | null
          visual_type?: string | null
          visual_url?: string | null
        }
        Update: {
          budget_media?: number | null
          canali?: string[]
          channel_copies?: Json
          copy_visual?: string | null
          created_at?: string
          disclaimer?: string | null
          formato?: string | null
          id?: string
          obiettivo_media?: string | null
          plan_id?: string
          post_date?: string
          programmato?: boolean
          rubrica?: string | null
          topic?: string | null
          visual_type?: string | null
          visual_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "editorial_posts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "editorial_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_published_posts: {
        Row: {
          canale: string
          caption: string | null
          created_at: string
          id: string
          matched_post_id: string | null
          published_date: string
          url: string
        }
        Insert: {
          canale: string
          caption?: string | null
          created_at?: string
          id?: string
          matched_post_id?: string | null
          published_date: string
          url: string
        }
        Update: {
          canale?: string
          caption?: string | null
          created_at?: string
          id?: string
          matched_post_id?: string | null
          published_date?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_published_posts_matched_post_id_fkey"
            columns: ["matched_post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      trend_submissions: {
        Row: {
          category: string | null
          created_at: string
          id: string
          industry: string | null
          raw_email: string | null
          section: string | null
          status: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by: string | null
          tags: string[] | null
          title: string | null
          url: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          raw_email?: string | null
          section?: string | null
          status?: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by?: string | null
          tags?: string[] | null
          title?: string | null
          url: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          raw_email?: string | null
          section?: string | null
          status?: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by?: string | null
          tags?: string[] | null
          title?: string | null
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      trend_submission_status: "pending" | "approved" | "rejected"
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
    Enums: {
      trend_submission_status: ["pending", "approved", "rejected"],
    },
  },
} as const
