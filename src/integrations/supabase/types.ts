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
      bluserena_hashtag_posts: {
        Row: {
          author: string | null
          caption: string | null
          detail_attempt_count: number
          detail_fail_reason: string | null
          detail_last_attempt_at: string | null
          detail_status: string
          discovered_at: string
          hashtag_url: string
          id: string
          location: string | null
          platform: string
          published_at: string | null
          sentiment: string | null
          sentiment_source: string | null
          tag: string
          topic: string | null
          updated_at: string
          url: string
          views: number | null
        }
        Insert: {
          author?: string | null
          caption?: string | null
          detail_attempt_count?: number
          detail_fail_reason?: string | null
          detail_last_attempt_at?: string | null
          detail_status?: string
          discovered_at?: string
          hashtag_url: string
          id?: string
          location?: string | null
          platform: string
          published_at?: string | null
          sentiment?: string | null
          sentiment_source?: string | null
          tag: string
          topic?: string | null
          updated_at?: string
          url: string
          views?: number | null
        }
        Update: {
          author?: string | null
          caption?: string | null
          detail_attempt_count?: number
          detail_fail_reason?: string | null
          detail_last_attempt_at?: string | null
          detail_status?: string
          discovered_at?: string
          hashtag_url?: string
          id?: string
          location?: string | null
          platform?: string
          published_at?: string | null
          sentiment?: string | null
          sentiment_source?: string | null
          tag?: string
          topic?: string | null
          updated_at?: string
          url?: string
          views?: number | null
        }
        Relationships: []
      }
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
      cross_source_trends: {
        Row: {
          canali_inspo_topic: string | null
          computed_at: string
          id: string
          is_accelerating: boolean
          label: string
          source_count: number
          sources: string[]
          tier: string | null
          topic_ids: string[]
        }
        Insert: {
          canali_inspo_topic?: string | null
          computed_at?: string
          id?: string
          is_accelerating?: boolean
          label: string
          source_count: number
          sources: string[]
          tier?: string | null
          topic_ids?: string[]
        }
        Update: {
          canali_inspo_topic?: string | null
          computed_at?: string
          id?: string
          is_accelerating?: boolean
          label?: string
          source_count?: number
          sources?: string[]
          tier?: string | null
          topic_ids?: string[]
        }
        Relationships: []
      }
      custom_fonts: {
        Row: {
          created_at: string
          family_name: string
          id: string
          storage_path: string
          style: string
          weight: number
        }
        Insert: {
          created_at?: string
          family_name: string
          id?: string
          storage_path: string
          style?: string
          weight?: number
        }
        Update: {
          created_at?: string
          family_name?: string
          id?: string
          storage_path?: string
          style?: string
          weight?: number
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
          rubrica_id: string | null
          topic: string | null
          visual_formato: string | null
          visual_media_ids: string[]
          visual_rubrica_id: string | null
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
          rubrica_id?: string | null
          topic?: string | null
          visual_formato?: string | null
          visual_media_ids?: string[]
          visual_rubrica_id?: string | null
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
          rubrica_id?: string | null
          topic?: string | null
          visual_formato?: string | null
          visual_media_ids?: string[]
          visual_rubrica_id?: string | null
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
          {
            foreignKeyName: "editorial_posts_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_posts_visual_rubrica_id_fkey"
            columns: ["visual_rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
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
      getty_candidates: {
        Row: {
          asset_id: string
          created_at: string
          id: string
          job_id: string
          layer_name: string
          orientamento: string | null
          preview_url: string
          selected: boolean
          title: string | null
        }
        Insert: {
          asset_id: string
          created_at?: string
          id?: string
          job_id: string
          layer_name?: string
          orientamento?: string | null
          preview_url: string
          selected?: boolean
          title?: string | null
        }
        Update: {
          asset_id?: string
          created_at?: string
          id?: string
          job_id?: string
          layer_name?: string
          orientamento?: string | null
          preview_url?: string
          selected?: boolean
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "getty_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "graphic_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      graphic_job_formats: {
        Row: {
          created_at: string
          error_detail: string | null
          figma_component_id: string | null
          formato: string
          height_px: number | null
          id: string
          job_id: string
          output_url: string | null
          status: string
          updated_at: string
          width_px: number | null
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          figma_component_id?: string | null
          formato: string
          height_px?: number | null
          id?: string
          job_id: string
          output_url?: string | null
          status?: string
          updated_at?: string
          width_px?: number | null
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          figma_component_id?: string | null
          formato?: string
          height_px?: number | null
          id?: string
          job_id?: string
          output_url?: string | null
          status?: string
          updated_at?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "graphic_job_formats_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "graphic_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      graphic_job_images: {
        Row: {
          asset_id: string | null
          created_at: string
          id: string
          image_url: string
          job_id: string
          layer_name: string
          source: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          id?: string
          image_url: string
          job_id: string
          layer_name: string
          source: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          id?: string
          image_url?: string
          job_id?: string
          layer_name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "graphic_job_images_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "graphic_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      graphic_jobs: {
        Row: {
          copy_payload: Json
          created_at: string
          error_detail: string | null
          getty_asset_id: string | null
          getty_image_url: string | null
          id: string
          post_id: string
          rubrica_id: string
          status: string
          updated_at: string
        }
        Insert: {
          copy_payload?: Json
          created_at?: string
          error_detail?: string | null
          getty_asset_id?: string | null
          getty_image_url?: string | null
          id?: string
          post_id: string
          rubrica_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          copy_payload?: Json
          created_at?: string
          error_detail?: string | null
          getty_asset_id?: string | null
          getty_image_url?: string | null
          id?: string
          post_id?: string
          rubrica_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "graphic_jobs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graphic_jobs_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_topics: {
        Row: {
          category: string | null
          created_at: string
          derived_hashtag: string | null
          derived_keyword: string | null
          engagement_growth_pct: number | null
          first_seen_in_top5_at: string
          growth_computed_at: string | null
          growth_platform: string | null
          id: string
          last_seen_in_top5_at: string
          latest_content_volume: number | null
          latest_is_volume_exact: boolean
          latest_total_engagement: number | null
          monitoring_stops_at: string
          status: string
          topic_type: string
          updated_at: string
          value: string
          volume_growth_pct: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          derived_hashtag?: string | null
          derived_keyword?: string | null
          engagement_growth_pct?: number | null
          first_seen_in_top5_at?: string
          growth_computed_at?: string | null
          growth_platform?: string | null
          id?: string
          last_seen_in_top5_at?: string
          latest_content_volume?: number | null
          latest_is_volume_exact?: boolean
          latest_total_engagement?: number | null
          monitoring_stops_at?: string
          status?: string
          topic_type: string
          updated_at?: string
          value: string
          volume_growth_pct?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          derived_hashtag?: string | null
          derived_keyword?: string | null
          engagement_growth_pct?: number | null
          first_seen_in_top5_at?: string
          growth_computed_at?: string | null
          growth_platform?: string | null
          id?: string
          last_seen_in_top5_at?: string
          latest_content_volume?: number | null
          latest_is_volume_exact?: boolean
          latest_total_engagement?: number | null
          monitoring_stops_at?: string
          status?: string
          topic_type?: string
          updated_at?: string
          value?: string
          volume_growth_pct?: number | null
        }
        Relationships: []
      }
      post_visual_elements: {
        Row: {
          card_index: number
          created_at: string
          height: number
          id: string
          layer_name: string | null
          post_id: string
          rotation: number
          style: Json
          tipo: string
          updated_at: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          card_index?: number
          created_at?: string
          height: number
          id?: string
          layer_name?: string | null
          post_id: string
          rotation?: number
          style?: Json
          tipo: string
          updated_at?: string
          width: number
          x: number
          y: number
          z_index?: number
        }
        Update: {
          card_index?: number
          created_at?: string
          height?: number
          id?: string
          layer_name?: string | null
          post_id?: string
          rotation?: number
          style?: Json
          tipo?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_visual_elements_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "editorial_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      rubrica_formati: {
        Row: {
          attivo: boolean
          created_at: string
          figma_component_id: string | null
          formato: string
          height_px: number
          id: string
          rubrica_id: string
          width_px: number
        }
        Insert: {
          attivo?: boolean
          created_at?: string
          figma_component_id?: string | null
          formato: string
          height_px: number
          id?: string
          rubrica_id: string
          width_px: number
        }
        Update: {
          attivo?: boolean
          created_at?: string
          figma_component_id?: string | null
          formato?: string
          height_px?: number
          id?: string
          rubrica_id?: string
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "rubrica_formati_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
            referencedColumns: ["id"]
          },
        ]
      }
      rubriche: {
        Row: {
          attiva: boolean
          created_at: string
          figma_component_id: string | null
          figma_file_key: string | null
          id: string
          nome: string
          tipo_template: string
        }
        Insert: {
          attiva?: boolean
          created_at?: string
          figma_component_id?: string | null
          figma_file_key?: string | null
          id?: string
          nome: string
          tipo_template: string
        }
        Update: {
          attiva?: boolean
          created_at?: string
          figma_component_id?: string | null
          figma_file_key?: string | null
          id?: string
          nome?: string
          tipo_template?: string
        }
        Relationships: []
      }
      template_constraints: {
        Row: {
          card_index: number
          created_at: string
          id: string
          layer_name: string
          layer_type: string
          max_chars: number | null
          max_font_size: number | null
          max_lines: number | null
          min_font_size: number | null
          obbligatorio: boolean
          rubrica_id: string
        }
        Insert: {
          card_index?: number
          created_at?: string
          id?: string
          layer_name: string
          layer_type?: string
          max_chars?: number | null
          max_font_size?: number | null
          max_lines?: number | null
          min_font_size?: number | null
          obbligatorio?: boolean
          rubrica_id: string
        }
        Update: {
          card_index?: number
          created_at?: string
          id?: string
          layer_name?: string
          layer_type?: string
          max_chars?: number | null
          max_font_size?: number | null
          max_lines?: number | null
          min_font_size?: number | null
          obbligatorio?: boolean
          rubrica_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_constraints_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
            referencedColumns: ["id"]
          },
        ]
      }
      template_elements: {
        Row: {
          card_index: number
          created_at: string
          formato: string | null
          height: number
          id: string
          layer_name: string | null
          rotation: number
          rubrica_id: string
          style: Json
          tipo: string
          updated_at: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          card_index?: number
          created_at?: string
          formato?: string | null
          height?: number
          id?: string
          layer_name?: string | null
          rotation?: number
          rubrica_id: string
          style?: Json
          tipo: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Update: {
          card_index?: number
          created_at?: string
          formato?: string | null
          height?: number
          id?: string
          layer_name?: string | null
          rotation?: number
          rubrica_id?: string
          style?: Json
          tipo?: string
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_elements_rubrica_id_fkey"
            columns: ["rubrica_id"]
            isOneToOne: false
            referencedRelation: "rubriche"
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
      topic_growth_history: {
        Row: {
          computed_at: string
          engagement_growth_pct: number | null
          id: string
          platform: string
          topic_id: string
          volume_growth_pct: number | null
        }
        Insert: {
          computed_at?: string
          engagement_growth_pct?: number | null
          id?: string
          platform: string
          topic_id: string
          volume_growth_pct?: number | null
        }
        Update: {
          computed_at?: string
          engagement_growth_pct?: number | null
          id?: string
          platform?: string
          topic_id?: string
          volume_growth_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_growth_history_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "monitored_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_metrics_history: {
        Row: {
          captured_at: string
          content_volume: number | null
          id: string
          is_volume_exact: boolean
          platform: string
          topic_id: string
          total_engagement: number | null
        }
        Insert: {
          captured_at?: string
          content_volume?: number | null
          id?: string
          is_volume_exact?: boolean
          platform: string
          topic_id: string
          total_engagement?: number | null
        }
        Update: {
          captured_at?: string
          content_volume?: number | null
          id?: string
          is_volume_exact?: boolean
          platform?: string
          topic_id?: string
          total_engagement?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_metrics_history_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "monitored_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_signals: {
        Row: {
          computed_at: string
          engagement_growth_pct: number | null
          is_volume_exact: boolean
          latest_content_volume: number | null
          latest_total_engagement: number | null
          platform: string
          topic_id: string
          volume_growth_pct: number | null
        }
        Insert: {
          computed_at?: string
          engagement_growth_pct?: number | null
          is_volume_exact?: boolean
          latest_content_volume?: number | null
          latest_total_engagement?: number | null
          platform: string
          topic_id: string
          volume_growth_pct?: number | null
        }
        Update: {
          computed_at?: string
          engagement_growth_pct?: number | null
          is_volume_exact?: boolean
          latest_content_volume?: number | null
          latest_total_engagement?: number | null
          platform?: string
          topic_id?: string
          volume_growth_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_signals_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "monitored_topics"
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
          audio_fingerprint: number[] | null
          audio_name: string | null
          audio_trend_channel_count: number | null
          audio_trend_matched_by: string | null
          audio_trend_reel_count: number | null
          audio_url: string | null
          author: string | null
          content: string | null
          created_at: string
          cross_profile_channel_count: number | null
          cross_profile_topic: string | null
          delta_engagement: number
          delta_engagement_6h: number
          delta_reach: number
          delta_since: string | null
          discovery_source: string
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
          topic_id: string | null
          updated_at: string
          url: string
        }
        Insert: {
          audio_fingerprint?: number[] | null
          audio_name?: string | null
          audio_trend_channel_count?: number | null
          audio_trend_matched_by?: string | null
          audio_trend_reel_count?: number | null
          audio_url?: string | null
          author?: string | null
          content?: string | null
          created_at?: string
          cross_profile_channel_count?: number | null
          cross_profile_topic?: string | null
          delta_engagement?: number
          delta_engagement_6h?: number
          delta_reach?: number
          delta_since?: string | null
          discovery_source?: string
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
          topic_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          audio_fingerprint?: number[] | null
          audio_name?: string | null
          audio_trend_channel_count?: number | null
          audio_trend_matched_by?: string | null
          audio_trend_reel_count?: number | null
          audio_url?: string | null
          author?: string | null
          content?: string | null
          created_at?: string
          cross_profile_channel_count?: number | null
          cross_profile_topic?: string | null
          delta_engagement?: number
          delta_engagement_6h?: number
          delta_reach?: number
          delta_since?: string | null
          discovery_source?: string
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
          topic_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "viral_trend_content_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "monitored_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      viral_trend_metrics_history: {
        Row: {
          captured_at: string
          content_id: string
          engagement: number
          id: string
          reach: number | null
        }
        Insert: {
          captured_at?: string
          content_id: string
          engagement?: number
          id?: string
          reach?: number | null
        }
        Update: {
          captured_at?: string
          content_id?: string
          engagement?: number
          id?: string
          reach?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "viral_trend_metrics_history_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "viral_trend_content"
            referencedColumns: ["id"]
          },
        ]
      }
      viral_trend_runs: {
        Row: {
          content_found: number
          created_at: string
          discovery_source: string | null
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
          discovery_source?: string | null
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
          discovery_source?: string | null
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
