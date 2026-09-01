import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Camera,
  CameraOff,
  Check,
  CircleStop,
  Clock3,
  Loader2,
  LogOut,
  Maximize2,
  MessageCircle,
  MessageCircleQuestion,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipForward,
  Sparkles,
  StepForward,
  UserRound,
  UserCheck,
  UserPlus,
  Video,
  PictureInPicture2,
  X,
  SendHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCamera } from "@/contexts/useCamera";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/profile.functions";
import {
  cancelMatching,
  endCurrentMatch,
  findNextMatch,
  getMatchmakingState,
  startMatching,
  type MatchmakingState,
} from "@/lib/matchmaking.functions";
import { fileSafetyReport } from "@/lib/safety.functions";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MATCH_PREFERENCES,
  FAST_MATCH_AFTER_MS,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/types/models";
import {
  getCallConnectionState,
  requestConnection,
  respondConnection,
} from "@/lib/social.functions";

type CameraState = "off" | "starting" | "ready" | "blocked" | "unsupported";
type RtcStatus =
  "idle" | "waiting" | "connecting" | "live" | "disconnected" | "failed";

type RtcSignalPayload = {
  sessionId: string;
  from: string;
  to: string;
  type:
    | "ready"
    | "offer"
    | "answer"
    | "candidate"
    | "leave"
    | "intro_continue"
    | "chat";
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  message?: string;
};

const SIGNAL_EVENT = "webrtc_signal";
const INTRO_SECONDS = 30;
const SEARCH_REFETCH_INTERVAL_MS = 500;
const ICEBREAKER_CARDS = [
  "What's your dream destination?",
  "Coffee or milk tea?",
  "What song has been stuck in your head lately?",
  "Would you rather time travel or teleport?",
  "What's one tiny thing that made your week better?",
  "What's your go-to comfort game, show or playlist?",
] as const;
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const DEFAULT_SELF_CAMERA_MOBILE_HEIGHT = 220;
const DEFAULT_SELF_CAMERA_DESKTOP_HEIGHT = 560;
const DEFAULT_SELF_CAMERA_DESKTOP_WIDTH = 520;

function isSignalPayload(value: unknown): value is RtcSignalPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<RtcSignalPayload>;
  return (
    typeof payload.sessionId === "string" &&
    typeof payload.from === "string" &&
    typeof payload.to === "string" &&
    [
      "ready",
      "offer",
      "answer",
      "candidate",
      "leave",
      "intro_continue",
      "chat",
    ].includes(payload.type ?? "")
  );
}

export const Route = createFileRoute("/_authenticated/call")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Lume Call" },
      {
        name: "description",
        content: "Join your Lume video match.",
      },
    ],
  }),
  component: CallRoom,
});

