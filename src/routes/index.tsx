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
    <main className="min-h-screen overflow-hidden bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 safe-top sm:px-8 lg:px-10">
        <header className="flex items-center justify-between py-6 sm:py-8">
          <span className="font-display text-2xl font-extrabold text-foreground">
            lume<span className="text-primary">.</span>
          </span>
          {!loading &&
            (session ? (
              <Button asChild variant="secondary" size="sm" className="px-4">
                <Link to="/lobby">Open app</Link>
              </Button>
            ) : (
              <Button asChild variant="secondary" size="sm" className="px-4">
                <Link to="/auth">Sign in</Link>
              </Button>
            ))}
        </header>

        <section className="grid flex-1 items-center gap-10 py-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16 lg:py-12">
          <div className="animate-rise max-w-xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm">
              <Sparkles className="size-3.5 text-primary" />
              18+ · moderated · worldwide
            </div>
            <h1 className="font-display text-5xl font-extrabold leading-[1.02] text-foreground sm:text-6xl">
              Meet someone new.
              <span className="block text-primary">Feel the spark.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              Lume drops you into a live one-to-one video call with a stranger
              in seconds. Say hi, or skip to the next.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="ember-lift h-14 w-full rounded-xl px-7 text-base sm:w-auto"
              >
                <Link to={session ? "/lobby" : "/auth"}>
                  {session ? "Start matching" : "Get started free"}
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              By continuing you confirm you are 18 or older.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
            <div className="absolute -inset-3 rounded-[2rem] border border-primary/20 bg-primary/5" />
            <img
              src="/lume-assets/hero-match.png"
              alt="Two people connecting through a Lume video call"
              className="relative aspect-[1.18] w-full object-contain"
            />
          </div>
        </section>

        <section className="grid gap-px border-y border-border bg-border sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex gap-4 bg-background px-2 py-6 sm:px-6"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
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
        <div className="py-5 text-center text-xs text-muted-foreground safe-bottom">
          Real conversations, on your terms.
        </div>
      </div>
    </main>
  );
}
