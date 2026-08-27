import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getSafePostAuthPath } from "@/lib/auth";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Signing in to Lume" }],
  }),
  component: AuthCallbackPage,
});

function getNextPath() {
  const search = new URLSearchParams(window.location.search);
  return getSafePostAuthPath(search.get("next"));
}

function getAuthError(): string | null {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    search.get("error_description") ||
    search.get("error") ||
    hash.get("error_description") ||
    hash.get("error")
  );
}

function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const finishSignIn = async () => {
      const authError = getAuthError();
      if (authError) {
        toast.error(authError);
        navigate({ to: "/auth", replace: true });
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error || !data.session) {
        toast.error(error?.message || "Could not finish sign-in.");
        navigate({ to: "/auth", replace: true });
        return;
      }

      navigate({ to: getNextPath(), replace: true });
    };

    void finishSignIn();

    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Finishing sign-in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Taking you into Lume.
          </p>
        </div>
      </div>
    </main>
  );
}