function CallRoom() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatMessageCountRef = useRef(0);
  const autoFindAfterSkipRef = useRef(false);
  const autoFindAttemptedRef = useRef(false);
  const leavingRoomRef = useRef(false);
  const { localStream, cameraError, isReady, startCamera, stopCamera } =
    useCamera();
  const cameraSupported =
    typeof navigator === "undefined" || !!navigator.mediaDevices?.getUserMedia;

  const [mediaRequested, setMediaRequested] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [introAccepted, setIntroAccepted] = useState(false);
  const [introSecondsLeft, setIntroSecondsLeft] = useState(INTRO_SECONDS);
  const [icebreakerIndex, setIcebreakerIndex] = useState(0);
  const [shieldOpen, setShieldOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("harassment");
  const [reportDetails, setReportDetails] = useState("");
  const [blockAfterReport, setBlockAfterReport] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [sizeControlsOpen, setSizeControlsOpen] = useState(false);
  const [cameraSizeMode, setCameraSizeMode] = useState<"equal" | "custom">(
    "equal",
  );
  const [selfCameraMobileHeight, setSelfCameraMobileHeight] = useState(
    DEFAULT_SELF_CAMERA_MOBILE_HEIGHT,
  );
  const [selfCameraDesktopHeight, setSelfCameraDesktopHeight] = useState(
    DEFAULT_SELF_CAMERA_DESKTOP_HEIGHT,
  );
  const [selfCameraDesktopWidth, setSelfCameraDesktopWidth] = useState(
    DEFAULT_SELF_CAMERA_DESKTOP_WIDTH,
  );

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(),
    retry: 1,
    throwOnError: false,
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
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      // Realtime handles instant match detection — polling is a safety net only
      if (s === "searching") return SEARCH_REFETCH_INTERVAL_MS;
      if (s === "matched") return 1_500;
      return false;
    },
  });

  const status = matchState?.state ?? "idle";
  const activeSession =
    matchState?.state === "matched" ? matchState.session : null;
  const cameraState: CameraState = !cameraSupported
    ? "unsupported"
    : isReady
      ? cameraError
        ? "blocked"
        : "ready"
      : mediaRequested
        ? "starting"
        : "off";
  const partnerId =
    activeSession && profile?.id
      ? activeSession.user_a === profile.id
        ? activeSession.user_b
        : activeSession.user_a
      : null;
  const callConnectionQueryKey = [
    "call-connection-state",
    activeSession?.id,
    partnerId,
  ];
  const isOfferer = !!activeSession && activeSession.user_a === profile?.id;
  const searchJoinedAt =
    matchState?.state === "searching"
      ? Date.parse(matchState.queue.joined_at)
      : NaN;
  const searchExpanded =
    Number.isFinite(searchJoinedAt) &&
    Date.now() - searchJoinedAt >= FAST_MATCH_AFTER_MS;
  const searchWaitingForMember =
    Number.isFinite(searchJoinedAt) && Date.now() - searchJoinedAt >= 6_000;
  const partnerName =
    matchState?.state === "matched"
      ? matchState.partner?.display_name ||
        matchState.partner?.username ||
        "Your match"
      : searchWaitingForMember
        ? "No new member yet"
        : searchExpanded
          ? "Expanding search"
          : "Finding match";
  const roomName = activeSession
    ? activeSession.room_name.replace(/^lume-/, "").slice(0, 8)
    : null;
  const {
    status: rtcStatus,
    error: rtcError,
    hasRemoteVideo,
    partnerIntroReady,
    chatMessages,
    sendChatMessage,
    sendIntroContinue,
  } = useCallConnection({
    sessionId: activeSession?.id ?? null,
    currentUserId: profile?.id ?? null,
    currentUsername:
      profile?.username || profile?.display_name || profile?.id || "member",
    partnerId,
    isOfferer,
    localStream: localStream,
    mediaReady: cameraState !== "starting" && cameraState !== "off",
    remoteVideoRef,
  });

  const { data: callConnection, isLoading: connectionLoading } = useQuery({
    queryKey: callConnectionQueryKey,
    queryFn: () => {
      if (!activeSession?.id || !partnerId) {
        throw new Error("No active call connection.");
      }

      return getCallConnectionState({
        data: { sessionId: activeSession.id, partnerId },
      });
    },
    enabled: status === "matched" && !!activeSession?.id && !!partnerId,
    retry: 1,
    throwOnError: false,
    refetchInterval: status === "matched" ? 1_500 : false,
  });
  const roomMatchPreferences = () => ({
    ...DEFAULT_MATCH_PREFERENCES,
    topics: profile?.interests?.slice(0, 3) ?? [],
  });

  const setMatchState = (state: MatchmakingState) => {
    queryClient.setQueryData(["matchmaking-state"], state);
    void queryClient.invalidateQueries({ queryKey: ["lobby-snapshot"] });
  };

  const keepFindingAfterSkip = () => {
    autoFindAfterSkipRef.current = true;
    autoFindAttemptedRef.current = false;
    leavingRoomRef.current = false;
  };

  const stopFindingAfterSkip = () => {
    autoFindAfterSkipRef.current = false;
    autoFindAttemptedRef.current = false;
    leavingRoomRef.current = true;
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      leavingRoomRef.current = false;
      setMediaRequested(true);
      await startCamera();
      setCameraOn(true);
      setMicOn(true);
      return startMatching({ data: roomMatchPreferences() });
    },
    onSuccess: (state) => {
      setMatchState(state);
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Match found. Your room is ready."
          : "Searching for someone live now.",
      );
    },
    onError: (error: Error) => {
      autoFindAfterSkipRef.current = false;
      autoFindAttemptedRef.current = false;
      setMediaRequested(false);
      stopCamera();
      toast.error(error.message || "Could not start matching.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      stopFindingAfterSkip();
      return cancelMatching();
    },
    onSuccess: (state) => {
      setMediaRequested(false);
      stopCamera();
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) => {
      leavingRoomRef.current = false;
      toast.error(error.message || "Could not leave search.");
    },
  });

  const endMutation = useMutation({
    mutationFn: () => {
      stopFindingAfterSkip();
      return endCurrentMatch();
    },
    onSuccess: (state) => {
      setMediaRequested(false);
      stopCamera();
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) => {
      leavingRoomRef.current = false;
      toast.error(error.message || "Could not end the match.");
    },
  });

  const nextMutation = useMutation({
    mutationFn: async () => {
      keepFindingAfterSkip();
      setMediaRequested(true);
      await startCamera();
      setCameraOn(true);
      setMicOn(true);
      return findNextMatch({ data: roomMatchPreferences() });
    },
    onSuccess: (state) => {
      setMatchState(state);
      if (state.state !== "idle") {
        autoFindAttemptedRef.current = false;
      }
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Next match found."
          : "Looking for your next match.",
      );
    },
    onError: (error: Error) => {
      autoFindAfterSkipRef.current = false;
      autoFindAttemptedRef.current = false;
      setMediaRequested(false);
      stopCamera();
      toast.error(error.message || "Could not find the next match.");
    },
  });

  const safetyMutation = useMutation({
    mutationFn: () => {
      if (!activeSession?.id || !partnerId) {
        throw new Error("There is no active match to report.");
      }

      return fileSafetyReport({
        data: {
          sessionId: activeSession.id,
          reportedId: partnerId,
          reason: reportReason,
          details: reportDetails,
          block: blockAfterReport,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(
        result.blocked
          ? "Report sent and this person is blocked."
          : "Report sent to Lume Shield.",
      );
      setShieldOpen(false);
      setReportDetails("");
      setBlockAfterReport(false);
      void queryClient.invalidateQueries({ queryKey: ["matchmaking-state"] });

      if (result.blocked) {
        stopFindingAfterSkip();
        setMediaRequested(false);
        stopCamera();
        navigate({ to: "/lobby", replace: true });
      }
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not send the report."),
  });

  const requestConnectionMutation = useMutation({
    mutationFn: () => {
      if (!activeSession?.id || !partnerId) {
        throw new Error("There is no active match to add.");
      }

      return requestConnection({
        data: { sessionId: activeSession.id, partnerId },
      });
    },
    onSuccess: (state) => {
      queryClient.setQueryData(callConnectionQueryKey, state);
      void queryClient.invalidateQueries({ queryKey: ["social-summary"] });
      toast[state.state === "accepted" ? "success" : "info"](
        state.state === "accepted"
          ? "Friend added. You can message after the call."
          : "Friend request sent. Waiting for confirmation.",
      );
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not send the friend request."),
  });

  const respondConnectionMutation = useMutation({
    mutationFn: () => {
      const connectionId = callConnection?.connection?.id;
      if (!connectionId) throw new Error("No friend request to confirm.");

      return respondConnection({
        data: { connectionId, action: "accept" },
      });
    },
    onSuccess: (state) => {
      queryClient.setQueryData(callConnectionQueryKey, state);
      void queryClient.invalidateQueries({ queryKey: ["social-summary"] });
      toast.success("Friend added. Messages are unlocked.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not confirm the friend request."),
  });

  useEffect(() => {
    if (profile === undefined) return;
    if (!profile.profile_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [profile, navigate]);

  // Show a recoverable toast when the matchmaking poll errors (e.g. expired
  // session, transient server error) instead of crashing the whole page.
  useEffect(() => {
    if (!matchError) return;
    const msg =
      matchError instanceof Error
        ? matchError.message
        : "Could not check match status.";
    toast.error(msg);
  }, [matchError]);

  useEffect(() => {
    setIntroAccepted(false);
    setIntroSecondsLeft(INTRO_SECONDS);
    setIcebreakerIndex(0);
    setShieldOpen(false);
    setReportDetails("");
    setBlockAfterReport(false);
    setChatOpen(false);
    setChatInput("");
    setChatUnreadCount(0);
    chatMessageCountRef.current = 0;
  }, [activeSession?.id]);

  useEffect(() => {
    const previousCount = chatMessageCountRef.current;

    if (chatMessages.length < previousCount) {
      chatMessageCountRef.current = chatMessages.length;
      return;
    }

    if (!chatOpen && profile?.id && chatMessages.length > previousCount) {
      const unreadMessages = chatMessages
        .slice(previousCount)
        .filter((message) => message.senderId !== profile.id).length;

      if (unreadMessages > 0) {
        setChatUnreadCount((count) => Math.min(99, count + unreadMessages));
      }
    }

    chatMessageCountRef.current = chatMessages.length;
  }, [chatMessages, chatOpen, profile?.id]);

  useEffect(() => {
    if (chatOpen) setChatUnreadCount(0);
  }, [chatOpen]);

  useEffect(() => {
    if (status === "searching" || status === "matched") {
      autoFindAttemptedRef.current = false;
    }
  }, [status]);

  // Realtime keeps the call room in sync when a match is found, skipped, or
  // ended by the other participant.
  useEffect(() => {
    if (!profile?.id) return;

    type QueueWatchRow = {
      status?: string;
      session_id?: string | null;
    };
    type SessionWatchRow = {
      status?: string;
      end_reason?: string | null;
    };

    const invalidateMatchmakingState = () => {
      void queryClient.invalidateQueries({
        queryKey: ["matchmaking-state"],
      });
    };

    const channel = supabase.channel(`queue-watch-${profile.id}`).on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "matchmaking_queue",
        filter: `user_id=eq.${profile.id}`,
      },
      (payload) => {
        const row = payload.new as QueueWatchRow;
        const previousRow = payload.old as QueueWatchRow | null;
        const stateChanged =
          row.status !== previousRow?.status ||
          row.session_id !== previousRow?.session_id;

        if (stateChanged) {
          invalidateMatchmakingState();
        }
      },
    );

    if (activeSession?.id) {
      channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_sessions",
          filter: `id=eq.${activeSession.id}`,
        },
        (payload) => {
          const row = payload.new as SessionWatchRow;

          if (row.status === "ended" && row.end_reason === "skipped") {
            autoFindAfterSkipRef.current = true;
            autoFindAttemptedRef.current = false;
            leavingRoomRef.current = false;
          }

          if (row.status === "ended" || row.status === "failed") {
            invalidateMatchmakingState();
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeSession?.id, profile?.id, queryClient]);

  useEffect(() => {
    if (!profile?.profile_completed || status !== "idle") return;
    if (!autoFindAfterSkipRef.current || autoFindAttemptedRef.current) return;
    if (leavingRoomRef.current) return;
    if (
      matchLoading ||
      startMutation.isPending ||
      nextMutation.isPending ||
      cancelMutation.isPending ||
      endMutation.isPending ||
      safetyMutation.isPending
    ) {
      return;
    }

    autoFindAttemptedRef.current = true;
    nextMutation.mutate();
  }, [
    cancelMutation.isPending,
    endMutation.isPending,
    matchLoading,
    nextMutation,
    nextMutation.isPending,
    profile?.profile_completed,
    safetyMutation.isPending,
    startMutation.isPending,
    status,
  ]);

  const introComplete =
    status === "matched" && introAccepted && partnerIntroReady;
  const introActive = status === "matched" && !introComplete;
  const introExpired = introActive && introSecondsLeft === 0;
  const currentIcebreaker =
    ICEBREAKER_CARDS[icebreakerIndex % ICEBREAKER_CARDS.length];
  const canUseShield = status === "matched" && !!activeSession && !!partnerId;
  const canSendChat = status === "matched";
  const connectionState = callConnection?.state ?? "none";
  const friendActionBusy =
    requestConnectionMutation.isPending || respondConnectionMutation.isPending;
  const chatMessageCount = chatMessages.length;
  const chatBadgeCount = chatUnreadCount || chatMessageCount;
  const chatButtonLabel =
    chatUnreadCount > 0
      ? `Live Chat, ${chatUnreadCount} unread`
      : chatMessageCount > 0
        ? `Live Chat, ${chatMessageCount} messages`
        : "Live Chat";
  const friendActionLabel =
    connectionLoading && !callConnection
      ? "Add friend"
      : connectionState === "accepted"
        ? "Friends"
        : connectionState === "pending_incoming"
          ? "Confirm"
          : connectionState === "pending_outgoing"
            ? "Requested"
            : "Add friend";
  const canUseFriendAction =
    status === "matched" &&
    !!activeSession?.id &&
    !!partnerId &&
    !friendActionBusy &&
    (connectionState === "none" || connectionState === "pending_incoming");

  const useFriendAction = () => {
    if (connectionState === "pending_incoming") {
      respondConnectionMutation.mutate();
      return;
    }

    requestConnectionMutation.mutate();
  };

  useEffect(() => {
    if (!introActive || introSecondsLeft <= 0) return;

    const timer = window.setTimeout(() => {
      setIntroSecondsLeft((seconds) => Math.max(0, seconds - 1));
    }, 1_000);

    return () => window.clearTimeout(timer);
  }, [introActive, introSecondsLeft]);

  useEffect(() => {
    if (status === "searching" || status === "matched") return;
    if (mediaRequested && (startMutation.isPending || nextMutation.isPending)) {
      return;
    }

    setMediaRequested(false);
    if (localStream) {
      stopCamera();
    }
  }, [
    localStream,
    mediaRequested,
    nextMutation.isPending,
    startMutation.isPending,
    status,
    stopCamera,
  ]);

  useEffect(() => {
    if (!localStream) return;
    if (!cameraOn) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    if (!micOn) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    }
  }, [cameraOn, localStream, micOn]);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => (t.enabled = !cameraOn));
      setCameraOn(!cameraOn);
    }
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (remoteVideoRef.current && document.pictureInPictureEnabled) {
        await remoteVideoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      toast.error("Picture-in-Picture is not supported or was blocked.");
    }
  };

  const toggleMic = () => {
    const tracks = localStream?.getAudioTracks() ?? [];
    const next = !micOn;
    tracks.forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
  };

  const continueIntro = () => {
    setIntroAccepted(true);
    void sendIntroContinue().catch(() => {
      toast.error("Could not send your intro response.");
    });
  };

  const leave = () => {
    if (matchState?.state === "matched") {
      endMutation.mutate();
      return;
    }

    if (matchState?.state === "searching") {
      cancelMutation.mutate();
      return;
    }

    setMediaRequested(false);
    stopCamera();
    navigate({ to: "/lobby", replace: true });
  };

  const startFromRoom = () => {
    startMutation.mutate();
  };

  const resetCameraSize = () => {
    setCameraSizeMode("equal");
    setSelfCameraMobileHeight(DEFAULT_SELF_CAMERA_MOBILE_HEIGHT);
    setSelfCameraDesktopHeight(DEFAULT_SELF_CAMERA_DESKTOP_HEIGHT);
    setSelfCameraDesktopWidth(DEFAULT_SELF_CAMERA_DESKTOP_WIDTH);
  };

  const matchStatusText =
    status === "matched"
      ? rtcStatus === "live"
        ? "Video connected"
        : rtcStatus === "failed"
          ? "Video could not connect"
          : rtcStatus === "disconnected"
            ? "The video connection ended"
            : `Waiting for ${partnerName} to open the room`
      : status === "searching"
        ? searchWaitingForMember
          ? "Auto retrying for the next active member"
          : searchExpanded
            ? "Checking all active members"
            : "Checking active members"
        : "Ready when you are";
  const busy =
    profileLoading ||
    matchLoading ||
    startMutation.isPending ||
    cancelMutation.isPending ||
    endMutation.isPending ||
    nextMutation.isPending ||
    requestConnectionMutation.isPending ||
    respondConnectionMutation.isPending ||
    safetyMutation.isPending;
  const cameraLayoutStyle = {
    "--self-camera-mobile-height": `${selfCameraMobileHeight}px`,
    "--self-camera-desktop-height": `${selfCameraDesktopHeight}px`,
    "--self-camera-desktop-width": `${selfCameraDesktopWidth}px`,
  } as CSSProperties;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 safe-top safe-bottom sm:px-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Lume room</p>
            <h1 className="text-2xl font-bold text-foreground">
              {status === "matched" ? "Live match" : "Camera check"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {status === "matched" && (
              <div className="hidden h-10 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-sm font-medium text-success sm:flex">
                <ShieldCheck className="size-4" />
                Shield on
              </div>
            )}
            <Button
              variant="secondary"
              className="h-11 rounded-xl"
              disabled={busy}
              onClick={leave}
            >
              <LogOut className="size-4" />
              Leave
            </Button>
          </div>
        </header>

        <section
          className={cn(
            "grid flex-1 grid-cols-1 gap-4",
            cameraSizeMode === "custom"
              ? "md:flex md:items-stretch"
              : "md:grid-cols-2",
          )}
          style={cameraLayoutStyle}
        >
          <div
            className={cn(
              "relative order-2 h-[var(--self-camera-mobile-height)] min-h-[160px] overflow-hidden rounded-2xl border border-border bg-surface md:order-1 md:min-h-[320px]",
              cameraSizeMode === "custom"
                ? "md:h-[var(--self-camera-desktop-height)] md:w-[var(--self-camera-desktop-width)] md:min-w-[320px] md:max-w-[60%] md:shrink-0"
                : "md:h-auto",
            )}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            {cameraState !== "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15">
                  {cameraState === "starting" ? (
                    <Loader2 className="size-5 animate-spin text-primary" />
                  ) : (
                    <CameraOff className="size-5 text-primary" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {cameraState === "unsupported"
                      ? "Camera unavailable"
                      : cameraState === "blocked"
                        ? "Camera permission needed"
                        : cameraState === "off"
                          ? "Camera and mic are off"
                          : "Starting camera"}
                  </p>
                  {cameraError && (
                    <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
                      {cameraError}
                    </p>
                  )}
                </div>
              </div>
            )}
            {cameraState === "ready" && !cameraOn && (
              <div className="absolute inset-0 flex items-center justify-center bg-background">
                <CameraOff className="size-12 text-muted-foreground" />
              </div>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-background/80 px-3 py-1 text-sm font-medium text-foreground backdrop-blur">
              You
            </div>
          </div>

          <div
            className={cn(
              "relative order-1 min-h-[360px] overflow-hidden rounded-2xl border border-border bg-surface md:order-2 md:min-h-[320px]",
              cameraSizeMode === "custom" && "md:min-w-[260px] md:flex-1",
            )}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {!hasRemoteVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15">
                  {status === "matched" ? (
                    rtcStatus === "failed" || rtcStatus === "disconnected" ? (
                      <CameraOff className="size-5 text-primary" />
                    ) : (
                      <UserRound className="size-5 text-primary" />
                    )
                  ) : status === "searching" ? (
                    <Loader2 className="size-5 animate-spin text-primary" />
                  ) : (
                    <Search className="size-5 text-primary" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {partnerName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {status === "matched" && roomName
                      ? `Room ${roomName}`
                      : matchStatusText}
                  </p>
                  {status === "matched" && (
                    <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                      {matchStatusText}
                    </p>
                  )}
                  {rtcError && (
                    <p className="mt-2 max-w-xs text-xs text-destructive">
                      {rtcError}
                    </p>
                  )}
                </div>
                {status === "idle" && (
                  <Button
                    className="mt-2 h-11 rounded-xl"
                    disabled={busy}
                    onClick={startFromRoom}
                  >
                    <Video className="size-4" />
                    Start matching
                  </Button>
                )}
              </div>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 select-none text-sm font-semibold text-muted-foreground/30"
            >
              lume
            </div>
            <div className="absolute left-4 top-4 rounded-full bg-background/80 px-3 py-1 text-sm font-medium text-foreground backdrop-blur">
              Match
            </div>
            {status === "matched" && (
              <div
                className={`absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                  rtcStatus === "live"
                    ? "bg-success/15 text-success"
                    : "bg-background/80 text-muted-foreground"
                }`}
              >
                {rtcStatus === "live" ? (
                  <Radio className="size-3.5" />
                ) : (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {rtcStatus === "live" ? "Live" : "Connecting"}
              </div>
            )}
          </div>
        </section>

        {status === "matched" && (
          <section className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Clock3 className="size-4 text-primary" />
                    {introComplete
                      ? "Intro continued"
                      : introExpired
                        ? "Intro ended"
                        : `${introSecondsLeft}s intro`}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {introComplete
                      ? "You both chose to keep chatting."
                      : "Both people tap Continue to keep the room going."}
                  </p>
                </div>
                {introComplete ? (
                  <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-success/25 bg-success/15 px-4 text-sm font-semibold text-success">
                    <Check className="size-4" />
                    Continued
                  </div>
                ) : (
                  <Button
                    className="h-10 rounded-xl"
                    disabled={introAccepted}
                    onClick={continueIntro}
                  >
                    {introAccepted ? (
                      <Clock3 className="size-4" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    {introAccepted ? "Waiting" : "Continue"}
                  </Button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">You</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {introAccepted ? (
                      <Check className="size-4 text-success" />
                    ) : (
                      <Clock3 className="size-4 text-muted-foreground" />
                    )}
                    {introAccepted ? "Continuing" : "Deciding"}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Match</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {partnerIntroReady ? (
                      <Check className="size-4 text-success" />
                    ) : (
                      <Clock3 className="size-4 text-muted-foreground" />
                    )}
                    {partnerIntroReady ? "Continuing" : "Deciding"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <MessageCircleQuestion className="size-4 text-primary" />
                    Icebreaker
                  </div>
                  <p className="mt-2 text-lg font-semibold leading-snug text-foreground">
                    {currentIcebreaker}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-10 shrink-0 rounded-xl"
                  onClick={() => setIcebreakerIndex((index) => index + 1)}
                >
                  <RotateCcw className="size-4" />
                  <span className="sr-only">Next icebreaker</span>
                </Button>
              </div>
            </div>
          </section>
        )}

        {status === "matched" && connectionState === "pending_incoming" && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                <UserPlus className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Friend request from {partnerName}
                </p>
                <p className="text-sm text-muted-foreground">
                  Confirm to save this person and message later.
                </p>
              </div>
            </div>
            <Button
              className="h-10 rounded-xl"
              disabled={!canUseFriendAction}
              onClick={useFriendAction}
            >
              {respondConnectionMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserCheck className="size-4" />
              )}
              Confirm
            </Button>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant={sizeControlsOpen ? "default" : "secondary"}
            className="h-12 rounded-full px-4"
            onClick={() => {
              setSizeControlsOpen((open) => !open);
              if (!sizeControlsOpen) {
                setChatOpen(false);
              }
            }}
          >
            <Maximize2 className="size-5" />
            <span className="hidden sm:inline">Size</span>
            <span className="sr-only sm:hidden">Camera size</span>
          </Button>
          <Button
            size="icon"
            variant={chatOpen ? "default" : "secondary"}
            className="relative size-12 rounded-full"
            aria-label={chatButtonLabel}
            onClick={() => {
              setChatOpen((open) => !open);
              setSizeControlsOpen(false);
            }}
          >
            <MessageCircle className="size-5" />
            <span
              className={cn(
                "absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[11px] font-bold leading-4",
                chatUnreadCount > 0
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {chatBadgeCount > 99 ? "99+" : chatBadgeCount}
            </span>
            <span className="sr-only">Live Chat</span>
          </Button>
          {status === "matched" && (
            <Button
              variant={connectionState === "accepted" ? "default" : "secondary"}
              className="h-12 rounded-full px-4"
              disabled={!canUseFriendAction}
              onClick={useFriendAction}
            >
              {friendActionBusy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : connectionState === "accepted" ? (
                <UserCheck className="size-5" />
              ) : connectionState === "pending_incoming" ? (
                <Check className="size-5" />
              ) : (
                <UserPlus className="size-5" />
              )}
              <span className="hidden sm:inline">{friendActionLabel}</span>
              <span className="sr-only sm:hidden">{friendActionLabel}</span>
            </Button>
          )}
          {status === "matched" && (
            <Button
              variant="secondary"
              className="h-12 rounded-full px-4"
              disabled={busy || !canUseShield}
              onClick={() => setShieldOpen(true)}
            >
              <ShieldCheck className="size-5" />
              <span className="hidden sm:inline">Shield</span>
              <span className="sr-only sm:hidden">Open Lume Shield</span>
            </Button>
          )}
          <Button
            size="icon"
            variant={micOn ? "secondary" : "destructive"}
            className="size-12 rounded-full"
            disabled={cameraState !== "ready"}
            onClick={toggleMic}
          >
            {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            <span className="sr-only">{micOn ? "Mute" : "Unmute"}</span>
          </Button>
          <Button
            size="icon"
            variant={cameraOn ? "secondary" : "destructive"}
            className="size-12 rounded-full"
            disabled={cameraState !== "ready"}
            onClick={toggleCamera}
          >
            {cameraOn ? (
              <Camera className="size-5" />
            ) : (
              <CameraOff className="size-5" />
            )}
            <span className="sr-only">
              {cameraOn ? "Turn camera off" : "Turn camera on"}
            </span>
          </Button>
          {status === "matched" && (
            <Button
              size="icon"
              variant="secondary"
              className="size-12 rounded-full"
              onClick={togglePiP}
            >
              <PictureInPicture2 className="size-5" />
              <span className="sr-only">Picture in Picture</span>
            </Button>
          )}
          {cameraState === "blocked" && (
            <Button
              size="icon"
              variant="secondary"
              className="size-12 rounded-full"
              onClick={() => window.location.reload()}
            >
              <RotateCcw className="size-5" />
              <span className="sr-only">Retry camera</span>
            </Button>
          )}
          <Button
            variant="secondary"
            className="h-12 rounded-full px-4"
            disabled={busy}
            onClick={() => nextMutation.mutate()}
          >
            {nextMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : status === "matched" ? (
              <SkipForward className="size-5" />
            ) : (
              <StepForward className="size-5" />
            )}
            <span className="hidden sm:inline">Next / Skip</span>
            <span className="sr-only sm:hidden">Next / Skip match</span>
          </Button>
          <Button
            variant="destructive"
            className="h-12 rounded-full px-4"
            disabled={busy}
            onClick={leave}
          >
            <CircleStop className="size-5" />
            <span className="hidden sm:inline">Stop</span>
            <span className="sr-only sm:hidden">Stop matching</span>
          </Button>
        </footer>

        {sizeControlsOpen && (
          <section className="fixed bottom-24 left-1/2 z-40 w-[min(calc(100vw-2rem),36rem)] -translate-x-1/2 rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur sm:bottom-28">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Maximize2 className="size-4 text-primary" />
                You camera size
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={resetCameraSize}
                >
                  <RotateCcw className="size-3.5" />
                  Reset
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-lg"
                  onClick={() => setSizeControlsOpen(false)}
                >
                  <X className="size-4" />
                  <span className="sr-only">Close camera size</span>
                </Button>
              </div>
            </div>

            <div className="mt-4 md:hidden">
              <CameraSizeSlider
                id="self-camera-mobile-height"
                label="Height"
                value={selfCameraMobileHeight}
                min={160}
                max={340}
                step={20}
                onChange={(value) => {
                  setSelfCameraMobileHeight(value);
                  setCameraSizeMode("custom");
                }}
              />
            </div>

            <div className="mt-4 hidden gap-4 md:grid md:grid-cols-2">
              <CameraSizeSlider
                id="self-camera-desktop-width"
                label="Width"
                value={selfCameraDesktopWidth}
                min={320}
                max={680}
                step={20}
                onChange={(value) => {
                  setSelfCameraDesktopWidth(value);
                  setCameraSizeMode("custom");
                }}
              />
              <CameraSizeSlider
                id="self-camera-desktop-height"
                label="Height"
                value={selfCameraDesktopHeight}
                min={320}
                max={720}
                step={20}
                onChange={(value) => {
                  setSelfCameraDesktopHeight(value);
                  setCameraSizeMode("custom");
                }}
              />
            </div>
          </section>
        )}

        <Dialog open={shieldOpen} onOpenChange={setShieldOpen}>
          <DialogContent className="max-w-md rounded-2xl border-border bg-surface">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                Lume Shield
              </DialogTitle>
              <DialogDescription>
                Send this session to moderation. Blocking also prevents future
                matches with this person.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="report-reason">Reason</Label>
                <Select
                  value={reportReason}
                  onValueChange={(value) =>
                    setReportReason(value as ReportReason)
                  }
                >
                  <SelectTrigger id="report-reason" className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map(
                      (reason) => (
                        <SelectItem key={reason} value={reason}>
                          {REPORT_REASON_LABELS[reason]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="report-details">Details</Label>
                <Textarea
                  id="report-details"
                  value={reportDetails}
                  onChange={(event) =>
                    setReportDetails(event.target.value.slice(0, 1000))
                  }
                  placeholder="Add context for the safety team"
                  className="min-h-24 rounded-xl"
                />
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                <Checkbox
                  checked={blockAfterReport}
                  onCheckedChange={(checked) =>
                    setBlockAfterReport(checked === true)
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Ban className="size-4 text-destructive" />
                    Block this person
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    End this room and keep them out of future matches.
                  </span>
                </span>
              </label>

              {blockAfterReport && (
                <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  This will close the current match after the report is sent.
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="secondary"
                disabled={safetyMutation.isPending}
                onClick={() => setShieldOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={safetyMutation.isPending || !canUseShield}
                onClick={() => safetyMutation.mutate()}
              >
                {safetyMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Send report
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {chatOpen && (
          <div className="fixed bottom-24 right-4 z-50 flex h-[420px] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl backdrop-blur sm:right-8 sm:bottom-28">
            <div className="flex items-center justify-between border-b border-border bg-muted/30 p-3">
              <h3 className="font-semibold text-foreground">Chat</h3>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => setChatOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              {chatMessages.length === 0 ? (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {canSendChat
                    ? "No messages yet. Send a message to start!"
                    : "Find a match to start live chat."}
                </p>
              ) : (
                chatMessages.map((msg, i) => {
                  const isMe = msg.senderId === profile?.id;
                  return (
                    <div
                      key={i}
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                        isMe
                          ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                          : "self-start rounded-bl-sm bg-secondary text-secondary-foreground",
                      )}
                    >
                      {msg.text}
                    </div>
                  );
                })
              )}
            </div>
            <form
              className="flex gap-2 border-t border-border bg-muted/20 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!canSendChat || !chatInput.trim()) return;
                sendChatMessage(chatInput.trim());
                setChatInput("");
              }}
            >
              <input
                type="text"
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder={
                  canSendChat ? "Type a message..." : "Chat opens after a match"
                }
                disabled={!canSendChat}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!canSendChat || !chatInput.trim()}
                className="size-10 shrink-0 rounded-xl"
              >
                <SendHorizontal className="size-4" />
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

function CameraSizeSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label id={`${id}-label`} className="text-sm text-foreground">
          {label}
        </Label>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {value}px
        </span>
      </div>
      <Slider
        aria-labelledby={`${id}-label`}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([nextValue]) => {
          if (typeof nextValue === "number") {
            onChange(nextValue);
          }
        }}
      />
    </div>
  );
}

function useCallConnection({
  sessionId,
  currentUserId,
  currentUsername,
  partnerId,
  isOfferer,
  localStream,
  mediaReady,
  remoteVideoRef,
}: {
  sessionId: string | null;
  currentUserId: string | null;
  currentUsername: string;
  partnerId: string | null;
  isOfferer: boolean;
  localStream: MediaStream | null;
  mediaReady: boolean;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [status, setStatus] = useState<RtcStatus>("idle");
  const [error, setError] = useState("");
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [partnerIntroReady, setPartnerIntroReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ senderId: string; text: string; timestamp: number }>
  >([]);
  const sendIntroContinueRef = useRef<(() => Promise<void>) | null>(null);
  const sendChatRef = useRef<((text: string) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!sessionId || !currentUserId || !partnerId) {
      setStatus("idle");
      setError("");
      setHasRemoteVideo(false);
      setPartnerIntroReady(false);
      setChatMessages([]);
      sendIntroContinueRef.current = null;
      sendChatRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      return;
    }

    if (!mediaReady) {
      setStatus("waiting");
      return;
    }

    if (typeof RTCPeerConnection === "undefined") {
      setStatus("failed");
      setError("Video calls are not supported in this browser.");
      return;
    }

    let disposed = false;
    let offerStarted = false;
    const queuedCandidates: RTCIceCandidateInit[] = [];
    const remoteStream = new MediaStream();
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const remoteVideo = remoteVideoRef.current;
    const channel = supabase.channel(`lume-call-${sessionId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: currentUserId },
      },
    });

    setStatus("waiting");
    setError("");
    setHasRemoteVideo(false);
    setPartnerIntroReady(false);
    if (remoteVideo) remoteVideo.srcObject = remoteStream;

    const sendSignal = async (
      payload: Omit<RtcSignalPayload, "sessionId" | "from" | "to">,
    ) => {
      if (disposed) return;
      await channel.send({
        type: "broadcast",
        event: SIGNAL_EVENT,
        payload: {
          ...payload,
          sessionId,
          from: currentUserId,
          to: partnerId,
        } satisfies RtcSignalPayload,
      });
    };
    sendIntroContinueRef.current = () => sendSignal({ type: "intro_continue" });
    sendChatRef.current = async (text: string) => {
      await sendSignal({ type: "chat", message: text });
      setChatMessages((prev) => [
        ...prev,
        { senderId: currentUserId, text, timestamp: Date.now() },
      ]);
    };

    const flushQueuedCandidates = async () => {
      while (queuedCandidates.length > 0 && peer.remoteDescription) {
        const candidate = queuedCandidates.shift();
        if (candidate) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    };

    const createOffer = async () => {
      if (disposed || !isOfferer || offerStarted) return;
      if (peer.signalingState !== "stable") return;

      offerStarted = true;
      setStatus("connecting");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendSignal({ type: "offer", description: offer });
    };

    try {
      if (localStream?.getTracks().length) {
        localStream.getTracks().forEach((track) => {
          const sender = peer.addTrack(track, localStream);
          if (track.kind === "video") {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            const [encoding] = params.encodings;
            if (encoding) encoding.maxBitrate = 8000_000;
            sender.setParameters(params).catch(() => null);
          }
        });
      } else {
        peer.addTransceiver("video", { direction: "recvonly" });
        peer.addTransceiver("audio", { direction: "recvonly" });
      }
    } catch (setupError) {
      setStatus("failed");
      setError(
        setupError instanceof Error
          ? setupError.message
          : "Could not prepare your camera for the call.",
      );
      return () => {
        peer.close();
        void supabase.removeChannel(channel);
      };
    }

    peer.ontrack = (event) => {
      if (disposed) return;
      if (
        !remoteStream.getTracks().some((track) => track.id === event.track.id)
      ) {
        remoteStream.addTrack(event.track);
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play().catch(() => null);
      }
      setHasRemoteVideo(remoteStream.getVideoTracks().length > 0);
      setStatus("live");
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal({
          type: "candidate",
          candidate: event.candidate.toJSON(),
        }).catch(() => null);
      }
    };

    peer.onconnectionstatechange = () => {
      if (disposed) return;
      if (peer.connectionState === "connected") {
        setStatus("live");
        return;
      }
      if (peer.connectionState === "connecting") {
        setStatus("connecting");
        return;
      }
      if (peer.connectionState === "failed") {
        setStatus("failed");
        setError("The video connection failed. Leave and match again.");
        return;
      }
      if (
        peer.connectionState === "disconnected" ||
        peer.connectionState === "closed"
      ) {
        setStatus("disconnected");
      }
    };

    peer.oniceconnectionstatechange = () => {
      if (disposed) return;
      if (peer.iceConnectionState === "checking") {
        setStatus("connecting");
      }
      if (peer.iceConnectionState === "failed") {
        setStatus("failed");
        setError("The video connection failed. Leave and match again.");
      }
    };

    channel
      .on("broadcast", { event: SIGNAL_EVENT }, async ({ payload }) => {
        if (!isSignalPayload(payload)) return;
        if (
          payload.sessionId !== sessionId ||
          payload.from !== partnerId ||
          payload.to !== currentUserId
        ) {
          return;
        }

        try {
          if (payload.type === "leave") {
            setStatus("disconnected");
            return;
          }

          if (payload.type === "chat" && payload.message) {
            setChatMessages((prev) => [
              ...prev,
              {
                senderId: payload.from,
                text: payload.message!,
                timestamp: Date.now(),
              },
            ]);
            return;
          }

          if (payload.type === "intro_continue") {
            setPartnerIntroReady(true);
            return;
          }

          if (payload.type === "ready") {
            await createOffer();
            return;
          }

          setStatus((current) => (current === "live" ? current : "connecting"));

          if (payload.type === "offer" && payload.description) {
            if (isOfferer && peer.signalingState !== "stable") return;

            await peer.setRemoteDescription(
              new RTCSessionDescription(payload.description),
            );
            await flushQueuedCandidates();
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await sendSignal({ type: "answer", description: answer });
            return;
          }

          if (payload.type === "answer" && payload.description) {
            if (peer.signalingState !== "have-local-offer") return;

            await peer.setRemoteDescription(
              new RTCSessionDescription(payload.description),
            );
            await flushQueuedCandidates();
            return;
          }

          if (payload.type === "candidate" && payload.candidate) {
            if (peer.remoteDescription) {
              await peer.addIceCandidate(
                new RTCIceCandidate(payload.candidate),
              );
            } else {
              queuedCandidates.push(payload.candidate);
            }
          }
        } catch (signalError) {
          setStatus("failed");
          setError(
            signalError instanceof Error
              ? signalError.message
              : "Could not connect the video call.",
          );
        }
      })
      .on("presence", { event: "sync" }, () => {
        const presence = channel.presenceState();
        const partnerPresent = Object.prototype.hasOwnProperty.call(
          presence,
          partnerId,
        );

        if (!partnerPresent) {
          setStatus((current) => (current === "live" ? current : "waiting"));
          return;
        }

        setStatus((current) => (current === "live" ? current : "connecting"));
        if (isOfferer) {
          void createOffer().catch((offerError) => {
            setStatus("failed");
            setError(
              offerError instanceof Error
                ? offerError.message
                : "Could not start the video call.",
            );
          });
        }
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        if (key === partnerId) {
          setStatus("disconnected");
          setHasRemoteVideo(false);
        }
      })
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          void channel
            .track({ user_id: currentUserId, username: currentUsername })
            .then(() => sendSignal({ type: "ready" }))
            .catch(() => null);
        }
        if (
          subscriptionStatus === "CHANNEL_ERROR" ||
          subscriptionStatus === "TIMED_OUT"
        ) {
          setStatus("failed");
          setError("Could not open the call signaling channel.");
        }
      });

    return () => {
      void channel
        .send({
          type: "broadcast",
          event: SIGNAL_EVENT,
          payload: {
            sessionId,
            from: currentUserId,
            to: partnerId,
            type: "leave",
          } satisfies RtcSignalPayload,
        })
        .catch(() => null);
      disposed = true;
      peer.close();
      setHasRemoteVideo(false);
      setPartnerIntroReady(false);
      sendIntroContinueRef.current = null;
      if (remoteVideo) remoteVideo.srcObject = null;
      void supabase.removeChannel(channel);
    };
  }, [
    currentUserId,
    currentUsername,
    isOfferer,
    localStream,
    mediaReady,
    partnerId,
    remoteVideoRef,
    sessionId,
  ]);

  return {
    status,
    error,
    hasRemoteVideo,
    partnerIntroReady,
    chatMessages,
    sendChatMessage: (text: string) =>
      sendChatRef.current?.(text) ?? Promise.resolve(),
    sendIntroContinue: () =>
      sendIntroContinueRef.current?.() ?? Promise.resolve(),
  };
}
