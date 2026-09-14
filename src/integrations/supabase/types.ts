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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      autopilot_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          household_id: string
          id: string
          status: string
          week_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          household_id: string
          id?: string
          status?: string
          week_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          household_id?: string
          id?: string
          status?: string
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_log_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      card_squares: {
        Row: {
          card_id: string
          event_id: string
          grid_position: number
        }
        Insert: {
          card_id: string
          event_id: string
          grid_position: number
        }
        Update: {
          card_id?: string
          event_id?: string
          grid_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "card_squares_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_squares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          created_at: string
          household_id: string
          id: string
          locked_at: string | null
          profile_id: string
          week_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          locked_at?: string | null
          profile_id: string
          week_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          locked_at?: string | null
          profile_id?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          description: string
          game_id: string | null
          household_id: string
          id: string
          is_longshot: boolean
          resolution_source: Database["public"]["Enums"]["resolution_source"]
          resolved_at: string | null
          result: string | null
          week_id: string
        }
        Insert: {
          created_at?: string
          description: string
          game_id?: string | null
          household_id: string
          id?: string
          is_longshot?: boolean
          resolution_source?: Database["public"]["Enums"]["resolution_source"]
          resolved_at?: string | null
          result?: string | null
          week_id: string
        }
        Update: {
          created_at?: string
          description?: string
          game_id?: string | null
          household_id?: string
          id?: string
          is_longshot?: boolean
          resolution_source?: Database["public"]["Enums"]["resolution_source"]
          resolved_at?: string | null
          result?: string | null
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string
          espn_event_id: string | null
          home_score: number | null
          home_team: string
          household_id: string
          id: string
          kickoff_at: string | null
          needs_review: boolean
          underdog_team: string | null
          upset_size: number
          upset_won: boolean | null
          week_id: string
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string
          espn_event_id?: string | null
          home_score?: number | null
          home_team: string
          household_id: string
          id?: string
          kickoff_at?: string | null
          needs_review?: boolean
          underdog_team?: string | null
          upset_size?: number
          upset_won?: boolean | null
          week_id: string
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string
          espn_event_id?: string | null
          home_score?: number | null
          home_team?: string
          household_id?: string
          id?: string
          kickoff_at?: string | null
          needs_review?: boolean
          underdog_team?: string | null
          upset_size?: number
          upset_won?: boolean | null
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          auto_create_weeks: boolean
          created_at: string
          id: string
          name: string
          owner_user_id: string
        }
        Insert: {
          auto_create_weeks?: boolean
          created_at?: string
          id?: string
          name: string
          owner_user_id?: string
        }
        Update: {
          auto_create_weeks?: boolean
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar: string
          color: string
          created_at: string
          display_name: string
          household_id: string
          id: string
          is_commissioner: boolean
        }
        Insert: {
          avatar?: string
          color?: string
          created_at?: string
          display_name: string
          household_id: string
          id?: string
          is_commissioner?: boolean
        }
        Update: {
          avatar?: string
          color?: string
          created_at?: string
          display_name?: string
          household_id?: string
          id?: string
          is_commissioner?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      upset_picks: {
        Row: {
          card_id: string
          game_id: string
          id: string
          picked_team: string
          upset_size: number
        }
        Insert: {
          card_id: string
          game_id: string
          id?: string
          picked_team: string
          upset_size?: number
        }
        Update: {
          card_id?: string
          game_id?: string
          id?: string
          picked_team?: string
          upset_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "upset_picks_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upset_picks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_scores: {
        Row: {
          card_id: string
          created_at: string
          first_line_at: string | null
          grid_score: number
          hits: number
          lines: number
          rank: number | null
          upset_score: number
        }
        Insert: {
          card_id: string
          created_at?: string
          first_line_at?: string | null
          grid_score?: number
          hits?: number
          lines?: number
          rank?: number | null
          upset_score?: number
        }
        Update: {
          card_id?: string
          created_at?: string
          first_line_at?: string | null
          grid_score?: number
          hits?: number
          lines?: number
          rank?: number | null
          upset_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_scores_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      weeks: {
        Row: {
          auto_created_at: string | null
          auto_locked_at: string | null
          auto_opened_at: string | null
          autopilot_checked_at: string | null
          autopilot_hold: boolean
          commissioner_edited_at: string | null
          created_at: string
          featured_game_id: string | null
          finalized_at: string | null
          household_id: string
          id: string
          lock_at: string | null
          lock_at_override: boolean
          season_year: number
          status: string
          week_number: number
        }
        Insert: {
          auto_created_at?: string | null
          auto_locked_at?: string | null
          auto_opened_at?: string | null
          autopilot_checked_at?: string | null
          autopilot_hold?: boolean
          commissioner_edited_at?: string | null
          created_at?: string
          featured_game_id?: string | null
          finalized_at?: string | null
          household_id: string
          id?: string
          lock_at?: string | null
          lock_at_override?: boolean
          season_year: number
          status?: string
          week_number: number
        }
        Update: {
          auto_created_at?: string | null
          auto_locked_at?: string | null
          auto_opened_at?: string | null
          autopilot_checked_at?: string | null
          autopilot_hold?: boolean
          commissioner_edited_at?: string | null
          created_at?: string
          featured_game_id?: string | null
          finalized_at?: string | null
          household_id?: string
          id?: string
          lock_at?: string | null
          lock_at_override?: boolean
          season_year?: number
          status?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weeks_featured_game_fkey"
            columns: ["featured_game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weeks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reassign_commissioner: {
        Args: { player_id: string };
        Returns: undefined;
      };
      ops_relink_auth_identities: {
        Args: { from_user_id: string; to_user_id: string }
        Returns: Json
      }
      owns_card: { Args: { _card_id: string }; Returns: boolean }
      owns_household: { Args: { _household_id: string }; Returns: boolean }
    }
    Enums: {
      resolution_source: "auto_score" | "manual"
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
      resolution_source: ["auto_score", "manual"],
    },
  },
} as const
