const GOOGLE_SIGN_IN_ROUTES = ["/lobby", "/onboarding"] as const;
type GoogleSignInRoute = (typeof GOOGLE_SIGN_IN_ROUTES)[number];

export function getSafePostAuthPath(value: string | null): GoogleSignInRoute {
  return GOOGLE_SIGN_IN_ROUTES.includes(value as GoogleSignInRoute)
    ? (value as GoogleSignInRoute)
    : "/lobby";
}

export function getGoogleSignInUrl(next = "/lobby") {
  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];

  if (!supabaseUrl) {
    throw new Error("Missing Supabase URL for Google sign-in.");
  }

  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
    getSafePostAuthPath(next),
  )}`;
  const url = new URL("/auth/v1/authorize", supabaseUrl);

  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

export function startGoogleSignIn(next = "/lobby") {
  window.location.href = getGoogleSignInUrl(next);
}

export async function isGoogleSignInEnabled() {
  const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"];
  const supabaseKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];

  if (!supabaseUrl || !supabaseKey) return false;

  const response = await fetch(new URL("/auth/v1/settings", supabaseUrl), {
    headers: {
      apikey: supabaseKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) return false;

  const settings = (await response.json()) as {
    external?: { google?: boolean };
  };

  return settings.external?.google === true;
}
