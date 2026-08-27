export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
          id: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
          id?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
      call_sessions: {
        Row: {
          connected_at: string | null;
          created_at: string;
          duration_seconds: number | null;
          end_reason: string | null;
          ended_at: string | null;
          ended_by: string | null;
          id: string;
          room_name: string;
          started_at: string;
          status: Database["public"]["Enums"]["call_status"];
          updated_at: string;
          user_a: string;
          user_b: string;
        };
        Insert: {
          connected_at?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          end_reason?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          id?: string;
          room_name: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["call_status"];
          updated_at?: string;
          user_a: string;
          user_b: string;
        };
        Update: {
          connected_at?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          end_reason?: string | null;
          ended_at?: string | null;
          ended_by?: string | null;
          id?: string;
          room_name?: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["call_status"];
          updated_at?: string;
          user_a?: string;
          user_b?: string;
        };
        Relationships: [];
      };
      match_cooldowns: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          other_user_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          other_user_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          other_user_id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      matchmaking_queue: {
        Row: {
          heartbeat_at: string;
          joined_at: string;
          preferences: Json;
          session_id: string | null;
          status: Database["public"]["Enums"]["queue_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          heartbeat_at?: string;
          joined_at?: string;
          preferences?: Json;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["queue_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          heartbeat_at?: string;
          joined_at?: string;
          preferences?: Json;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["queue_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "matchmaking_queue_session_fk";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "call_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          sender_id: string;
          session_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          sender_id: string;
          session_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          sender_id?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "call_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_actions: {
        Row: {
          action: Database["public"]["Enums"]["moderation_action_type"];
          actor_id: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          reason: string | null;
          report_id: string | null;
          target_user_id: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["moderation_action_type"];
          actor_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          reason?: string | null;
          report_id?: string | null;
          target_user_id: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["moderation_action_type"];
          actor_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          reason?: string | null;
          report_id?: string | null;
          target_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: Json;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: Json;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"];
          avatar_url: string | null;
          bio: string | null;
          country: string | null;
          created_at: string;
          date_of_birth: string | null;
          display_name: string | null;
          gender: Database["public"]["Enums"]["gender_type"] | null;
          id: string;
          interests: string[];
          last_active_at: string;
          presence: Database["public"]["Enums"]["presence_status"];
          profile_completed: boolean;
          suspended_until: string | null;
          updated_at: string;
          username: string | null;
        };
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"];
          avatar_url?: string | null;
          bio?: string | null;
          country?: string | null;
          created_at?: string;
          date_of_birth?: string | null;
          display_name?: string | null;
          gender?: Database["public"]["Enums"]["gender_type"] | null;
          id: string;
          interests?: string[];
          last_active_at?: string;
          presence?: Database["public"]["Enums"]["presence_status"];
          profile_completed?: boolean;
          suspended_until?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"];
          avatar_url?: string | null;
          bio?: string | null;
          country?: string | null;
          created_at?: string;
          date_of_birth?: string | null;
          display_name?: string | null;
          gender?: Database["public"]["Enums"]["gender_type"] | null;
          id?: string;
          interests?: string[];
          last_active_at?: string;
          presence?: Database["public"]["Enums"]["presence_status"];
          profile_completed?: boolean;
          suspended_until?: string | null;
          updated_at?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          reason: Database["public"]["Enums"]["report_reason"];
          reported_id: string;
          reporter_id: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          session_id: string | null;
          status: Database["public"]["Enums"]["report_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: Database["public"]["Enums"]["report_reason"];
          reported_id: string;
          reporter_id: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: Database["public"]["Enums"]["report_reason"];
          reported_id?: string;
          reporter_id?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reports_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "call_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      user_devices: {
        Row: {
          created_at: string;
          id: string;
          last_seen_at: string;
          platform: string;
          push_token: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          push_token: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          platform?: string;
          push_token?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_public_profile: {
        Args: { _user_id: string };
        Returns: {
          age: number;
          avatar_url: string;
          bio: string;
          country: string;
          display_name: string;
          gender: Database["public"]["Enums"]["gender_type"];
          id: string;
          interests: string[];
          last_active_at: string;
          presence: Database["public"]["Enums"]["presence_status"];
          username: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_blocked_pair: { Args: { _a: string; _b: string }; Returns: boolean };
      is_session_participant: {
        Args: { _session_id: string; _user_id: string };
        Returns: boolean;
      };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      list_public_profiles: {
        Args: { _user_ids: string[] };
        Returns: {
          age: number;
          avatar_url: string;
          bio: string;
          country: string;
          display_name: string;
          gender: Database["public"]["Enums"]["gender_type"];
          id: string;
          interests: string[];
          last_active_at: string;
          presence: Database["public"]["Enums"]["presence_status"];
          username: string;
        }[];
      };
    };
    Enums: {
      account_status:
        "pending_profile" | "active" | "suspended" | "banned" | "deleted";
      app_role: "user" | "moderator" | "admin";
      call_status: "pending" | "connecting" | "connected" | "ended" | "failed";
      gender_type:
        "female" | "male" | "non_binary" | "other" | "prefer_not_to_say";
      moderation_action_type:
        | "warn"
        | "suspend"
        | "ban"
        | "unban"
        | "terminate_session"
        | "dismiss_report";
      presence_status: "offline" | "online" | "searching" | "in_call" | "away";
      queue_status: "searching" | "matched" | "cancelled";
      report_reason:
        | "harassment"
        | "sexual_content"
        | "nudity"
        | "spam"
        | "scam"
        | "hate"
        | "underage"
        | "other";
      report_status: "open" | "reviewing" | "actioned" | "dismissed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_status: [
        "pending_profile",
        "active",
        "suspended",
        "banned",
        "deleted",
      ],
      app_role: ["user", "moderator", "admin"],
      call_status: ["pending", "connecting", "connected", "ended", "failed"],
      gender_type: [
        "female",
        "male",
        "non_binary",
        "other",
        "prefer_not_to_say",
      ],
      moderation_action_type: [
        "warn",
        "suspend",
        "ban",
        "unban",
        "terminate_session",
        "dismiss_report",
      ],
      presence_status: ["offline", "online", "searching", "in_call", "away"],
      queue_status: ["searching", "matched", "cancelled"],
      report_reason: [
        "harassment",
        "sexual_content",
        "nudity",
        "spam",
        "scam",
        "hate",
        "underage",
        "other",
      ],
      report_status: ["open", "reviewing", "actioned", "dismissed"],
    },
  },
} as const;
