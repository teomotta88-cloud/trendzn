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
      brand_keywords: {
        Row: {
          active: boolean
          created_at: string
          id: string
          keyword: string
          platforms: string[]
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          keyword: string
          platforms?: string[]
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          keyword?: string
          platforms?: string[]
        }
        Relationships: []
      }
      brand_mentions: {
        Row: {
          author: string | null
          category: string | null
          content: string | null
          created_at: string
          engagement: number
          external_id: string
          id: string
          is_viral: boolean
          keyword_matched: string
          platform: string
          published_at: string | null
          raw: Json | null
          reach: number | null
          sentiment: string
          url: string
        }
        Insert: {
          author?: string | null
          category?: string | null
          content?: string | null
          created_at?: string
          engagement?: number
          external_id: string
          id?: string
          is_viral?: boolean
          keyword_matched: string
          platform: string
          published_at?: string | null
          raw?: Json | null
          reach?: number | null
          sentiment: string
          url: string
        }
        Update: {
          author?: string | null
          category?: string | null
          content?: string | null
          created_at?: string
          engagement?: number
          external_id?: string
          id?: string
          is_viral?: boolean
          keyword_matched?: string
          platform?: string
          published_at?: string | null
          raw?: Json | null
          reach?: number | null
          sentiment?: string
          url?: string
        }
        Relationships: []
      }
      brand_monitoring_runs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          keyword: string | null
          mentions_found: number
          platform: string | null
          requests_used: number
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          keyword?: string | null
          mentions_found?: number
          platform?: string | null
          requests_used?: number
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          keyword?: string | null
          mentions_found?: number
          platform?: string | null
          requests_used?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      brand_sentiment_alerts: {
        Row: {
          created_at: string
          id: string
          level: number
          metrics: Json | null
          platform: string | null
          reason: string
          resolved_at: string | null
          triggered_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          level: number
          metrics?: Json | null
          platform?: string | null
          reason: string
          resolved_at?: string | null
          triggered_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          metrics?: Json | null
          platform?: string | null
          reason?: string
          resolved_at?: string | null
          triggered_at?: string
        }
        Relationships: []
      }
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
      tiktok_trending_hashtags: {
        Row: {
          captured_at: string
          category: string[]
          hashtag: string
          id: string
          period_days: number
          post_count: number | null
          rank: number | null
          raw: Json | null
          region: string
          trend_points: Json | null
          view_count: number | null
        }
        Insert: {
          captured_at?: string
          category?: string[]
          hashtag: string
          id?: string
          period_days?: number
          post_count?: number | null
          rank?: number | null
          raw?: Json | null
          region?: string
          trend_points?: Json | null
          view_count?: number | null
        }
        Update: {
          captured_at?: string
          category?: string[]
          hashtag?: string
          id?: string
          period_days?: number
          post_count?: number | null
          rank?: number | null
          raw?: Json | null
          region?: string
          trend_points?: Json | null
          view_count?: number | null
        }
        Relationships: []
      }
      trend_submissions: {
        Row: {
          category: string | null
          created_at: string
          id: string
          industry: string | null
          posted_at: string | null
          raw_email: string | null
          section: string | null
          status: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by: string | null
          tags: string[] | null
          title: string | null
          url: string
          view_count: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          posted_at?: string | null
          raw_email?: string | null
          section?: string | null
          status?: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by?: string | null
          tags?: string[] | null
          title?: string | null
          url: string
          view_count?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          posted_at?: string | null
          raw_email?: string | null
          section?: string | null
          status?: Database["public"]["Enums"]["trend_submission_status"]
          submitted_by?: string | null
          tags?: string[] | null
          title?: string | null
          url?: string
          view_count?: number | null
        }
        Relationships: []
      }
      viral_trend_content: {
        Row: {
          author: string | null
          content: string | null
          created_at: string
          engagement: number
          external_id: string
          id: string
          is_viral: boolean
          keyword_matched: string
          platform: string
          published_at: string | null
          raw: Json | null
          reach: number | null
          source_hashtag: string
          url: string
        }
        Insert: {
          author?: string | null
          content?: string | null
          created_at?: string
          engagement?: number
          external_id: string
          id?: string
          is_viral?: boolean
          keyword_matched: string
          platform: string
          published_at?: string | null
          raw?: Json | null
          reach?: number | null
          source_hashtag: string
          url: string
        }
        Update: {
          author?: string | null
          content?: string | null
          created_at?: string
          engagement?: number
          external_id?: string
          id?: string
          is_viral?: boolean
          keyword_matched?: string
          platform?: string
          published_at?: string | null
          raw?: Json | null
          reach?: number | null
          source_hashtag?: string
          url?: string
        }
        Relationships: []
      }
      viral_trend_runs: {
        Row: {
          content_found: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          keyword_matched: string | null
          platform: string | null
          requests_used: number
          source_hashtag: string | null
          started_at: string
          status: string
        }
        Insert: {
          content_found?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          keyword_matched?: string | null
          platform?: string | null
          requests_used?: number
          source_hashtag?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          content_found?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          keyword_matched?: string | null
          platform?: string | null
          requests_used?: number
          source_hashtag?: string | null
          started_at?: string
          status?: string
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
