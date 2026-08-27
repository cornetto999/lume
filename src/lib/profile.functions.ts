import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables } from "@/integrations/supabase/types";

type Profile = Tables<"profiles">;

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const profileSchema = z.object({
  display_name: z.string().trim().min(2).max(40),
  username: z.string().trim().toLowerCase().regex(USERNAME_RE),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum([
    "female",
    "male",
    "non_binary",
    "other",
    "prefer_not_to_say",
  ]),
  country: z.string().trim().min(2).max(60),
  bio: z.string().trim().max(200).optional().default(""),
  interests: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
});

function ageFrom(dob: string): number {
  const birth = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age;
}

/** Current user's own profile row. */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Profile> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;

    const { getSupabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: created, error: createError } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: context.userId }, { onConflict: "id" })
      .select("*")
      .single();
    if (createError) throw new Error(createError.message);
    return created;
  });

/** Username availability check (case-insensitive). */
export const checkUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { username: string }) =>
    z.object({ username: z.string().trim().toLowerCase() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!USERNAME_RE.test(data.username)) {
      return { available: false, reason: "invalid" as const };
    }
    const { getSupabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const supabaseAdmin = await getSupabaseAdmin();
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .limit(1);
    if (error) throw new Error(error.message);
    const taken = (rows ?? []).some((r) => r.id !== context.userId);
    return {
      available: !taken,
      reason: taken ? ("taken" as const) : ("ok" as const),
    };
  });

/** Completes onboarding: 18+ gate, unique username, activates the account. */
export const completeProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => profileSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (ageFrom(data.date_of_birth) < 18) {
      throw new Error("You must be 18 or older to use Lume.");
    }

    const { getSupabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const supabaseAdmin = await getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.username)
      .neq("id", context.userId)
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if ((existing ?? []).length > 0)
      throw new Error("That username is already taken.");

    const { data: current, error: currentError } = await supabaseAdmin
      .from("profiles")
      .select("account_status")
      .eq("id", context.userId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (
      current &&
      ["suspended", "banned", "deleted"].includes(current.account_status)
    ) {
      throw new Error("This account is not allowed to use Lume.");
    }

    const { error } = await supabaseAdmin.from("profiles").upsert(
      {
        id: context.userId,
        display_name: data.display_name,
        username: data.username,
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        country: data.country,
        bio: data.bio || null,
        interests: data.interests,
        profile_completed: true,
        account_status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);

    return { ok: true };
  });

/** Presence heartbeat — keeps the member visible as online. */
export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { presence?: "online" | "away" | "offline" }) =>
    z
      .object({
        presence: z.enum(["online", "away", "offline"]).default("online"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        presence: data.presence,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Aggregate lobby counts only — never exposes member rows. */
export const getLobbySnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getSupabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const supabaseAdmin = await getSupabaseAdmin();
    const since = new Date(Date.now() - 90_000).toISOString();

    const [online, searching] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("account_status", "active")
        .in("presence", ["online", "searching", "in_call"])
        .gte("last_active_at", since),
      supabaseAdmin
        .from("matchmaking_queue")
        .select("user_id", { count: "exact", head: true })
        .eq("status", "searching")
        .gte("heartbeat_at", since),
    ]);

    return {
      onlineCount: online.count ?? 0,
      searchingCount: searching.count ?? 0,
    };
  });
