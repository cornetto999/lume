import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Crown,
  Cpu,
  Dumbbell,
  EyeOff,
  Film,
  Flame,
  Gamepad2,
  Globe2,
  Heart,
  Languages,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Music,
  Palette,
  Plane,
  Radio,
  SendHorizontal,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Utensils,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCamera } from "@/contexts/useCamera";
import {
  cancelMatching,
  endCurrentMatch,
  getMatchmakingState,
  startMatching,
} from "@/lib/matchmaking.functions";
import {
  getLobbySnapshot,
  getMyProfile,
  heartbeat,
} from "@/lib/profile.functions";
import {
  getSocialSummary,
  markConnectionMessagesRead,
  markNotificationsRead,
  respondConnection,
  sendConnectionMessage,
} from "@/lib/social.functions";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_MATCH_PREFERENCES,
  LANGUAGE_OPTIONS,
  VIBE_OPTIONS,
  type CountryMatchMode,
  type DirectMessage,
  type Notification,
  type PublicProfile,
  type SocialConnection,
  type SocialSummary,
  type LobbyTrend,
  type VibeOption,
} from "@/types/models";

type LobbyPanel = "messages" | "alerts" | "settings";

type VibeCard = {
  label: string;
  value: VibeOption;
  icon: LucideIcon;
  iconClassName: string;
};

type TopicCard = {
  label: string;
  topic: string;
  icon: LucideIcon;
  iconClassName: string;
  action?: "settings";
};

const HERO_MATCH_IMAGE = "/lume-assets/hero-match.png";
const DEFAULT_TOPIC_SELECTION = ["Music", "Developers"];
const DEFAULT_VISIBLE_TREND_COUNT = 4;
const SOCIAL_SUMMARY_QUERY_KEY = ["social-summary"] as const;
const SOCIAL_MESSAGE_CACHE_LIMIT = 120;
const OPTIMISTIC_MESSAGE_PREFIX = "optimistic-message";
const DEFAULT_VISIBLE_VIBE_COUNT = 2;
const DEFAULT_VISIBLE_TOPIC_COUNT = 6;

const VIBE_CARDS: VibeCard[] = [
  {
    label: "Chill",
    value: "Chill",
    icon: Smile,
    iconClassName: "text-rose-300",
  },
  {
    label: "Make Friends",
    value: "Friendship",
    icon: MessageCircle,
    iconClassName: "text-yellow-300",
  },
  {
    label: "Study",
    value: "Study",
    icon: BookOpen,
    iconClassName: "text-sky-300",
  },
  {
    label: "Game",
    value: "Gaming",
    icon: Gamepad2,
    iconClassName: "text-emerald-300",
  },
  {
    label: "Practice Language",
    value: "Tech",
    icon: Globe2,
    iconClassName: "text-violet-300",
  },
];

const TOPIC_CARDS: TopicCard[] = [
  {
    label: "Music",
    topic: "Music",
    icon: Music,
    iconClassName: "text-rose-300",
  },
  {
    label: "Developers",
    topic: "Developers",
    icon: Code2,
    iconClassName: "text-primary",
  },
  {
    label: "Travel",
    topic: "Travel",
    icon: Plane,
    iconClassName: "text-blue-300",
  },
  {
    label: "Film",
    topic: "Film",
    icon: Film,
    iconClassName: "text-sky-300",
  },
  {
    label: "Fitness",
    topic: "Fitness",
    icon: Dumbbell,
    iconClassName: "text-cyan-300",
  },
  {
    label: "Anime",
    topic: "Anime",
    icon: Sparkles,
    iconClassName: "text-indigo-300",
  },
  {
    label: "Tech",
    topic: "Tech",
    icon: Cpu,
    iconClassName: "text-teal-300",
  },
  {
    label: "Food",
    topic: "Food",
    icon: Utensils,
    iconClassName: "text-amber-300",
  },
  {
    label: "Art",
    topic: "Art",
    icon: Palette,
    iconClassName: "text-orange-300",
  },
  {
    label: "Books",
    topic: "Books",
    icon: BookOpen,
    iconClassName: "text-teal-200",
  },
  {
    label: "Sports",
    topic: "Sports",
    icon: Trophy,
    iconClassName: "text-zinc-200",
  },
  {
    label: "Photography",
    topic: "Photography",
    icon: Camera,
    iconClassName: "text-purple-200",
  },
  {
    label: "Languages",
    topic: "Languages",
    icon: Languages,
    iconClassName: "text-lime-300",
  },
  {
    label: "Gaming",
    topic: "Gaming",
    icon: Gamepad2,
    iconClassName: "text-green-300",
  },
  {
    label: "More",
    topic: "More",
    icon: MoreHorizontal,
    iconClassName: "text-muted-foreground",
    action: "settings",
  },
];

const TRENDING_DOT_CLASSES: Record<string, string> = {
  Gaming: "bg-green-400",
  Music: "bg-orange-400",
  Study: "bg-blue-400",
  Chill: "bg-violet-400",
  Tech: "bg-teal-400",
  Friendship: "bg-rose-400",
};

function getUserInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : words[0]?.slice(0, 2) || "LU";

  return initials.toUpperCase();
}

function getProfileDisplayName(profile: PublicProfile | null | undefined) {
  return profile?.display_name || profile?.username || "Lume friend";
}

function getConnectionOtherUserId(
  connection: Pick<SocialConnection, "requester_id" | "addressee_id">,
  currentUserId: string,
) {
  return connection.requester_id === currentUserId
    ? connection.addressee_id
    : connection.requester_id;
}

function getMessageTime(message: Pick<DirectMessage, "created_at"> | null) {
  return message ? Date.parse(message.created_at) || 0 : 0;
}

function getConnectionActivityTime(connection: SocialConnection) {
  return (
    getMessageTime(connection.lastMessage) ||
    Date.parse(connection.responded_at ?? connection.requested_at) ||
    0
  );
}

function sortSocialConnections(connections: SocialConnection[]) {
  return [...connections].sort(
    (a, b) => getConnectionActivityTime(b) - getConnectionActivityTime(a),
  );
}

function getNewestDirectMessage(
  messages: Array<DirectMessage | null | undefined>,
) {
  return messages.reduce<DirectMessage | null>((newest, message) => {
    if (!message) return newest;
    return getMessageTime(message) > getMessageTime(newest) ? message : newest;
  }, null);
}

function isUnreadForUser(message: DirectMessage | null, currentUserId: string) {
  return (
    !!message && message.recipient_id === currentUserId && !message.read_at
  );
}

