import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, ShieldCheck, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lume — Meet someone new on live video" },
      {
        name: "description",
        content:
          "Lume pairs you instantly with new people for one-to-one live video calls. Moderated, 18+, and built for real conversation.",
      },
      {
        property: "og:title",
        content: "Lume — Meet someone new on live video",
      },
      {
        property: "og:description",
        content:
          "Instant, moderated one-to-one live video calls with people around the world.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Radio,
    title: "Instant matching",
    body: "Tap once and Lume finds someone who's online right now.",
  },
  {
    icon: Video,
    title: "Crisp 1-to-1 video",
    body: "Low-latency calls with chat, mute and camera controls.",
  },
  {
    icon: ShieldCheck,
    title: "Safety first",
    body: "Report, block and human moderation on every session.",
  },
];

function Landing() {
  const { session, loading } = useSession();

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-6 safe-top safe-bottom">
        <header className="flex items-center justify-between py-6">
          <span className="font-display text-xl font-bold tracking-tight text-foreground">
            lume<span className="text-primary">.</span>
          </span>
          {!loading &&
            (session ? (
              <Button asChild variant="ghost" size="sm">
                <Link to="/lobby">Open app</Link>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth">Sign in</Link>
              </Button>
            ))}
        </header>

        <section className="flex flex-1 flex-col justify-center py-10">
          <div className="animate-rise">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              18+ · moderated · worldwide
            </div>
            <h1 className="text-5xl leading-[1.05] font-bold text-foreground">
              Meet someone new,
              <span className="block text-primary">right now.</span>
            </h1>
            <p className="mt-5 text-base text-muted-foreground">
              Lume drops you into a live one-to-one video call with a stranger
              in seconds. Say hi, or skip to the next.
            </p>

            <div className="mt-8 space-y-3">
              <Button
                asChild
                size="lg"
                className="ember-lift h-14 w-full rounded-2xl text-base"
              >
                <Link to={session ? "/lobby" : "/auth"}>
                  {session ? "Start matching" : "Get started free"}
                </Link>
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                By continuing you confirm you are 18 or older.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3 pb-10">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12">
                <Icon className="size-5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
