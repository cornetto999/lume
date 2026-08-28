import { type ReactNode, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Code2,
  Crown,
  Cpu,
  Dumbbell,
  EyeOff,
  Film,
  Flame,
  Gamepad2,
  Gift,
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
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Trophy,
  Users,
  Utensils,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
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
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_MATCH_PREFERENCES,
  LANGUAGE_OPTIONS,
  type CountryMatchMode,
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
const FALLBACK_AVATAR = "/lume-assets/profile-avatar.png";
const DEFAULT_TOPIC_SELECTION = ["Music", "Developers"];

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
    label: "Developers",
    topic: "Developers",
    icon: Code2,
    iconClassName: "text-primary",
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

const TRENDING_VIBES = [
  { label: "Chill", count: 12, dotClassName: "bg-violet-400" },
  { label: "Music", count: 8, dotClassName: "bg-orange-400" },
  { label: "Friendship", count: 6, dotClassName: "bg-rose-400" },
  { label: "Study", count: 4, dotClassName: "bg-blue-400" },
];

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
  const avatarSrc = profile?.avatar_url || FALLBACK_AVATAR;
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
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 safe-top safe-bottom sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center">
            <div className="font-display text-4xl font-black leading-none sm:text-5xl">
              Lum<span className="text-primary">e</span>
            </div>
            <Sparkles className="-ml-0.5 mb-6 size-6 text-primary" />
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="secondary"
              className="h-9 rounded-xl border border-border bg-surface/80 px-3 text-sm text-primary shadow-sm backdrop-blur hover:bg-surface-raised"
              onClick={() => toast.info("Lume Plus is coming soon.")}
            >
              <Crown className="size-4 fill-primary/25 text-primary" />
              <span className="hidden font-semibold sm:inline">Lume Plus</span>
            </Button>
            <IconHeaderButton
              icon={MessageCircle}
              label="Messages"
              onClick={() => setActivePanel("messages")}
            />
            <IconHeaderButton
              icon={Bell}
              label="Alerts"
              onClick={() => setActivePanel("alerts")}
            />
            <button
              type="button"
              className="relative size-10 overflow-hidden rounded-full border border-border bg-surface shadow-sm transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setActivePanel("settings")}
            >
              <img
                src={avatarSrc}
                alt={`${displayName} profile`}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success" />
            </button>
          </div>
        </header>

        <section className="grid gap-6 py-6 md:grid-cols-[0.86fr_1.14fr] md:items-center lg:py-8">
          <div className="relative">
            <Sparkles className="absolute -left-2 top-2 size-4 rotate-12 text-primary" />
            <h1 className="max-w-xl text-4xl font-black leading-[0.98] sm:text-5xl lg:text-6xl">
              Ready to meet <span className="block text-primary">someone?</span>
            </h1>
            <p className="mt-4 text-base text-muted-foreground sm:text-lg">
              Good people. Real conversations.
            </p>
          </div>

          <div className="relative min-h-[220px] overflow-hidden md:min-h-[290px]">
            <div className="absolute inset-x-0 top-0 h-64 rounded-[2rem] bg-[radial-gradient(circle,rgba(255,255,255,0.16)_1px,transparent_1px)] opacity-40 [background-size:12px_12px]" />
            <img
              src={HERO_MATCH_IMAGE}
              alt="Two Lume members matched in a video call preview"
              className="relative z-10 mx-auto h-auto w-full max-w-[540px] object-contain"
            />
          </div>
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-border bg-surface/70 shadow-xl shadow-black/20 backdrop-blur sm:grid-cols-3">
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

        <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface/55 p-2 backdrop-blur">
          <div className="flex h-9 items-center gap-2 rounded-full px-2.5 text-sm font-semibold">
            <Flame className="size-5 fill-primary text-primary" />
            TRENDING NOW
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            {TRENDING_VIBES.map((trend) => (
              <button
                key={trend.label}
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-secondary/70 px-4 text-sm text-foreground transition hover:border-primary/60 hover:bg-primary/10"
                onClick={() => {
                  const matching = VIBE_CARDS.find(
                    (card) =>
                      card.label === trend.label || card.value === trend.label,
                  );
                  if (matching) setSelectedVibe(matching.value);
                }}
              >
                <span
                  className={cn("size-2 rounded-full", trend.dotClassName)}
                />
                <span>{trend.label}</span>
                <span className="text-muted-foreground">{trend.count}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
            onClick={() => setActivePanel("messages")}
          >
            See all
            <ArrowRight className="size-4" />
          </button>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
          <PanelHeading
            icon={Heart}
            iconClassName="text-rose-300"
            title="I'm here to"
            subtitle="Choose your vibe"
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {VIBE_CARDS.map((card) => (
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

        <section className="mt-4 rounded-2xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
          <PanelHeading
            icon={MessageCircle}
            iconClassName="text-pink-300"
            title="I like talking about"
            subtitle={`Pick topics you enjoy (choose up to 5)${
              selectedTopicCount ? ` | ${selectedTopicCount} selected` : ""
            }`}
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {TOPIC_CARDS.map((card) => {
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

        <section className="mt-4 grid gap-3 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="rounded-2xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
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
              <SelectTrigger className="mt-4 h-11 rounded-xl border-border bg-secondary/70 px-4">
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

          <div className="rounded-2xl border border-border bg-surface/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
            <PanelHeading
              icon={MapPin}
              iconClassName="text-violet-300"
              title="Country"
              subtitle="Where do you want to meet people from?"
            />
            <div className="mt-5 grid overflow-hidden rounded-2xl border border-border bg-secondary/70 p-1 sm:grid-cols-2">
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
            "ember-lift mt-5 h-12 w-full rounded-full text-base font-bold sm:h-14 sm:text-lg",
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

        <footer className="flex flex-wrap items-center justify-center gap-3 py-6 text-center text-sm text-muted-foreground">
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
          <DialogContent className="max-w-md rounded-2xl border-border bg-surface">
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

            {activePanel === "messages" && (
              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                      <MessageCircle className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">
                        No messages yet
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Save a Lume Moment after a mutual conversation.
                      </p>
                    </div>
                  </div>
                </div>
                <Button
                  className="h-11 w-full rounded-xl"
                  onClick={() => {
                    setActivePanel(null);
                    if (status === "idle") startMutation.mutate();
                  }}
                  disabled={matchingBusy || status !== "idle"}
                >
                  <Video className="size-4" />
                  Start matching
                </Button>
              </div>
            )}

            {activePanel === "alerts" && (
              <div className="space-y-3">
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
              </div>
            )}

            {activePanel === "settings" && (
              <div className="space-y-4">
                <div className="grid gap-3">
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

                <div className="grid gap-3 rounded-xl border border-border bg-background p-4">
                  <Label htmlFor="settings-language">Preferred language</Label>
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
                        <SelectItem key={language.value} value={language.value}>
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
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}

function IconHeaderButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface/80 text-foreground shadow-sm backdrop-blur transition hover:border-primary/60 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      onClick={onClick}
    >
      <Icon className="size-4" />
      <span className="sr-only">{label}</span>
    </button>
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
        "flex items-center gap-3 px-5 py-4",
        divider && "border-t border-border sm:border-l sm:border-t-0",
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full border",
          iconClassName,
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-black leading-none">{value}</p>
        <p className={cn("mt-1 text-xs font-medium", labelClassName)}>
          {label}
        </p>
      </div>
    </div>
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
    <div className="flex items-start gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary/70">
        <Icon className={cn("size-6", iconClassName)} />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-bold leading-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
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
        "flex min-h-12 items-center justify-center gap-2 rounded-xl border bg-secondary/55 px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/15 text-foreground shadow-[0_0_24px_-16px_var(--primary)]"
          : "border-border text-foreground hover:border-primary/60 hover:bg-primary/10",
      )}
      onClick={onClick}
    >
      <Icon className={cn("size-5 shrink-0", iconClassName)} />
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
        "relative flex h-10 min-w-0 items-center gap-2 rounded-xl border bg-secondary/55 px-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border text-foreground hover:border-primary/60 hover:bg-primary/10",
      )}
      onClick={onClick}
    >
      <Icon className={cn("size-4 shrink-0", iconClassName)} />
      <span className="min-w-0 truncate">{label}</span>
      {selected && (
        <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
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
        "min-h-9 rounded-lg px-2 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
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
    <section className="mt-4 flex items-center gap-3 rounded-[1.35rem] border border-primary/30 bg-primary/10 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
        <Icon className={cn("size-5", iconClassName)} />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
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
    <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background p-4">
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
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

function formatCountryLabel(country: string | null | undefined) {
  const normalized = country?.trim().toLowerCase();
  if (!normalized || normalized === "pinas" || normalized.includes("phil")) {
    return "Philippines";
  }
  return country?.trim() || "Philippines";
}
