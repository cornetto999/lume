import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CameraOff,
  CircleStop,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Search,
  SkipForward,
  StepForward,
  UserRound,
  Video,
  PictureInPicture2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCamera } from "@/contexts/CameraContext";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/profile.functions";
import {
  cancelMatching,
  endCurrentMatch,
  getMatchmakingState,
  startMatching,
  type MatchmakingState,
} from "@/lib/matchmaking.functions";

type CameraState = "starting" | "ready" | "blocked" | "unsupported";
type RtcStatus =
  "idle" | "waiting" | "connecting" | "live" | "disconnected" | "failed";

type RtcSignalPayload = {
  sessionId: string;
  from: string;
  to: string;
  type: "ready" | "offer" | "answer" | "candidate" | "leave";
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const SIGNAL_EVENT = "webrtc_signal";
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
    ["ready", "offer", "answer", "candidate", "leave"].includes(
      payload.type ?? "",
    )
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
  const { localStream, cameraError, isReady, startCamera } = useCamera();
  const cameraState: CameraState = isReady 
    ? (cameraError ? "blocked" : "ready") 
    : "starting";

  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);

          
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(),
    retry: 1,
    throwOnError: false,
  });

  const [wasSearching, setWasSearching] = useState(false);

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
      if (wasSearching && s === "idle") return 1_500;
      return false;
    },
  });

  const status = matchState?.state ?? "idle";
  const activeSession =
    matchState?.state === "matched" ? matchState.session : null;
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
  } = useCallConnection({
    sessionId: activeSession?.id ?? null,
    currentUserId: profile?.id ?? null,
    currentUsername:
      profile?.username || profile?.display_name || profile?.id || "member",
    partnerId,
    isOfferer,
    localStream: localStream,
    mediaReady: cameraState !== "starting",
    remoteVideoRef,
  });

  const setMatchState = (state: MatchmakingState) => {
    queryClient.setQueryData(["matchmaking-state"], state);
    void queryClient.invalidateQueries({ queryKey: ["lobby-snapshot"] });
  };

  const startMutation = useMutation({
    mutationFn: () => startMatching(),
    onSuccess: (state) => {
      setMatchState(state);
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Match found. Your room is ready."
          : "Searching for someone live now.",
      );
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not start matching."),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelMatching(),
    onSuccess: (state) => {
      setWasSearching(false);
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not leave search."),
  });

  const endMutation = useMutation({
    mutationFn: () => endCurrentMatch(),
    onSuccess: (state) => {
      setWasSearching(false);
      setMatchState(state);
      navigate({ to: "/lobby", replace: true });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not end the match."),
  });

  const skipMutation = useMutation({
    mutationFn: () => endCurrentMatch(),
    onSuccess: (state) => {
      setWasSearching(false);
      setMatchState(state);
      toast.info("Match skipped.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not skip this match."),
  });

  const nextMutation = useMutation({
    mutationFn: async () => {
      if (matchState?.state === "matched") {
        await endCurrentMatch();
      }
      return startMatching();
    },
    onSuccess: (state) => {
      setMatchState(state);
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Next match found."
          : "Looking for your next match.",
      );
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not find the next match."),
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

  // Track whether we've ever been in searching/matched state this session
  useEffect(() => {
    if (matchState?.state === "searching" || matchState?.state === "matched") {
      setWasSearching(true);
    }
  }, [matchState?.state]);

  // Auto-restart matching when the search goes stale and drops back to idle.
  // This prevents the user from getting stuck on the call page with an idle
  // state after a 90-second stale search timeout.
  useEffect(() => {
    if (
      wasSearching &&
      matchState?.state === "idle" &&
      !busy &&
      !!profile?.profile_completed
    ) {
      setWasSearching(false);
      startMutation.mutate();
    }
  }, [wasSearching, matchState?.state, profile?.profile_completed]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    // If not ready, tell context to start it (if it isn't already)
    if (!isReady) {
      void startCamera();
    }
  }, [isReady, startCamera]);

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

  const leave = () => {
    if (matchState?.state === "matched") {
      endMutation.mutate();
      return;
    }

    if (matchState?.state === "searching") {
      cancelMutation.mutate();
      return;
    }

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
    skipMutation.isPending ||
    nextMutation.isPending;

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
          <Button
            variant="secondary"
            className="h-11 rounded-xl"
            disabled={busy}
            onClick={leave}
          >
            <LogOut className="size-4" />
            Leave
          </Button>
        </header>

        <section className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-border bg-surface">
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
                <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/15">
                  {cameraState === "starting" ? (
                    <Loader2 className="size-7 animate-spin text-primary" />
                  ) : (
                    <CameraOff className="size-7 text-primary" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {cameraState === "unsupported"
                      ? "Camera unavailable"
                      : cameraState === "blocked"
                        ? "Camera permission needed"
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

          <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-border bg-surface">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {!hasRemoteVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex size-20 items-center justify-center rounded-3xl bg-primary/15">
                  {status === "matched" ? (
                    rtcStatus === "failed" || rtcStatus === "disconnected" ? (
                      <CameraOff className="size-10 text-primary" />
                    ) : (
                      <UserRound className="size-10 text-primary" />
                    )
                  ) : status === "searching" ? (
                    <Loader2 className="size-10 animate-spin text-primary" />
                  ) : (
                    <Search className="size-10 text-primary" />
                  )}
                </div>
                <div>
                  <p className="text-xl font-bold text-foreground">
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
                className={`absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${rtcStatus === "live"
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

        <footer className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="secondary"
            className="h-12 rounded-full px-4"
            disabled={busy || status !== "matched"}
            onClick={() => skipMutation.mutate()}
          >
            {skipMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <SkipForward className="size-5" />
            )}
            <span className="hidden sm:inline">Skip</span>
            <span className="sr-only sm:hidden">Skip match</span>
          </Button>
          <Button
            variant="secondary"
            className="h-12 rounded-full px-4"
            disabled={busy}
            onClick={() => nextMutation.mutate()}
          >
            {nextMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <StepForward className="size-5" />
            )}
            <span className="hidden sm:inline">Next</span>
            <span className="sr-only sm:hidden">Next match</span>
          </Button>
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

  useEffect(() => {
    if (!sessionId || !currentUserId || !partnerId) {
      setStatus("idle");
      setError("");
      setHasRemoteVideo(false);
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
            params.encodings[0].maxBitrate = 8000_000;
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

  return { status, error, hasRemoteVideo };
}
