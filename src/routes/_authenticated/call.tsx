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
  getMatchmakingState,
  startMatching,
  type MatchmakingState,
} from "@/lib/matchmaking.functions";
import { fileSafetyReport } from "@/lib/safety.functions";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MATCH_PREFERENCES,
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/types/models";

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
      if (s === "searching" || s === "matched") return 1_500;
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
  const isOfferer = !!activeSession && activeSession.user_a === profile?.id;
  const partnerName =
    matchState?.state === "matched"
      ? matchState.partner?.display_name ||
        matchState.partner?.username ||
        "Your match"
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
  const roomMatchPreferences = () => ({
    ...DEFAULT_MATCH_PREFERENCES,
    topics: profile?.interests?.slice(0, 3) ?? [],
  });

  const setMatchState = (state: MatchmakingState) => {
    queryClient.setQueryData(["matchmaking-state"], state);
    void queryClient.invalidateQueries({ queryKey: ["lobby-snapshot"] });
  };

  const startMutation = useMutation({
    mutationFn: async () => {
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
      setMediaRequested(false);
      stopCamera();
      toast.error(error.message || "Could not start matching.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMatching(),
    onSuccess: (state) => {
      setMediaRequested(false);
      stopCamera();
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not leave search."),
  });

  const endMutation = useMutation({
    mutationFn: () => endCurrentMatch(),
    onSuccess: (state) => {
      setMediaRequested(false);
      stopCamera();
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not end the match."),
  });

  const nextMutation = useMutation({
    mutationFn: async () => {
      if (matchState?.state === "matched") {
        await endCurrentMatch();
      }
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
          ? "Next match found."
          : "Looking for your next match.",
      );
    },
    onError: (error: Error) => {
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
        setMediaRequested(false);
        stopCamera();
        navigate({ to: "/lobby", replace: true });
      }
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not send the report."),
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
  }, [activeSession?.id]);

  // Realtime: instantly detect when our queue entry is marked 'matched'.
  // The matchmaking_queue table is in the Realtime publication, so we get
  // a server-push the moment another user's startMatching() claims us —
  // eliminating the polling delay (was up to 2500ms, now near-zero).
  useEffect(() => {
    if (!profile?.id || matchState?.state !== "searching") return;

    const channel = supabase
      .channel(`queue-watch-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matchmaking_queue",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const row = payload.new as { status: string };
          // Only trigger a refetch if the row just became 'matched'.
          // The server's getMatchmakingState will then resolve the full state
          // (session, partner info, etc.) and update the React Query cache.
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
  }, [profile?.id, matchState?.state, queryClient]);

  const introComplete =
    status === "matched" && introAccepted && partnerIntroReady;
  const introActive = status === "matched" && !introComplete;
  const introExpired = introActive && introSecondsLeft === 0;
  const currentIcebreaker =
    ICEBREAKER_CARDS[icebreakerIndex % ICEBREAKER_CARDS.length];
  const canUseShield = status === "matched" && !!activeSession && !!partnerId;

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
        ? "Waiting for the next active member"
        : "Ready when you are";
  const busy =
    profileLoading ||
    matchLoading ||
    startMutation.isPending ||
    cancelMutation.isPending ||
    endMutation.isPending ||
    nextMutation.isPending ||
    safetyMutation.isPending;

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

        <section className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="relative order-2 h-[220px] min-h-[160px] overflow-hidden rounded-2xl border border-border bg-surface md:order-1 md:h-auto md:min-h-[320px]">
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
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15">
                  {cameraState === "starting" ? (
                    <Loader2 className="size-6 animate-spin text-primary" />
                  ) : (
                    <CameraOff className="size-6 text-primary" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {cameraState === "unsupported"
                      ? "Camera unavailable"
                      : cameraState === "blocked"
                        ? "Camera permission needed"
                        : cameraState === "off"
                          ? "Camera and mic are off"
                          : "Starting camera"}
                  </p>
                  {cameraError && (
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">
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

          <div className="relative order-1 min-h-[360px] overflow-hidden rounded-2xl border border-border bg-surface md:order-2 md:min-h-[320px]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {!hasRemoteVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/15">
                  {status === "matched" ? (
                    rtcStatus === "failed" || rtcStatus === "disconnected" ? (
                      <CameraOff className="size-6 text-primary" />
                    ) : (
                      <UserRound className="size-6 text-primary" />
                    )
                  ) : status === "searching" ? (
                    <Loader2 className="size-6 animate-spin text-primary" />
                  ) : (
                    <Search className="size-6 text-primary" />
                  )}
                </div>
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {partnerName}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
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
                <Button
                  className="h-10 rounded-xl"
                  disabled={introAccepted}
                  onClick={continueIntro}
                >
                  {introAccepted ? (
                    <Check className="size-4" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {introAccepted ? "Waiting" : "Continue"}
                </Button>
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

        <footer className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="secondary"
            className="h-12 rounded-full px-4"
            disabled={busy || status === "searching"}
            onClick={() => nextMutation.mutate()}
          >
            {nextMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : status === "matched" ? (
              <SkipForward className="size-5" />
            ) : (
              <StepForward className="size-5" />
            )}
            <span className="hidden sm:inline">
              {status === "matched" ? "Skip / Next" : "Next"}
            </span>
            <span className="sr-only sm:hidden">Next match</span>
          </Button>
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
            size="icon"
            variant={chatOpen ? "default" : "secondary"}
            className="size-12 rounded-full"
            disabled={status !== "matched"}
            onClick={() => setChatOpen((o) => !o)}
          >
            <MessageCircle className="size-5" />
            <span className="sr-only">Live Chat</span>
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
                  No messages yet. Send a message to start!
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
                if (!chatInput.trim()) return;
                sendChatMessage(chatInput.trim());
                setChatInput("");
              }}
            >
              <input
                type="text"
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!chatInput.trim()}
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