function isMatchingOptimisticMessage(
  optimisticMessage: DirectMessage,
  confirmedMessage: DirectMessage,
) {
  if (!optimisticMessage.id.startsWith(OPTIMISTIC_MESSAGE_PREFIX)) {
    return false;
  }

  return (
    optimisticMessage.connection_id === confirmedMessage.connection_id &&
    optimisticMessage.sender_id === confirmedMessage.sender_id &&
    optimisticMessage.recipient_id === confirmedMessage.recipient_id &&
    optimisticMessage.body === confirmedMessage.body &&
    Math.abs(
      getMessageTime(optimisticMessage) - getMessageTime(confirmedMessage),
    ) < 30_000
  );
}

function createOptimisticMessage(
  summary: SocialSummary | undefined,
  connectionId: string,
  currentUserId: string | undefined,
  body: string,
): DirectMessage | null {
  if (!summary || !currentUserId) return null;

  const connection = summary.connections.find(
    (item) => item.id === connectionId,
  );
  if (!connection) return null;

  return {
    id: `${OPTIMISTIC_MESSAGE_PREFIX}-${connectionId}-${Date.now()}`,
    connection_id: connectionId,
    sender_id: currentUserId,
    recipient_id: getConnectionOtherUserId(connection, currentUserId),
    body,
    created_at: new Date().toISOString(),
    read_at: null,
  };
}

function upsertSummaryMessage(
  summary: SocialSummary | undefined,
  message: DirectMessage,
  {
    activeConnectionId,
    currentUserId,
    replaceId,
  }: {
    activeConnectionId: string | null;
    currentUserId: string;
    replaceId?: string | undefined;
  },
): SocialSummary | undefined {
  if (!summary) return summary;

  const existingMessage =
    summary.messages.find((item) => item.id === message.id) ??
    (replaceId
      ? summary.messages.find((item) => item.id === replaceId)
      : undefined);
  const visibleMessage =
    message.connection_id === activeConnectionId &&
    isUnreadForUser(message, currentUserId)
      ? { ...message, read_at: new Date().toISOString() }
      : message;
  const wasUnread = isUnreadForUser(existingMessage ?? null, currentUserId);
  const isUnread = isUnreadForUser(visibleMessage, currentUserId);

  const messages = [
    ...summary.messages.filter((item) => {
      if (item.id === visibleMessage.id) return false;
      if (replaceId && item.id === replaceId) return false;
      return !isMatchingOptimisticMessage(item, visibleMessage);
    }),
    visibleMessage,
  ]
    .sort((a, b) => getMessageTime(a) - getMessageTime(b))
    .slice(-SOCIAL_MESSAGE_CACHE_LIMIT);

  const connections = sortSocialConnections(
    summary.connections.map((connection) => {
      if (connection.id !== visibleMessage.connection_id) return connection;

      const lastMessage = getNewestDirectMessage([
        connection.lastMessage &&
        connection.lastMessage.id !== replaceId &&
        !isMatchingOptimisticMessage(connection.lastMessage, visibleMessage)
          ? connection.lastMessage
          : null,
        ...messages.filter((item) => item.connection_id === connection.id),
      ]);
      const unreadDelta = Number(isUnread) - Number(wasUnread);

      return {
        ...connection,
        lastMessage,
        unreadCount:
          connection.id === activeConnectionId
            ? 0
            : Math.max(0, connection.unreadCount + unreadDelta),
      };
    }),
  );

  return {
    ...summary,
    connections,
    messages,
    unreadMessages: connections.reduce(
      (total, connection) => total + connection.unreadCount,
      0,
    ),
  };
}

function markSummaryConnectionRead(
  summary: SocialSummary | undefined,
  connectionId: string,
  currentUserId: string | undefined,
): SocialSummary | undefined {
  if (!summary || !currentUserId) return summary;

  const readAt = new Date().toISOString();
  const messages = summary.messages.map((message) =>
    message.connection_id === connectionId &&
    message.recipient_id === currentUserId &&
    !message.read_at
      ? { ...message, read_at: readAt }
      : message,
  );
  const connections = summary.connections.map((connection) =>
    connection.id === connectionId
      ? { ...connection, unreadCount: 0 }
      : connection,
  );

  return {
    ...summary,
    connections,
    messages,
    unreadMessages: connections.reduce(
      (total, connection) => total + connection.unreadCount,
      0,
    ),
  };
}

function removeSummaryMessage(
  summary: SocialSummary | undefined,
  message: DirectMessage,
  currentUserId: string,
): SocialSummary | undefined {
  if (!summary) return summary;

  const messages = summary.messages.filter((item) => item.id !== message.id);
  const connections = sortSocialConnections(
    summary.connections.map((connection) => {
      if (connection.id !== message.connection_id) return connection;

      const lastMessage = getNewestDirectMessage(
        messages.filter((item) => item.connection_id === connection.id),
      );

      return {
        ...connection,
        lastMessage:
          connection.lastMessage?.id === message.id
            ? lastMessage
            : connection.lastMessage,
        unreadCount: isUnreadForUser(message, currentUserId)
          ? Math.max(0, connection.unreadCount - 1)
          : connection.unreadCount,
      };
    }),
  );

  return {
    ...summary,
    connections,
    messages,
    unreadMessages: connections.reduce(
      (total, connection) => total + connection.unreadCount,
      0,
    ),
  };
}

export const Route = createFileRoute("/_authenticated/lobby")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Lume Lobby" },
      {
        name: "description",
        content: "Start matching with someone new on Lume.",
      },
    ],
  }),
  component: Lobby,
});

