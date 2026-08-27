import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getGoogleSignInUrl,
  isGoogleSignInEnabled,
  startGoogleSignIn,
} from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/~oauth/initiate")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Opening Google sign-in" }],
  }),
  component: OAuthInitiatePage,
});

function OAuthInitiatePage() {
  const navigate = useNavigate();
  const [googleUrl, setGoogleUrl] = useState("");

  useEffect(() => {
    const initiate = async () => {
      const params = new URLSearchParams(window.location.search);
      const provider = params.get("provider");

      if (provider !== "google") {
        toast.error("That sign-in provider is not supported.");
        navigate({ to: "/auth", replace: true });
        return;
      }

      try {
        const enabled = await isGoogleSignInEnabled();
        if (!enabled) {
          navigate({ to: "/auth", search: { mode: "signup" }, replace: true });
          return;
        }
        setGoogleUrl(getGoogleSignInUrl("/lobby"));
        startGoogleSignIn("/lobby");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Google sign-in failed.",
        );
        navigate({ to: "/auth", replace: true });
      }
    };

    void initiate();
  }, [navigate]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Opening Google sign-in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connecting securely with Supabase.
          </p>
        </div>
      </div>
      {googleUrl && (
        <Button asChild className="mt-6 h-12 rounded-xl px-6">
          <a href={googleUrl}>Continue with Google</a>
        </Button>
      )}
    </main>
  );
}
