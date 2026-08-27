import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type Profile = Tables["profiles"]["Row"];
export type ProfileUpdate = Tables["profiles"]["Update"];
export type UserRole = Tables["user_roles"]["Row"];
export type MatchmakingQueueEntry = Tables["matchmaking_queue"]["Row"];
export type MatchCooldown = Tables["match_cooldowns"]["Row"];
export type CallSession = Tables["call_sessions"]["Row"];
export type Message = Tables["messages"]["Row"];
export type Block = Tables["blocks"]["Row"];
export type Report = Tables["reports"]["Row"];
export type Notification = Tables["notifications"]["Row"];
export type UserDevice = Tables["user_devices"]["Row"];
export type ModerationAction = Tables["moderation_actions"]["Row"];
export type AdminAuditLog = Tables["admin_audit_logs"]["Row"];

export type AppRole = Enums["app_role"];
export type PresenceStatus = Enums["presence_status"];
export type AccountStatus = Enums["account_status"];
export type GenderType = Enums["gender_type"];
export type QueueStatus = Enums["queue_status"];
export type CallStatus = Enums["call_status"];
export type ReportReason = Enums["report_reason"];
export type ReportStatus = Enums["report_status"];
export type ModerationActionType = Enums["moderation_action_type"];

/** Safe, non-sensitive projection of another member. Never includes date of birth. */
export type PublicProfile = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  country: string | null;
  gender: GenderType | null;
  bio: string | null;
  interests: string[];
  presence: PresenceStatus;
  last_active_at: string;
  age: number | null;
};

/** Client-side matching state machine. */
export type MatchState =
  | "idle"
  | "searching"
  | "match_found"
  | "connecting"
  | "connected"
  | "call_ended"
  | "reconnecting"
  | "failed";

export type LobbySnapshot = {
  onlineCount: number;
  searchingCount: number;
};

export type RecentCall = {
  sessionId: string;
  partner: PublicProfile | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  status: CallStatus;
};

export const GENDER_LABELS: Record<GenderType, string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Harassment",
  sexual_content: "Sexual or inappropriate content",
  nudity: "Nudity",
  spam: "Spam",
  scam: "Scam",
  hate: "Hate or abusive behaviour",
  underage: "Underage user",
  other: "Something else",
};

export const INTEREST_OPTIONS = [
  "Music",
  "Gaming",
  "Travel",
  "Film",
  "Fitness",
  "Food",
  "Art",
  "Tech",
  "Books",
  "Sports",
  "Photography",
  "Languages",
] as const;
