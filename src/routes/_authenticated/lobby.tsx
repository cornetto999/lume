import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  CheckCircle2,
  Clock3,
  Loader2,
  LogOut,
  MessageCircle,
  Radio,
  Search,
  Settings,
  Sparkles,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getLobbySnapshot,
  getMyProfile,
  heartbeat,
} from "@/lib/profile.functions";
import {
  cancelMatching,
  endCurrentMatch,
  getMatchmakingState,
  startMatching,
} from "@/lib/matchmaking.functions";
import { supabase } from "@/integrations/supabase/client";

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
  const loadProfile = useServerFn(getMyProfile);
  const loadSnapshot = useServerFn(getLobbySnapshot);
  const sendHeartbeat = useServerFn(heartbeat);
  const loadMatchmaking = useServerFn(getMatchmakingState);
  const beginMatching = useServerFn(startMatching);
  const cancelSearch = useServerFn(cancelMatching);
  const endMatch = useServerFn(endCurrentMatch);

  const {
    data: profile,
    error: profileError,
    isLoading: profileLoading,
  } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => loadProfile(),
    retry: false,
  });

  const { data: snapshot } = useQuery({
    queryKey: ["lobby-snapshot"],
    queryFn: () => loadSnapshot(),
    enabled: !!profile?.profile_completed,
    refetchInterval: 30_000,
  });

  const { data: matchState, isLoading: matchLoading } = useQuery({
    queryKey: ["matchmaking-state"],
    queryFn: () => loadMatchmaking(),
    enabled: !!profile?.profile_completed,
    refetchInterval: (query) =>
      query.state.data?.state === "searching" ? 1_500 : false,
  });

  const setMatchState = (state: NonNullable<typeof matchState>) => {
    queryClient.setQueryData(["matchmaking-state"], state);
    void queryClient.invalidateQueries({ queryKey: ["lobby-snapshot"] });
  };

  const startMutation = useMutation({
    mutationFn: () => beginMatching(),
    onSuccess: (state) => {
      setMatchState(state);
      toast[state.state === "matched" ? "success" : "info"](
        state.state === "matched"
          ? "Match found. Your room is ready."
          : "Searching for someone live now.",
      );
      navigate({ to: "/call" });
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not start matching."),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSearch(),
    onSuccess: (state) => {
      setMatchState(state);
      toast.info("Search cancelled.");
    },
    onError: (error: Error) =>
      toast.error(error.message || "Could not cancel search."),
  });

  const endMutation = useMutation({
    mutationFn: () => endMatch(),
    onSuccess: (state) => {
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
    if (matchState?.state === "matched") {
      navigate({ to: "/call" });
    }
  }, [matchState?.state, navigate]);

  useEffect(() => {
    if (!profile?.profile_completed) return;
    if (matchState?.state === "searching" || matchState?.state === "matched") {
      return;
    }

    const beat = () => {
      void sendHeartbeat({ data: { presence: "online" } });
    };

    beat();
    const interval = window.setInterval(beat, 45_000);
    return () => window.clearInterval(interval);
  }, [profile?.profile_completed, matchState?.state, sendHeartbeat]);

  // Realtime: instantly detect when our queue entry is marked 'matched'
  // so we can navigate to /call the moment the server pairs us up,
  // instead of waiting up to 1500ms for the next poll tick.
  useEffect(() => {
    const userId = profile?.id;
    if (!userId || matchState?.state !== "searching") return;

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
  }, [profile?.id, matchState?.state, queryClient]);

  const signOut = async () => {
    await sendHeartbeat({ data: { presence: "offline" } }).catch(() => null);
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
  const onlineCount = snapshot?.onlineCount ?? 0;
  const searchingCount = snapshot?.searchingCount ?? 0;
  const status = matchState?.state ?? "idle";
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

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-6 safe-top safe-bottom">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/15">
              <UserRound className="size-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Online now</p>
              <h1 className="text-lg font-semibold text-foreground">
                {displayName}
              </h1>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={signOut}>
            <LogOut className="size-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </header>

        <section className="flex flex-1 flex-col justify-center py-10">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Lume lobby</p>
                <h2 className="mt-1 text-3xl font-bold text-foreground">
                  Ready to meet someone?
                </h2>
              </div>
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
                <Radio className="size-7 text-primary" />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-background p-4">
                <p className="text-2xl font-bold text-foreground">
                  {onlineCount}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">online</p>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <p className="text-2xl font-bold text-foreground">
                  {searchingCount}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">searching</p>
              </div>
            </div>

            {status === "searching" && (
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    Looking for a live match
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Keep this page open while Lume checks the queue.
                  </p>
                </div>
              </div>
            )}

            {status === "matched" && (
              <div className="mt-5 rounded-xl border border-success/30 bg-success/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/15">
                    <Sparkles className="size-5 text-success" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">Match found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You matched with {partnerName}. Room {roomCode}.
                    </p>
                  </div>
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                </div>
              </div>
            )}

            <Button
              size="lg"
              variant={status === "searching" ? "secondary" : "default"}
              disabled={matchingBusy}
              className="ember-lift mt-6 h-14 w-full rounded-2xl text-base"
              onClick={onPrimaryMatchAction}
            >
              {matchingBusy ? (
                <Loader2 className="size-5 animate-spin" />
              ) : status === "searching" ? (
                <X className="size-5" />
              ) : status === "matched" ? (
                <Clock3 className="size-5" />
              ) : (
                <Video className="size-5" />
              )}
              {status === "searching"
                ? "Cancel search"
                : status === "matched"
                  ? "End match"
                  : "Start matching"}
            </Button>

            {status === "idle" && (
              <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Search className="size-3.5" />
                Lume will pair you with the next available active member.
              </p>
            )}
          </div>
        </section>

        <nav className="grid grid-cols-3 gap-3 pb-2">
          <Button variant="secondary" className="h-12 rounded-xl">
            <MessageCircle className="size-4" />
            Messages
          </Button>
          <Button variant="secondary" className="h-12 rounded-xl">
            <Bell className="size-4" />
            Alerts
          </Button>
          <Button variant="secondary" className="h-12 rounded-xl">
            <Settings className="size-4" />
            Settings
          </Button>
        </nav>
      </div>
    </main>
  );
}
