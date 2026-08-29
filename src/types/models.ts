import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type Profile = Tables["profiles"]["Row"];
export type ProfileUpdate = Tables["profiles"]["Update"];
export type UserRole = Tables["user_roles"]["Row"];
export type MatchmakingQueueEntry = Tables["matchmaking_queue"]["Row"];
export type MatchCooldown = Tables["match_cooldowns"]["Row"];
export type CallSession = Tables["call_sessions"]["Row"];
export type Connection = Tables["connections"]["Row"];
export type DirectMessage = Tables["direct_messages"]["Row"];
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

export const FAST_MATCH_AFTER_MS = 1_200;

export type LobbyTrend = {
  label: string;
  count: number;
};

export type LobbySnapshot = {
  onlineCount: number;
  searchingCount: number;
  trendingVibes: LobbyTrend[];
};

export type ConnectionStatus =
  "pending" | "accepted" | "declined" | "cancelled";

export type ConnectionRequestState =
  "none" | "pending_outgoing" | "pending_incoming" | "accepted";

export type SocialConnection = {
  id: string;
  requester_id: string;
  addressee_id: string;
  session_id: string | null;
  status: ConnectionStatus;
  direction: "incoming" | "outgoing" | "accepted";
  requested_at: string;
  responded_at: string | null;
  otherUser: PublicProfile | null;
  lastMessage: DirectMessage | null;
  unreadCount: number;
};

export type SocialSummary = {
  connections: SocialConnection[];
  pendingRequests: SocialConnection[];
  messages: DirectMessage[];
  notifications: Notification[];
  unreadMessages: number;
  unreadNotifications: number;
};

export type CallConnectionState = {
  state: ConnectionRequestState;
  connection: SocialConnection | null;
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
  "Study",
  "Chill",
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
  "Anime",
  "Developers",
  "Friendship",
] as const;

export const VIBE_OPTIONS = [
  "Gaming",
  "Music",
  "Study",
  "Chill",
  "Tech",
  "Friendship",
] as const;

export type VibeOption = (typeof VIBE_OPTIONS)[number];

export const LANGUAGE_OPTIONS = [
  { value: "Any", label: "Any language" },
  { value: "English", label: "English" },
  { value: "Filipino", label: "Filipino" },
  { value: "Cebuano", label: "Cebuano" },
  { value: "Spanish", label: "Spanish" },
  { value: "Japanese", label: "Japanese" },
  { value: "Korean", label: "Korean" },
  { value: "Mandarin", label: "Mandarin" },
  { value: "Hindi", label: "Hindi" },
  { value: "Arabic", label: "Arabic" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
] as const;

export const COUNTRY_MATCH_MODES = ["global", "same_country"] as const;

export type CountryMatchMode = (typeof COUNTRY_MATCH_MODES)[number];

export type MatchPreferences = {
  vibe: VibeOption;
  topics: string[];
  language: string;
  countryMode: CountryMatchMode;
};

export const DEFAULT_MATCH_PREFERENCES: MatchPreferences = {
  vibe: "Chill",
  topics: [],
  language: "Any",
  countryMode: "global",
};