function Lobby() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { localStream, startCamera, stopCamera } = useCamera();
  const [activePanel, setActivePanel] = useState<LobbyPanel | null>(null);
  const [incognitoMode, setIncognitoMode] = useState(false);
  const [liveCaptions, setLiveCaptions] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [highTrustMatching, setHighTrustMatching] = useState(true);
  const [selectedVibe, setSelectedVibe] = useState<VibeOption>(
    DEFAULT_MATCH_PREFERENCES.vibe,
  );
  const [selectedLanguage, setSelectedLanguage] = useState(
    DEFAULT_MATCH_PREFERENCES.language,
  );
  const [countryMode, setCountryMode] =
    useState<CountryMatchMode>("same_country");
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [showAllTrends, setShowAllTrends] = useState(false);
  const [showAllVibes, setShowAllVibes] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [directMessageInput, setDirectMessageInput] = useState("");
  const activePanelRef = useRef<LobbyPanel | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const conversationScrollRef = useRef<HTMLDivElement | null>(null);
  const markConnectionMessagesReadRef = useRef<(connectionId: string) => void>(
    () => undefined,
  );

  const {
    data: profile,
    error: profileError,
    isLoading: profileLoading,
  } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(),
    retry: false,
  });

  const { data: snapshot } = useQuery({
    queryKey: ["lobby-snapshot"],
    queryFn: () => getLobbySnapshot(),
    enabled: !!profile?.profile_completed,
    refetchInterval: 30_000,
  });

  const {
    data: matchState,
    isLoading: matchLoading,
    error: matchError,
  } = useQuery({
    queryKey: ["matchmaking-state"],
    queryFn: () => getMatchmakingState(),
    enabled: !!profile?.profile_completed,
    retry: 1,
    throwOnError: false,
    refetchInterval: (query) =>
      query.state.data?.state === "searching" ? 1_500 : false,
  });
  const status = matchState?.state ?? "idle";

  const { data: socialSummary, isLoading: socialLoading } = useQuery({
    queryKey: SOCIAL_SUMMARY_QUERY_KEY,
    queryFn: () => getSocialSummary(),
    enabled: !!profile?.profile_completed,
    retry: 1,
    throwOnError: false,
    refetchInterval: 15_000,
  });

  const respondConnectionMutation = useMutation({
    mutationFn: ({
      connectionId,
      action,
    }: {
      connectionId: string;
      action: "accept" | "decline";
    }) => respondConnection({ data: { connectionId, action } }),
    onSuccess: (state, variables) => {
      void queryClient.invalidateQueries({
        queryKey: SOCIAL_SUMMARY_QUERY_KEY,
      });
      if (variables.action === "accept" && state.connection) {
        setActiveConversationId(state.connection.id);
        setActivePanel("messages");
        toast.success("Friend confirmed. Messages are unlocked.");
      } else {
        toast.info("Friend request declined.");
      }
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not update the friend request."),
  });

  const sendConnectionMessageMutation = useMutation({
    mutationFn: ({
      connectionId,
      body,
    }: {
      connectionId: string;
      body: string;
    }) => sendConnectionMessage({ data: { connectionId, body } }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: SOCIAL_SUMMARY_QUERY_KEY });
      const optimisticMessage = createOptimisticMessage(
        queryClient.getQueryData<SocialSummary>(SOCIAL_SUMMARY_QUERY_KEY),
        variables.connectionId,
        profile?.id,
        variables.body,
      );

      setDirectMessageInput("");
      if (optimisticMessage && profile?.id) {
        queryClient.setQueryData<SocialSummary>(
          SOCIAL_SUMMARY_QUERY_KEY,
          (current) =>
            upsertSummaryMessage(current, optimisticMessage, {
              activeConnectionId: activeConversationIdRef.current,
              currentUserId: profile.id,
            }),
        );
      }

      return {
        body: variables.body,
        optimisticMessage,
      };
    },
    onSuccess: (message, _variables, context) => {
      if (profile?.id) {
        queryClient.setQueryData<SocialSummary>(
          SOCIAL_SUMMARY_QUERY_KEY,
          (current) =>
            upsertSummaryMessage(current, message, {
              activeConnectionId: activeConversationIdRef.current,
              currentUserId: profile.id,
              replaceId: context?.optimisticMessage?.id,
            }),
        );
      }
      void queryClient.invalidateQueries({
        queryKey: SOCIAL_SUMMARY_QUERY_KEY,
      });
    },
    onError: (error: Error, _variables, context) => {
      if (context?.optimisticMessage && profile?.id) {
        const optimisticMessage = context.optimisticMessage;
        queryClient.setQueryData<SocialSummary>(
          SOCIAL_SUMMARY_QUERY_KEY,
          (current) =>
            removeSummaryMessage(current, optimisticMessage, profile.id),
        );
      }
      setDirectMessageInput((current) => current || context?.body || "");
      toast.error(error.message || "Could not send the message.");
    },
  });

  const markNotificationsMutation = useMutation({
    mutationFn: () => markNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SOCIAL_SUMMARY_QUERY_KEY,
      });
    },
  });

  const markConnectionMessagesReadMutation = useMutation({
    mutationFn: (connectionId: string) =>
      markConnectionMessagesRead({ data: { connectionId } }),
    onMutate: async (connectionId) => {
      await queryClient.cancelQueries({ queryKey: SOCIAL_SUMMARY_QUERY_KEY });
      const previousSummary = queryClient.getQueryData<SocialSummary>(
        SOCIAL_SUMMARY_QUERY_KEY,
      );

      queryClient.setQueryData<SocialSummary>(
        SOCIAL_SUMMARY_QUERY_KEY,
        (current) =>
          markSummaryConnectionRead(current, connectionId, profile?.id),
      );

      return { previousSummary };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: SOCIAL_SUMMARY_QUERY_KEY,
      });
    },
    onError: (_error, _connectionId, context) => {
      if (context?.previousSummary) {
        queryClient.setQueryData(
          SOCIAL_SUMMARY_QUERY_KEY,
          context.previousSummary,
        );
      }
    },
  });

  useEffect(() => {
    markConnectionMessagesReadRef.current =
      markConnectionMessagesReadMutation.mutate;
  }, [markConnectionMessagesReadMutation.mutate]);

  useEffect(() => {
    if (profileLoading) return;

    const knownProfileTopics =
      profile?.interests?.filter((interest) =>
        TOPIC_CARDS.some(
          (card) => card.action !== "settings" && card.topic === interest,
        ),
      ) ?? [];
    const seededTopics = [...knownProfileTopics, ...DEFAULT_TOPIC_SELECTION]
      .filter((topic, index, topics) => topics.indexOf(topic) === index)
      .slice(0, 3);

    setFocusTopics((current) => (current.length ? current : seededTopics));
  }, [profile?.interests, profileLoading]);

  const setMatchState = (state: NonNullable<typeof matchState>) => {
    queryClient.setQueryData(["matchmaking-state"], state);
    void queryClient.invalidateQueries({ queryKey: ["lobby-snapshot"] });
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      await startCamera();
      return startMatching({
        data: {
          vibe: selectedVibe,
          topics: focusTopics,
          language: selectedLanguage,
          countryMode,
        },
      });
    },
    onSuccess: (state) => {
      setMatchState(state);
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Match found. Your room is ready."
          : "Searching for someone live now.",
      );
      navigate({ to: "/call" });
    },
    onError: (error: Error) => {
      stopCamera();
      toast.error(error.message || "Could not start matching.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMatching(),
    onSuccess: (state) => {
      stopCamera();
      setMatchState(state);
      toast.info("Search cancelled.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not cancel search."),
  });

  const endMutation = useMutation({
    mutationFn: () => endCurrentMatch(),
    onSuccess: (state) => {
      stopCamera();
      setMatchState(state);
      toast.info("Match ended.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not end the match."),
  });

  useEffect(() => {
    if (profile === undefined) return;
    if (!profile.profile_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [profile, navigate]);

  useEffect(() => {
    if (!matchError) return;
    const msg =
      matchError instanceof Error
        ? matchError.message
        : "Could not check match status.";
    toast.error(msg);
  }, [matchError]);

  useEffect(() => {
    if (status === "matched") {
      navigate({ to: "/call" });
    }
  }, [status, navigate]);

  useEffect(() => {
    if (!profile?.profile_completed || matchLoading) return;
    if (startMutation.isPending) return;
    if (status === "searching" || status === "matched") return;
    if (localStream) stopCamera();
  }, [
    localStream,
    matchLoading,
    profile?.profile_completed,
    startMutation.isPending,
    status,
    stopCamera,
  ]);

  useEffect(() => {
    if (!profile?.profile_completed) return;
    if (status === "searching" || status === "matched") return;

    const beat = () => {
      void heartbeat({ data: { presence: "online" } });
    };

    beat();
    const interval = window.setInterval(beat, 45_000);
    return () => window.clearInterval(interval);
  }, [profile?.profile_completed, status]);

  useEffect(() => {
    const userId = profile?.id;
    if (!userId || status !== "searching") return;

    const channel = supabase
      .channel(`lobby-queue-watch-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matchmaking_queue",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { status: string };
          if (row.status === "matched") {
            void queryClient.invalidateQueries({
              queryKey: ["matchmaking-state"],
            });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id, queryClient, status]);

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) return;

    const invalidateSocial = () => {
      void queryClient.invalidateQueries({
        queryKey: SOCIAL_SUMMARY_QUERY_KEY,
      });
    };
    const syncDirectMessage = (payload: unknown) => {
      const change = payload as {
        eventType?: string;
        new?: Partial<DirectMessage>;
        old?: Partial<DirectMessage>;
      };
      const activeConnectionId =
        activePanelRef.current === "messages"
          ? activeConversationIdRef.current
          : null;

      if (change.eventType === "DELETE" && change.old?.id) {
        queryClient.setQueryData<SocialSummary>(
          SOCIAL_SUMMARY_QUERY_KEY,
          (current) =>
            removeSummaryMessage(current, change.old as DirectMessage, userId),
        );
        invalidateSocial();
        return;
      }

      if (!change.new?.id) {
        invalidateSocial();
        return;
      }

      const message = change.new as DirectMessage;
      queryClient.setQueryData<SocialSummary>(
        SOCIAL_SUMMARY_QUERY_KEY,
        (current) =>
          upsertSummaryMessage(current, message, {
            activeConnectionId,
            currentUserId: userId,
          }),
      );

      if (
        message.recipient_id === userId &&
        !message.read_at &&
        message.connection_id === activeConnectionId
      ) {
        markConnectionMessagesReadRef.current(message.connection_id);
        return;
      }

      invalidateSocial();
    };
    const channel = supabase
      .channel(`lobby-social-watch-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "connections",
          filter: `requester_id=eq.${userId}`,
        },
        invalidateSocial,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "connections",
          filter: `addressee_id=eq.${userId}`,
        },
        invalidateSocial,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
          filter: `sender_id=eq.${userId}`,
        },
        syncDirectMessage,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "direct_messages",
          filter: `recipient_id=eq.${userId}`,
        },
        syncDirectMessage,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        invalidateSocial,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id, queryClient]);

  const socialConnections = useMemo(
    () => socialSummary?.connections ?? [],
    [socialSummary?.connections],
  );
  const pendingRequests = useMemo(
    () => socialSummary?.pendingRequests ?? [],
    [socialSummary?.pendingRequests],
  );
  const incomingRequests = useMemo(
    () => pendingRequests.filter((request) => request.direction === "incoming"),
    [pendingRequests],
  );
  const outgoingRequests = useMemo(
    () => pendingRequests.filter((request) => request.direction === "outgoing"),
    [pendingRequests],
  );
  const socialNotifications = useMemo(
    () => socialSummary?.notifications ?? [],
    [socialSummary?.notifications],
  );
  const activeConversation = useMemo(
    () =>
      socialConnections.find(
        (connection) => connection.id === activeConversationId,
      ) ??
      socialConnections[0] ??
      null,
    [activeConversationId, socialConnections],
  );
  const conversationMessages = useMemo(
    () =>
      activeConversation
        ? (socialSummary?.messages ?? []).filter(
            (message) => message.connection_id === activeConversation.id,
          )
        : [],
    [activeConversation, socialSummary?.messages],
  );

  useEffect(() => {
    activePanelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id ?? null;
  }, [activeConversation?.id]);

  useEffect(() => {
    if (activePanel !== "messages") return;
    const messageList = conversationScrollRef.current;
    if (!messageList) return;

    window.requestAnimationFrame(() => {
      messageList.scrollTop = messageList.scrollHeight;
    });
  }, [activeConversation?.id, activePanel, conversationMessages.length]);

  const messageBadgeCount = socialSummary?.unreadMessages ?? 0;
  const alertBadgeCount = Math.max(
    socialSummary?.unreadNotifications ?? 0,
    incomingRequests.length,
  );

  useEffect(() => {
    if (activePanel !== "messages") return;
    if (activeConversationId || !socialConnections[0]) return;
    setActiveConversationId(socialConnections[0].id);
  }, [activeConversationId, activePanel, socialConnections]);

  useEffect(() => {
    if (activePanel !== "alerts") return;
    if (!socialSummary?.unreadNotifications) return;
    if (markNotificationsMutation.isPending) return;
    markNotificationsMutation.mutate();
  }, [
    activePanel,
    markNotificationsMutation,
    socialSummary?.unreadNotifications,
  ]);

  useEffect(() => {
    if (activePanel !== "messages") return;
    if (!activeConversation?.id || activeConversation.unreadCount <= 0) return;
    if (markConnectionMessagesReadMutation.isPending) return;
    markConnectionMessagesReadMutation.mutate(activeConversation.id);
  }, [
    activeConversation?.id,
    activeConversation?.unreadCount,
    activePanel,
    markConnectionMessagesReadMutation,
  ]);

  const signOut = async () => {
    await heartbeat({ data: { presence: "offline" } }).catch(() => null);
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  if (profileLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <Loader2 className="size-8 animate-spin text-primary" />
      </main>
    );
  }

  if (profileError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-foreground">
            Could not load the lobby
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account is signed in, but Lume could not read the profile data
            yet.
          </p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const displayName = profile?.display_name || profile?.username || "Friend";
  const avatarSrc = profile?.avatar_url || undefined;
  const avatarInitials = getUserInitials(displayName);
  const onlineCount = snapshot?.onlineCount ?? 0;
  const searchingCount = snapshot?.searchingCount ?? 0;
  const matchingBusy =
    matchLoading ||
    startMutation.isPending ||
    cancelMutation.isPending ||
    endMutation.isPending;
  const partnerName =
    matchState?.state === "matched"
      ? matchState.partner?.display_name ||
        matchState.partner?.username ||
        "Someone new"
      : null;
  const roomCode =
    matchState?.state === "matched"
      ? matchState.session.room_name.replace(/^lume-/, "").slice(0, 8)
      : null;
  const preferencesLocked = status !== "idle" || matchingBusy;
  const countryLabel = formatCountryLabel(profile?.country);
  const activePanelTitle =
    activePanel === "messages"
      ? "Messages"
      : activePanel === "alerts"
        ? "Alerts"
        : "Settings";
  const ActivePanelIcon =
    activePanel === "messages"
      ? MessageCircle
      : activePanel === "alerts"
        ? Bell
        : Settings;
  const selectedTopicCount = focusTopics.length;
  const trendingVibes =
    snapshot?.trendingVibes ??
    VIBE_OPTIONS.map((label) => ({ label, count: 0 }));
  const visibleTrendingVibes = showAllTrends
    ? trendingVibes
    : trendingVibes.slice(0, DEFAULT_VISIBLE_TREND_COUNT);
  const hiddenTrendCount = Math.max(
    0,
    trendingVibes.length - DEFAULT_VISIBLE_TREND_COUNT,
  );
  const visibleVibeCards = showAllVibes
    ? VIBE_CARDS
    : VIBE_CARDS.slice(0, DEFAULT_VISIBLE_VIBE_COUNT);
  const visibleTopicCards = showAllTopics
    ? TOPIC_CARDS
    : TOPIC_CARDS.slice(0, DEFAULT_VISIBLE_TOPIC_COUNT);
  const hiddenVibeCount = Math.max(
    0,
    VIBE_CARDS.length - DEFAULT_VISIBLE_VIBE_COUNT,
  );
  const hiddenTopicCount = Math.max(
    0,
    TOPIC_CARDS.length - DEFAULT_VISIBLE_TOPIC_COUNT,
  );

  const toggleFocusTopic = (topic: string) => {
    if (preferencesLocked) return;

    setFocusTopics((current) =>
      current.includes(topic)
        ? current.filter((item) => item !== topic)
        : current.length >= 5
          ? current
          : [...current, topic],
    );
  };

  const onPrimaryMatchAction = () => {
    if (status === "searching") {
      cancelMutation.mutate();
      return;
    }

    if (status === "matched") {
      endMutation.mutate();
      return;
    }

    startMutation.mutate();
  };

  const primaryActionLabel =
    status === "searching"
      ? "Cancel search"
      : status === "matched"
        ? "End match"
        : "Start matching";

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px)] opacity-20 [background-size:72px_72px]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-4 safe-top safe-bottom sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center">
            <div className="font-display text-3xl font-black leading-none sm:text-4xl">
              Lum<span className="text-primary">e</span>
            </div>
            <Sparkles className="-ml-0.5 mb-5 size-5 text-primary" />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="secondary"
              className="h-8 rounded-lg border border-border bg-surface/80 px-3 text-xs text-primary shadow-sm backdrop-blur hover:bg-surface-raised"
              onClick={() => toast.info("Lume Plus is coming soon.")}
            >
              <Crown className="size-4 fill-primary/25 text-primary" />
              <span className="hidden font-semibold sm:inline">Lume Plus</span>
            </Button>
            <IconHeaderButton
              icon={MessageCircle}
              label="Messages"
              badgeCount={messageBadgeCount}
              onClick={() => setActivePanel("messages")}
            />
            <IconHeaderButton
              icon={Bell}
              label="Alerts"
              badgeCount={alertBadgeCount}
              onClick={() => setActivePanel("alerts")}
            />
            <button
              type="button"
              aria-label={`${displayName} profile settings`}
              className="relative size-9 rounded-full border border-border bg-surface shadow-sm transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setActivePanel("settings")}
            >
              <Avatar className="size-full">
                {avatarSrc && (
                  <AvatarImage
                    src={avatarSrc}
                    alt={`${displayName} profile`}
                    className="object-cover"
                  />
                )}
                <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                  {avatarInitials}
                </AvatarFallback>
              </Avatar>
              <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success" />
            </button>
          </div>
        </header>

        <section className="grid gap-4 py-4 md:grid-cols-[0.88fr_1.12fr] md:items-center lg:py-5">
          <div className="relative">
            <Sparkles className="absolute -left-2 top-2 size-4 rotate-12 text-primary" />
            <h1 className="max-w-lg text-3xl font-black leading-[0.98] sm:text-4xl lg:text-5xl">
              Ready to meet <span className="block text-primary">someone?</span>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Good people. Real conversations.
            </p>
          </div>

          <div className="relative min-h-[170px] overflow-hidden md:min-h-[230px]">
            <div className="absolute inset-x-0 top-0 h-52 rounded-[1.5rem] bg-[radial-gradient(circle,rgba(255,255,255,0.16)_1px,transparent_1px)] opacity-40 [background-size:12px_12px]" />
            <img
              src={HERO_MATCH_IMAGE}
              alt="Two Lume members matched in a video call preview"
              className="relative z-10 mx-auto h-auto w-full max-w-[430px] object-contain"
            />
          </div>
        </section>

        <section className="grid overflow-hidden rounded-xl border border-border bg-surface/70 shadow-lg shadow-black/15 backdrop-blur sm:grid-cols-3">
          <StatMetric
            icon={Radio}
            iconClassName="border-success/30 bg-success/10 text-success"
            value={formatCount(onlineCount)}
            label="online now"
            labelClassName="text-success"
          />
          <StatMetric
            icon={SlidersHorizontal}
            iconClassName="border-primary/30 bg-primary/10 text-primary"
            value={formatCount(searchingCount)}
            label="matching now"
            labelClassName="text-primary"
            divider
          />
          <StatMetric
            icon={Users}
            iconClassName="border-violet-400/30 bg-violet-400/10 text-violet-300"
            value="58,931"
            label="joined Lume today"
            labelClassName="text-violet-300"
            divider
          />
        </section>

        <section className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/55 p-1.5 backdrop-blur">
          <div className="flex h-8 items-center gap-2 rounded-full px-2 text-xs font-semibold">
            <Flame className="size-4 fill-primary text-primary" />
            TRENDING NOW
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            {visibleTrendingVibes.map((trend) => (
              <button
                key={trend.label}
                type="button"
                className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-secondary/70 px-3 text-xs text-foreground transition hover:border-primary/60 hover:bg-primary/10"
                onClick={() => {
                  if (preferencesLocked) return;
                  const matching = VIBE_CARDS.find(
                    (card) =>
                      card.label === trend.label || card.value === trend.label,
                  );
                  if (matching) setSelectedVibe(matching.value);
                }}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    getTrendDotClassName(trend),
                  )}
                />
                <span>{trend.label}</span>
                <span className="text-muted-foreground">
                  {formatCount(trend.count)}
                </span>
              </button>
            ))}
          </div>
          {hiddenTrendCount > 0 && (
            <button
              type="button"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
              onClick={() => setShowAllTrends((value) => !value)}
            >
              {showAllTrends ? "Show less" : "See all"}
              {showAllTrends ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ArrowRight className="size-3.5" />
              )}
            </button>
          )}
        </section>

        <section className="mt-3 rounded-xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <PanelHeading
              icon={Heart}
              iconClassName="text-rose-300"
              title="I'm here to"
              subtitle="Choose your vibe"
            />
            <SectionToggleButton
              expanded={showAllVibes}
              hiddenCount={hiddenVibeCount}
              onClick={() => setShowAllVibes((value) => !value)}
            />
          </div>
          <div
            className={cn(
              "mt-4 grid gap-3 sm:grid-cols-2",
              showAllVibes && "lg:grid-cols-5",
            )}
          >
            {visibleVibeCards.map((card) => (
              <LargeOptionButton
                key={card.label}
                icon={card.icon}
                iconClassName={card.iconClassName}
                label={card.label}
                selected={selectedVibe === card.value}
                disabled={preferencesLocked}
                onClick={() => setSelectedVibe(card.value)}
              />
            ))}
          </div>
        </section>

        <section className="mt-3 rounded-xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <PanelHeading
              icon={MessageCircle}
              iconClassName="text-pink-300"
              title="I like talking about"
              subtitle={`Pick topics you enjoy (choose up to 5)${
                selectedTopicCount ? ` | ${selectedTopicCount} selected` : ""
              }`}
            />
            <SectionToggleButton
              expanded={showAllTopics}
              hiddenCount={hiddenTopicCount}
              onClick={() => setShowAllTopics((value) => !value)}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {visibleTopicCards.map((card) => {
              const selected = focusTopics.includes(card.topic);
              const handleClick = () => {
                if (card.action === "settings") {
                  setActivePanel("settings");
                  return;
                }
                toggleFocusTopic(card.topic);
              };

              return (
                <TopicButton
                  key={card.topic}
                  icon={card.icon}
                  iconClassName={card.iconClassName}
                  label={card.label}
                  selected={selected}
                  disabled={preferencesLocked && card.action !== "settings"}
                  onClick={handleClick}
                />
              );
            })}
          </div>
        </section>

        <section className="mt-3 grid gap-3 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
            <PanelHeading
              icon={Globe2}
              iconClassName="text-violet-300"
              title="Language"
              subtitle="Choose the language you prefer"
            />
            <Select
              value={selectedLanguage}
              onValueChange={setSelectedLanguage}
              disabled={preferencesLocked}
            >
              <SelectTrigger className="mt-3 h-10 rounded-lg border-border bg-secondary/70 px-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
            <PanelHeading
              icon={MapPin}
              iconClassName="text-violet-300"
              title="Country"
              subtitle="Where do you want to meet people from?"
            />
            <div className="mt-3 grid overflow-hidden rounded-xl border border-border bg-secondary/70 p-1 sm:grid-cols-2">
              <SegmentButton
                selected={countryMode === "global"}
                disabled={preferencesLocked}
                onClick={() => setCountryMode("global")}
              >
                Global
              </SegmentButton>
              <SegmentButton
                selected={countryMode === "same_country"}
                disabled={preferencesLocked}
                onClick={() => setCountryMode("same_country")}
              >
                {countryLabel}
              </SegmentButton>
            </div>
          </div>
        </section>

        {status === "searching" && (
          <StatusNotice
            icon={Loader2}
            iconClassName="animate-spin text-primary"
            title="Looking for a live match"
            detail="Keep this page open while Lume checks the queue."
          />
        )}

        {status === "matched" && (
          <StatusNotice
            icon={CheckCircle2}
            iconClassName="text-success"
            title="Match found"
            detail={`You matched with ${partnerName}. Room ${roomCode}.`}
          />
        )}

        <Button
          size="lg"
          variant={status === "searching" ? "secondary" : "default"}
          disabled={matchingBusy}
          className={cn(
            "ember-lift mt-4 h-11 w-full rounded-full text-sm font-bold sm:h-12 sm:text-base",
            status !== "searching" &&
              "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          onClick={onPrimaryMatchAction}
        >
          {matchingBusy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : status === "searching" ? (
            <X className="size-5" />
          ) : status === "matched" ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <Video className="size-5" />
          )}
          {primaryActionLabel}
        </Button>

        <footer className="flex flex-wrap items-center justify-center gap-2 py-4 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-4" />
          <span>We keep Lume safe and friendly for everyone.</span>
          <button
            type="button"
            className="font-semibold text-primary transition hover:text-primary/80"
            onClick={() => setActivePanel("alerts")}
          >
            Learn more
          </button>
        </footer>

        <Dialog
          open={activePanel !== null}
          onOpenChange={(open) => {
            if (!open) setActivePanel(null);
          }}
        >
          <DialogContent
            className={cn(
              "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border-border bg-surface p-4 md:p-6",
              activePanel === "messages" ? "max-w-3xl" : "max-w-md",
            )}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ActivePanelIcon className="size-5 text-primary" />
                {activePanelTitle}
              </DialogTitle>
              <DialogDescription>
                {activePanel === "messages"
                  ? "Your saved Lume connections appear here."
                  : activePanel === "alerts"
                    ? "Recent account and safety updates."
                    : "Quick controls for your next match."}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 overflow-y-auto pr-1">
              {activePanel === "messages" && (
                <div className="grid min-h-[26rem] gap-3 md:grid-cols-[0.86fr_1.14fr]">
                  <div className="space-y-2 overflow-y-auto pr-1 md:max-h-[28rem]">
                    {socialLoading ? (
                      <div className="flex h-full min-h-48 items-center justify-center">
                        <Loader2 className="size-6 animate-spin text-primary" />
                      </div>
                    ) : socialConnections.length === 0 ? (
                      <EmptySocialCard
                        icon={UserPlus}
                        title="No friends yet"
                        body="Add someone during a call. Once both people confirm, messages open here."
                        action={
                          <Button
                            className="h-10 rounded-xl"
                            onClick={() => {
                              setActivePanel(null);
                              if (status === "idle") startMutation.mutate();
                            }}
                            disabled={matchingBusy || status !== "idle"}
                          >
                            <Video className="size-4" />
                            Start matching
                          </Button>
                        }
                      />
                    ) : (
                      socialConnections.map((connection) => (
                        <ConnectionListButton
                          key={connection.id}
                          connection={connection}
                          selected={activeConversation?.id === connection.id}
                          onClick={() => setActiveConversationId(connection.id)}
                        />
                      ))
                    )}
                  </div>

                  <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-border bg-background">
                    {activeConversation ? (
                      <>
                        <div className="flex items-center gap-3 border-b border-border bg-muted/30 p-3">
                          <SocialProfileAvatar
                            profile={activeConversation.otherUser}
                            className="size-10"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">
                              {getProfileDisplayName(
                                activeConversation.otherUser,
                              )}
                            </p>
                            <p className="text-xs text-success">
                              Connected friend
                            </p>
                          </div>
                        </div>
                        <div
                          ref={conversationScrollRef}
                          className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
                        >
                          {conversationMessages.length === 0 ? (
                            <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">
                              No messages yet. Say hi now that you both
                              confirmed.
                            </p>
                          ) : (
                            conversationMessages.map((message) => {
                              const isMe = message.sender_id === profile?.id;
                              return (
                                <div
                                  key={message.id}
                                  className={cn(
                                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                                    isMe
                                      ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                                      : "self-start rounded-bl-sm bg-secondary text-secondary-foreground",
                                  )}
                                >
                                  {message.body}
                                </div>
                              );
                            })
                          )}
                        </div>
                        <form
                          className="flex gap-2 border-t border-border bg-muted/20 p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const body = directMessageInput.trim();
                            if (!body || !activeConversation) return;
                            sendConnectionMessageMutation.mutate({
                              connectionId: activeConversation.id,
                              body,
                            });
                          }}
                        >
                          <input
                            type="text"
                            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                            placeholder="Message your friend..."
                            value={directMessageInput}
                            onChange={(event) =>
                              setDirectMessageInput(event.target.value)
                            }
                          />
                          <Button
                            type="submit"
                            size="icon"
                            className="size-10 shrink-0 rounded-xl"
                            disabled={
                              sendConnectionMessageMutation.isPending ||
                              !directMessageInput.trim()
                            }
                          >
                            {sendConnectionMessageMutation.isPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <SendHorizontal className="size-4" />
                            )}
                          </Button>
                        </form>
                      </>
                    ) : (
                      <EmptySocialCard
                        icon={MessageSquare}
                        title="Choose a friend"
                        body="Confirmed friends appear here after a mutual request."
                      />
                    )}
                  </div>
                </div>
              )}

              {activePanel === "alerts" && (
                <div className="space-y-3">
                  {incomingRequests.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Friend requests
                      </p>
                      {incomingRequests.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-xl border border-primary/30 bg-primary/10 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <SocialProfileAvatar
                              profile={request.otherUser}
                              className="size-10"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-foreground">
                                {getProfileDisplayName(request.otherUser)}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Wants to add you from a call.
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button
                              className="h-9 flex-1 rounded-lg"
                              disabled={respondConnectionMutation.isPending}
                              onClick={() =>
                                respondConnectionMutation.mutate({
                                  connectionId: request.id,
                                  action: "accept",
                                })
                              }
                            >
                              <UserCheck className="size-4" />
                              Confirm
                            </Button>
                            <Button
                              variant="secondary"
                              className="h-9 flex-1 rounded-lg"
                              disabled={respondConnectionMutation.isPending}
                              onClick={() =>
                                respondConnectionMutation.mutate({
                                  connectionId: request.id,
                                  action: "decline",
                                })
                              }
                            >
                              <X className="size-4" />
                              Decline
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {outgoingRequests.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Waiting
                      </p>
                      {outgoingRequests.map((request) => (
                        <div
                          key={request.id}
                          className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                        >
                          <SocialProfileAvatar
                            profile={request.otherUser}
                            className="size-10"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">
                              {getProfileDisplayName(request.otherUser)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Request sent. Waiting for confirmation.
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
                    <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
                    <div>
                      <p className="font-medium text-foreground">
                        Lume Shield active
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Report and block controls are ready in every call.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 rounded-xl border border-border bg-background p-4">
                    <Radio className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">
                        {formatCount(onlineCount)} online now
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatCount(searchingCount)} looking for a match.
                      </p>
                    </div>
                  </div>
                  {socialNotifications.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Recent
                      </p>
                      {socialNotifications.map((notification) => (
                        <NotificationCard
                          key={notification.id}
                          notification={notification}
                          onOpenConnection={(connectionId) => {
                            const connection = socialConnections.find(
                              (item) => item.id === connectionId,
                            );
                            if (!connection) return;
                            setActiveConversationId(connection.id);
                            setActivePanel("messages");
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptySocialCard
                      icon={Bell}
                      title="No alerts"
                      body="Friend requests, accepted requests and new messages appear here."
                    />
                  )}
                </div>
              )}

              {activePanel === "settings" && (
                <div className="space-y-3 md:space-y-4">
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                    <Avatar className="size-12 border border-border">
                      {avatarSrc && (
                        <AvatarImage
                          src={avatarSrc}
                          alt={`${displayName} profile`}
                          className="object-cover"
                        />
                      )}
                      <AvatarFallback className="bg-primary/15 text-sm font-bold text-primary">
                        {avatarInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {displayName}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {profile?.username
                          ? `@${profile.username}`
                          : "Lume member"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2.5 md:gap-3">
                    <SettingSwitch
                      icon={<EyeOff className="size-4 text-primary" />}
                      label="Incognito mode"
                      checked={incognitoMode}
                      onCheckedChange={setIncognitoMode}
                    />
                    <SettingSwitch
                      icon={<Check className="size-4 text-primary" />}
                      label="High trust matching"
                      checked={highTrustMatching}
                      onCheckedChange={setHighTrustMatching}
                    />
                    <SettingSwitch
                      icon={<Languages className="size-4 text-primary" />}
                      label="Auto translation"
                      checked={autoTranslate}
                      onCheckedChange={setAutoTranslate}
                    />
                    <SettingSwitch
                      icon={<MessageCircle className="size-4 text-primary" />}
                      label="Live captions"
                      checked={liveCaptions}
                      onCheckedChange={setLiveCaptions}
                    />
                  </div>

                  <div className="grid gap-3 rounded-xl border border-border bg-background p-3 md:p-4">
                    <Label htmlFor="settings-language">
                      Preferred language
                    </Label>
                    <Select
                      value={selectedLanguage}
                      onValueChange={setSelectedLanguage}
                      disabled={preferencesLocked}
                    >
                      <SelectTrigger
                        id="settings-language"
                        className="h-11 rounded-xl"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_OPTIONS.map((language) => (
                          <SelectItem
                            key={language.value}
                            value={language.value}
                          >
                            {language.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    variant="secondary"
                    className="h-11 w-full rounded-xl"
                    onClick={signOut}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

function IconHeaderButton({
  icon: Icon,
  label,
  badgeCount = 0,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  badgeCount?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-surface/80 text-foreground shadow-sm backdrop-blur transition hover:border-primary/60 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span className="sr-only">{label}</span>
      {badgeCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground ring-2 ring-background">
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      )}
    </button>
  );
}

function SocialProfileAvatar({
  profile,
  className,
}: {
  profile: PublicProfile | null;
  className?: string;
}) {
  const name = getProfileDisplayName(profile);

  return (
    <Avatar className={cn("size-10 border border-border", className)}>
      {profile?.avatar_url && (
        <AvatarImage
          src={profile.avatar_url}
          alt={`${name} profile`}
          className="object-cover"
        />
      )}
      <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
        {getUserInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function EmptySocialCard({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-background p-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15">
        <Icon className="size-5 text-primary" />
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      </div>
      {action}
    </div>
  );
}

function ConnectionListButton({
  connection,
  selected,
  onClick,
}: {
  connection: SocialConnection;
  selected: boolean;
  onClick: () => void;
}) {
  const name = getProfileDisplayName(connection.otherUser);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-primary/60",
      )}
      onClick={onClick}
    >
      <SocialProfileAvatar profile={connection.otherUser} className="size-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-foreground">{name}</p>
          {connection.unreadCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground">
              {connection.unreadCount > 9 ? "9+" : connection.unreadCount}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {connection.lastMessage?.body || "Ready to message"}
        </p>
      </div>
    </button>
  );
}

function NotificationCard({
  notification,
  onOpenConnection,
}: {
  notification: Notification;
  onOpenConnection: (connectionId: string) => void;
}) {
  const connectionId = getNotificationConnectionId(notification);

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          {notification.type === "direct_message" ? (
            <MessageSquare className="size-4 text-primary" />
          ) : notification.type === "connection_accepted" ? (
            <UserCheck className="size-4 text-success" />
          ) : (
            <Bell className="size-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-foreground">{notification.title}</p>
            {!notification.read_at && (
              <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
            )}
          </div>
          {notification.body && (
            <p className="mt-1 text-sm text-muted-foreground">
              {notification.body}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {formatSocialTime(notification.created_at)}
            </p>
            {connectionId && (
              <Button
                variant="secondary"
                className="h-8 rounded-lg px-3 text-xs"
                onClick={() => onOpenConnection(connectionId)}
              >
                Open
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatMetric({
  icon: Icon,
  iconClassName,
  value,
  label,
  labelClassName,
  divider,
}: {
  icon: LucideIcon;
  iconClassName: string;
  value: string;
  label: string;
  labelClassName: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        divider && "border-t border-border sm:border-l sm:border-t-0",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border",
          iconClassName,
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-black leading-none">{value}</p>
        <p className={cn("mt-0.5 text-xs font-medium", labelClassName)}>
          {label}
        </p>
      </div>
    </div>
  );
}

function SectionToggleButton({
  expanded,
  hiddenCount,
  onClick,
}: {
  expanded: boolean;
  hiddenCount: number;
  onClick: () => void;
}) {
  if (hiddenCount <= 0) return null;

  const Icon = expanded ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      {expanded ? "Show less" : "See all"}
      {!expanded && (
        <span className="rounded-full bg-primary/15 px-1.5 text-[11px] leading-5 text-primary">
          {hiddenCount}
        </span>
      )}
      <Icon className="size-3.5" />
    </button>
  );
}

function PanelHeading({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: ReactNode;
  subtitle: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/70">
        <Icon className={cn("size-5", iconClassName)} />
      </div>
      <div className="min-w-0">
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function LargeOptionButton({
  icon: Icon,
  iconClassName,
  label,
  selected,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-secondary/55 px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/15 text-foreground shadow-[0_0_24px_-16px_var(--primary)]"
          : "border-border text-foreground hover:border-primary/60 hover:bg-primary/10",
      )}
      onClick={onClick}
    >
      <Icon className={cn("size-4 shrink-0", iconClassName)} />
      <span>{label}</span>
    </button>
  );
}

function TopicButton({
  icon: Icon,
  iconClassName,
  label,
  selected,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "relative flex h-10 min-w-0 items-center gap-2.5 rounded-lg border bg-secondary/55 px-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border text-foreground hover:border-primary/60 hover:bg-primary/10",
      )}
      onClick={onClick}
    >
      <Icon className={cn("size-4 shrink-0", iconClassName)} />
      <span className="min-w-0 truncate">{label}</span>
      {selected && (
        <span className="ml-auto flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      )}
    </button>
  );
}

function SegmentButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        "min-h-8 rounded-lg px-2 py-1 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border border-primary bg-primary/15 text-foreground shadow-[0_0_16px_-12px_var(--primary)]"
          : "border border-transparent text-foreground hover:border-primary/50 hover:bg-primary/10",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusNotice({
  icon: Icon,
  iconClassName,
  title,
  detail,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  detail: string;
}) {
  return (
    <section className="mt-3 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
        <Icon className={cn("size-4", iconClassName)} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </section>
  );
}

function SettingSwitch({
  icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-3">
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          {icon}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {label}
        </span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getNotificationConnectionId(notification: Notification) {
  const data = notification.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return typeof data["connectionId"] === "string" ? data["connectionId"] : null;
}

function formatSocialTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getTrendDotClassName(trend: LobbyTrend) {
  return TRENDING_DOT_CLASSES[trend.label] ?? "bg-muted-foreground";
}

function formatCountryLabel(country: string | null | undefined) {
  const normalized = country?.trim().toLowerCase();
  if (!normalized || normalized === "pinas" || normalized.includes("phil")) {
    return "Philippines";
  }
  return country?.trim() || "Philippines";
}
