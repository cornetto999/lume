import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getGoogleSignInUrl, isGoogleSignInEnabled } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type AuthMode = "signin" | "signup";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in to Lume" },
      {
        name: "description",
        content:
          "Sign in or create your Lume account to start meeting new people on live video.",
      },
      { property: "og:title", content: "Sign in to Lume" },
      {
        property: "og:description",
        content: "Create your Lume account and start matching on live video.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [googleUrl, setGoogleUrl] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const requestedMode = new URLSearchParams(window.location.search).get(
      "mode",
    );
    if (requestedMode === "signup") setMode("signup");
  }, []);

  useEffect(() => {
    let active = true;

    isGoogleSignInEnabled()
      .then((enabled) => {
        if (!active || !enabled) return;
        setGoogleUrl(getGoogleSignInUrl("/lobby"));
      })
      .catch(() => {
        if (active) setGoogleUrl("");
      });

    return () => {
      active = false;
    };
  }, []);

  const submit = async (mode: AuthMode) => {
    if (!email || password.length < 8) {
      toast.error("Enter your email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=/lobby`,
            },
          });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (mode === "signup") {
      if (data.session) {
        navigate({ to: "/lobby" });
        return;
      }
      toast.success("Check your inbox to confirm your email, then sign in.");
      return;
    }
    navigate({ to: "/lobby" });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-[0.95fr_1.05fr]">
        <section className="hidden border-r border-border bg-surface/55 p-10 lg:flex lg:flex-col lg:justify-between">
          <Link
            to="/"
            className="font-display text-2xl font-extrabold text-foreground"
          >
            lume<span className="text-primary">.</span>
          </Link>
          <div>
            <div className="mb-6 flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
            <h1 className="max-w-sm font-display text-5xl font-extrabold leading-tight text-foreground">
              A good conversation is one tap away.
            </h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-muted-foreground">
              Meet new people live, with clear safety controls from the first
              hello.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            18+ · moderated · worldwide
          </p>
        </section>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10 safe-top safe-bottom lg:px-10">
          <Link
            to="/"
            className="font-display text-2xl font-extrabold text-foreground lg:hidden"
          >
            lume<span className="text-primary">.</span>
          </Link>

          <h1 className="mt-8 font-display text-3xl font-bold text-foreground lg:mt-0">
            Welcome back
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            One tap and you're in a live conversation. You must be 18 or older.
          </p>

          {googleUrl ? (
            <Button
              asChild
              size="lg"
              className="mt-8 h-14 w-full rounded-xl text-base"
            >
              <a href={googleUrl}>Continue with Google</a>
            </Button>
          ) : (
            <Button
              onClick={() => setMode("signup")}
              size="lg"
              className="mt-8 h-14 w-full rounded-xl text-base"
            >
              Create account with email
            </Button>
          )}

          <div className="my-7 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {googleUrl ? "or use email" : "or sign in"}
            <span className="h-px flex-1 bg-border" />
          </div>

          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as AuthMode)}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            {(["signin", "signup"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="mt-5 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`${mode}-email`}>Email</Label>
                  <Input
                    id={`${mode}-email`}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="h-12 rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${mode}-password`}>Password</Label>
                  <div className="relative">
                    <Input
                      id={`${mode}-password`}
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        mode === "signin" ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="h-12 rounded-xl pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                      <span className="sr-only">
                        {showPassword ? "Hide password" : "Show password"}
                      </span>
                    </button>
                  </div>
                </div>
                <Button
                  onClick={() => submit(mode)}
                  disabled={busy}
                  variant="secondary"
                  className="h-12 w-full rounded-lg"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : mode === "signin" ? (
                    "Sign in"
                  ) : (
                    "Create account"
                  )}
                </Button>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </main>
  );
}
