import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";
import {
  COUNTRY_MATCH_MODES,
  DEFAULT_MATCH_PREFERENCES,
  LANGUAGE_OPTIONS,
  VIBE_OPTIONS,
  type CountryMatchMode,
  type MatchPreferences,
  type VibeOption,
} from "@/types/models";

type SupabaseAdminClient = SupabaseClient<Database, "public", "public">;
type Profile = Tables<"profiles">;
type QueueEntry = Tables<"matchmaking_queue">;
type CallSession = Tables<"call_sessions">;
type MatchableProfile = Pick<
  Profile,
  "id" | "profile_completed" | "account_status" | "country" | "interests"
>;

type PartnerSummary = Pick<
  Profile,
  | "id"
  | "display_name"
  | "username"
  | "avatar_url"
  | "country"
  | "interests"
  | "presence"
  | "last_active_at"
>;

export type MatchmakingState =
  | {
      state: "idle";
      queue: null;
      session: null;
      partner: null;
    }
  | {
      state: "searching";
      queue: QueueEntry;
      session: null;
      partner: null;
    }
  | {
      state: "matched";
      queue: QueueEntry;
      session: CallSession;
      partner: PartnerSummary | null;
    };

const ACTIVE_SESSION_STATUSES: Array<CallSession["status"]> = [
  "pending",
  "connecting",
  "connected",
];
const SEARCH_STALE_MS = 90_000;
const REMATCH_COOLDOWN_MS = 10 * 60_000;
const MAX_MATCH_TOPICS = 5;

const languageValues = new Set<string>(
  LANGUAGE_OPTIONS.map((option) => option.value),
);

const matchPreferencesInputSchema = z
  .object({
    vibe: z.string().trim().optional(),
    topics: z.array(z.string().trim().min(1).max(30)).max(8).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    countryMode: z.string().trim().optional(),
  })
  .optional();

const idleState = (): MatchmakingState => ({
  state: "idle",
  queue: null,
  session: null,
  partner: null,
});

function normalizeToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function uniqueCleanStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const clean: string[] = [];

  values.forEach((value) => {
    const trimmed = value?.trim();
    if (!trimmed) return;

    const key = normalizeToken(trimmed);
    if (seen.has(key)) return;

    seen.add(key);
    clean.push(trimmed);
  });

  return clean;
}

function normalizeMatchPreferences(
  input: unknown,
  profile?: Pick<Profile, "interests"> | null,
): MatchPreferences {
  const parsed = matchPreferencesInputSchema.safeParse(input);
  const raw = parsed.success ? parsed.data : undefined;
  const rawVibe = raw?.vibe ?? DEFAULT_MATCH_PREFERENCES.vibe;
  const rawLanguage = raw?.language ?? DEFAULT_MATCH_PREFERENCES.language;
  const rawCountryMode =
    raw?.countryMode ?? DEFAULT_MATCH_PREFERENCES.countryMode;
  const fallbackTopics = profile?.interests?.slice(0, 3) ?? [];

  return {
    vibe: (VIBE_OPTIONS as readonly string[]).includes(rawVibe)
      ? (rawVibe as VibeOption)
      : DEFAULT_MATCH_PREFERENCES.vibe,
    topics: uniqueCleanStrings(
      raw?.topics?.length ? raw.topics : fallbackTopics,
    ).slice(0, MAX_MATCH_TOPICS),
    language: languageValues.has(rawLanguage)
      ? rawLanguage
      : DEFAULT_MATCH_PREFERENCES.language,
    countryMode: (COUNTRY_MATCH_MODES as readonly string[]).includes(
      rawCountryMode,
    )
      ? (rawCountryMode as CountryMatchMode)
      : DEFAULT_MATCH_PREFERENCES.countryMode,
  };
}

function readQueuePreferences(
  queue: QueueEntry | null | undefined,
  profile?: Pick<Profile, "interests"> | null,
) {
  return normalizeMatchPreferences(queue?.preferences, profile);
}

function languageCompatible(a: MatchPreferences, b: MatchPreferences) {
  return (
    a.language === "Any" ||
    b.language === "Any" ||
    normalizeToken(a.language) === normalizeToken(b.language)
  );
}

function countryCompatible(
  currentProfile: Pick<Profile, "country"> | null,
  currentPreferences: MatchPreferences,
  candidateProfile: Pick<Profile, "country"> | null,
  candidatePreferences: MatchPreferences,
) {
  const requiresSameCountry =
    currentPreferences.countryMode === "same_country" ||
    candidatePreferences.countryMode === "same_country";

  if (!requiresSameCountry) return true;

  const currentCountry = normalizeToken(currentProfile?.country);
  const candidateCountry = normalizeToken(candidateProfile?.country);

  return !!currentCountry && currentCountry === candidateCountry;
}

function sharedTopicCount(
  currentProfile: Pick<Profile, "interests"> | null,
  currentPreferences: MatchPreferences,
  candidateProfile: Pick<Profile, "interests"> | null,
  candidatePreferences: MatchPreferences,
) {
  const currentTopics = uniqueCleanStrings([
    ...currentPreferences.topics,
    ...(currentProfile?.interests ?? []),
  ]).map(normalizeToken);
  const candidateTopics = new Set(
    uniqueCleanStrings([
      ...candidatePreferences.topics,
      ...(candidateProfile?.interests ?? []),
    ]).map(normalizeToken),
  );

  return currentTopics.filter((topic) => candidateTopics.has(topic)).length;
}

function preferencesCompatible(
  currentProfile: Pick<Profile, "country" | "interests"> | null,
  currentPreferences: MatchPreferences,
  candidateProfile: Pick<Profile, "country" | "interests"> | null,
  candidatePreferences: MatchPreferences,
) {
  return (
    languageCompatible(currentPreferences, candidatePreferences) &&
    countryCompatible(
      currentProfile,
      currentPreferences,
      candidateProfile,
      candidatePreferences,
    )
  );
}

function candidateScore(
  currentProfile: Pick<Profile, "country" | "interests"> | null,
  currentPreferences: MatchPreferences,
  candidateProfile: Pick<Profile, "country" | "interests"> | null,
  candidatePreferences: MatchPreferences,
) {
  let score = 0;

  if (
    currentPreferences.language !== "Any" &&
    normalizeToken(currentPreferences.language) ===
      normalizeToken(candidatePreferences.language)
  ) {
    score += 40;
  }

  if (
    normalizeToken(currentProfile?.country) &&
    normalizeToken(currentProfile?.country) ===
      normalizeToken(candidateProfile?.country)
  ) {
    score += 25;
  }

  if (currentPreferences.vibe === candidatePreferences.vibe) {
    score += 20;
  }

  score +=
    sharedTopicCount(
      currentProfile,
      currentPreferences,
      candidateProfile,
      candidatePreferences,
    ) * 12;

  return score;
}

async function getSupabaseAdminClient() {
  const { getSupabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  return getSupabaseAdmin();
}

function isActiveSession(session: CallSession | null): session is CallSession {
  return !!session && ACTIVE_SESSION_STATUSES.includes(session.status);
}

function getPartnerId(session: CallSession, userId: string) {
  return session.user_a === userId ? session.user_b : session.user_a;
}

async function getOwnQueueEntry(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("matchmaking_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getPartnerSummary(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, display_name, username, avatar_url, country, interests, presence, last_active_at",
    )
    .eq("id", userId)
    .eq("account_status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getSession(
  supabaseAdmin: SupabaseAdminClient,
  sessionId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("call_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function hydrateMatchState(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  queueEntry?: QueueEntry | null,
): Promise<MatchmakingState> {
  const queue = queueEntry ?? (await getOwnQueueEntry(supabaseAdmin, userId));
  if (!queue || queue.status === "cancelled") return idleState();

  if (queue.status === "matched" && queue.session_id) {
    const session = await getSession(supabaseAdmin, queue.session_id);
    if (isActiveSession(session)) {
      const partner = await getPartnerSummary(
        supabaseAdmin,
        getPartnerId(session, userId),
      );
      return {
        state: "matched",
        queue,
        session,
        partner,
      };
    }

    const { error: staleMatchError } = await supabaseAdmin
      .from("matchmaking_queue")
      .update({
        status: "cancelled",
        session_id: null,
        heartbeat_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (staleMatchError) throw new Error(staleMatchError.message);
    return idleState();
  }

  if (queue.status === "searching") {
    const heartbeatTime = Date.parse(queue.heartbeat_at);
    if (
      Number.isFinite(heartbeatTime) &&
      Date.now() - heartbeatTime < SEARCH_STALE_MS
    ) {
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from("matchmaking_queue")
        .update({ heartbeat_at: now })
        .eq("user_id", userId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      const { error: presenceError } = await supabaseAdmin
        .from("profiles")
        .update({ presence: "searching", last_active_at: now })
        .eq("id", userId);
      if (presenceError) throw new Error(presenceError.message);

      return {
        state: "searching",
        queue: data,
        session: null,
        partner: null,
      };
    }

    const { error: staleSearchError } = await supabaseAdmin
      .from("matchmaking_queue")
      .update({ status: "cancelled", heartbeat_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (staleSearchError) throw new Error(staleSearchError.message);
  }

  return idleState();
}

async function assertCanMatch(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<MatchableProfile> {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, profile_completed, account_status, country, interests")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.profile_completed) {
    throw new Error("Finish your profile before matching.");
  }
  if (profile.account_status !== "active") {
    throw new Error("This account is not ready for matching.");
  }

  return profile;
}

async function isCandidateAvailable(
  supabaseAdmin: SupabaseAdminClient,
  currentUserId: string,
  candidateUserId: string,
) {
  const now = new Date().toISOString();

  const [profileResult, blockedResult, cooldownResult] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("profile_completed, account_status")
      .eq("id", candidateUserId)
      .maybeSingle(),
    supabaseAdmin.rpc("is_blocked_pair", {
      _a: currentUserId,
      _b: candidateUserId,
    }),
    supabaseAdmin
      .from("match_cooldowns")
      .select("id")
      .eq("user_id", currentUserId)
      .eq("other_user_id", candidateUserId)
      .gt("expires_at", now)
      .limit(1),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (blockedResult.error) throw new Error(blockedResult.error.message);
  if (cooldownResult.error) throw new Error(cooldownResult.error.message);

  return (
    profileResult.data?.profile_completed === true &&
    profileResult.data.account_status === "active" &&
    blockedResult.data !== true &&
    (cooldownResult.data ?? []).length === 0
  );
}

async function tryCreateMatch(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
): Promise<MatchmakingState> {
  const staleCutoff = new Date(Date.now() - SEARCH_STALE_MS).toISOString();

  // Fast path: Atomic Matchmaking RPC (Requires Migration)
  // We try this first. If the RPC doesn't exist, we fallback to the old loop.
  const { data: atomicSession, error: rpcError } = await supabaseAdmin.rpc(
    // @ts-expect-error atomic_matchmaking is ahead of the generated types.
    "atomic_matchmaking",
    {
      p_user_id: userId,
      p_stale_cutoff: staleCutoff,
    },
  );

  if (!rpcError && atomicSession) {
    return hydrateMatchState(supabaseAdmin, userId);
  }

  const [currentQueue, currentProfileResult] = await Promise.all([
    getOwnQueueEntry(supabaseAdmin, userId),
    supabaseAdmin
      .from("profiles")
      .select("id, profile_completed, account_status, country, interests")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  if (currentProfileResult.error) {
    throw new Error(currentProfileResult.error.message);
  }

  const currentProfile = currentProfileResult.data;
  const currentPreferences = readQueuePreferences(currentQueue, currentProfile);

  // Fallback path: Manual matching loop
  const { data: candidates, error } = await supabaseAdmin
    .from("matchmaking_queue")
    .select("*")
    .eq("status", "searching")
    .is("session_id", null)
    .neq("user_id", userId)
    .gte("heartbeat_at", staleCutoff)
    .order("joined_at", { ascending: true })
    .limit(24);

  if (error) throw new Error(error.message);

  const candidateIds = (candidates ?? []).map((candidate) => candidate.user_id);
  const { data: candidateProfiles, error: candidateProfilesError } =
    candidateIds.length
      ? await supabaseAdmin
          .from("profiles")
          .select("id, profile_completed, account_status, country, interests")
          .in("id", candidateIds)
      : { data: [], error: null };

  if (candidateProfilesError) throw new Error(candidateProfilesError.message);

  const profileById = new Map(
    (candidateProfiles ?? []).map((profile) => [profile.id, profile]),
  );

  const rankedCandidates = (candidates ?? [])
    .map((candidate) => {
      const candidateProfile = profileById.get(candidate.user_id) ?? null;
      const candidatePreferences = readQueuePreferences(
        candidate,
        candidateProfile,
      );

      return {
        candidate,
        candidateProfile,
        score: preferencesCompatible(
          currentProfile,
          currentPreferences,
          candidateProfile,
          candidatePreferences,
        )
          ? candidateScore(
              currentProfile,
              currentPreferences,
              candidateProfile,
              candidatePreferences,
            )
          : -1,
      };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        Date.parse(a.candidate.joined_at) - Date.parse(b.candidate.joined_at)
      );
    });

  for (const { candidate } of rankedCandidates) {
    if (
      !(await isCandidateAvailable(supabaseAdmin, userId, candidate.user_id))
    ) {
      continue;
    }

    const now = new Date().toISOString();
    const { data: candidateClaimed, error: candidateClaimError } =
      await supabaseAdmin
        .from("matchmaking_queue")
        .update({ status: "matched", heartbeat_at: now })
        .eq("user_id", candidate.user_id)
        .eq("status", "searching")
        .is("session_id", null)
        .select("*")
        .maybeSingle();

    if (candidateClaimError) throw new Error(candidateClaimError.message);
    if (!candidateClaimed) continue;

    const { data: currentClaimed, error: currentClaimError } =
      await supabaseAdmin
        .from("matchmaking_queue")
        .update({ status: "matched", heartbeat_at: now })
        .eq("user_id", userId)
        .eq("status", "searching")
        .is("session_id", null)
        .select("*")
        .maybeSingle();

    if (currentClaimError) throw new Error(currentClaimError.message);
    if (!currentClaimed) {
      const { error: releaseError } = await supabaseAdmin
        .from("matchmaking_queue")
        .update({ status: "searching", heartbeat_at: now })
        .eq("user_id", candidate.user_id)
        .eq("status", "matched")
        .is("session_id", null);
      if (releaseError) throw new Error(releaseError.message);
      continue;
    }

    const roomName = `lume-${crypto.randomUUID()}`;
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("call_sessions")
      .insert({
        room_name: roomName,
        user_a: candidate.user_id,
        user_b: userId,
        status: "connecting",
      })
      .select("*")
      .single();

    if (sessionError) {
      const { error: releaseError } = await supabaseAdmin
        .from("matchmaking_queue")
        .update({ status: "searching", heartbeat_at: now })
        .in("user_id", [userId, candidate.user_id])
        .eq("status", "matched")
        .is("session_id", null);
      if (releaseError) throw new Error(releaseError.message);
      continue;
    }

    const [currentQueue, candidateQueue, presenceUpdate] = await Promise.all([
      supabaseAdmin
        .from("matchmaking_queue")
        .update({
          status: "matched",
          session_id: session.id,
          heartbeat_at: now,
        })
        .eq("user_id", userId)
        .select("*")
        .single(),
      supabaseAdmin
        .from("matchmaking_queue")
        .update({
          status: "matched",
          session_id: session.id,
          heartbeat_at: now,
        })
        .eq("user_id", candidate.user_id)
        .select("*")
        .single(),
      supabaseAdmin
        .from("profiles")
        .update({ presence: "in_call", last_active_at: now })
        .in("id", [userId, candidate.user_id]),
    ]);

    if (currentQueue.error) throw new Error(currentQueue.error.message);
    if (candidateQueue.error) throw new Error(candidateQueue.error.message);
    if (presenceUpdate.error) throw new Error(presenceUpdate.error.message);

    const expiresAt = new Date(Date.now() + REMATCH_COOLDOWN_MS).toISOString();
    const { error: cooldownError } = await supabaseAdmin
      .from("match_cooldowns")
      .upsert(
        [
          {
            user_id: userId,
            other_user_id: candidate.user_id,
            expires_at: expiresAt,
          },
          {
            user_id: candidate.user_id,
            other_user_id: userId,
            expires_at: expiresAt,
          },
        ],
        { onConflict: "user_id,other_user_id" },
      );
    if (cooldownError) throw new Error(cooldownError.message);

    const partner = await getPartnerSummary(supabaseAdmin, candidate.user_id);
    return {
      state: "matched",
      queue: currentQueue.data,
      session,
      partner,
    };
  }

  const queue = await getOwnQueueEntry(supabaseAdmin, userId);
  return queue ? hydrateMatchState(supabaseAdmin, userId, queue) : idleState();
}

export const getMatchmakingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MatchmakingState> => {
    const supabaseAdmin = await getSupabaseAdminClient();
    const state = await hydrateMatchState(supabaseAdmin, context.userId);

    if (state.state === "searching") {
      return tryCreateMatch(supabaseAdmin, context.userId);
    }

    return state;
  });

export const startMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => normalizeMatchPreferences(input))
  .handler(async ({ data, context }): Promise<MatchmakingState> => {
    const supabaseAdmin = await getSupabaseAdminClient();
    const profile = await assertCanMatch(supabaseAdmin, context.userId);
    const preferences = normalizeMatchPreferences(data, profile);

    const existingState = await hydrateMatchState(
      supabaseAdmin,
      context.userId,
    );
    if (existingState.state === "matched") return existingState;

    const now = new Date().toISOString();
    const joinedAt =
      existingState.state === "searching" ? existingState.queue.joined_at : now;

    const { error } = await supabaseAdmin.from("matchmaking_queue").upsert(
      {
        user_id: context.userId,
        status: "searching",
        session_id: null,
        preferences,
        joined_at: joinedAt,
        heartbeat_at: now,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    const { error: presenceError } = await supabaseAdmin
      .from("profiles")
      .update({ presence: "searching", last_active_at: now })
      .eq("id", context.userId);
    if (presenceError) throw new Error(presenceError.message);

    return tryCreateMatch(supabaseAdmin, context.userId);
  });

export const cancelMatching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MatchmakingState> => {
    const supabaseAdmin = await getSupabaseAdminClient();
    const queue = await getOwnQueueEntry(supabaseAdmin, context.userId);
    if (!queue || queue.status !== "searching") {
      return hydrateMatchState(supabaseAdmin, context.userId, queue);
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("matchmaking_queue")
      .update({ status: "cancelled", session_id: null, heartbeat_at: now })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    const { error: presenceError } = await supabaseAdmin
      .from("profiles")
      .update({ presence: "online", last_active_at: now })
      .eq("id", context.userId);
    if (presenceError) throw new Error(presenceError.message);

    return idleState();
  });

export const endCurrentMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MatchmakingState> => {
    const supabaseAdmin = await getSupabaseAdminClient();
    const queue = await getOwnQueueEntry(supabaseAdmin, context.userId);
    if (!queue?.session_id) return idleState();

    const session = await getSession(supabaseAdmin, queue.session_id);
    if (!session) return idleState();

    const now = new Date().toISOString();
    const participantIds = [session.user_a, session.user_b];
    const startedAt = Date.parse(session.started_at);
    const durationSeconds = Number.isFinite(startedAt)
      ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      : null;

    const [sessionUpdate, queueUpdate, profileUpdate] = await Promise.all([
      supabaseAdmin
        .from("call_sessions")
        .update({
          status: "ended",
          ended_at: now,
          ended_by: context.userId,
          end_reason: "user_left",
          duration_seconds: durationSeconds,
        })
        .eq("id", session.id),
      supabaseAdmin
        .from("matchmaking_queue")
        .update({ status: "cancelled", heartbeat_at: now })
        .eq("session_id", session.id),
      supabaseAdmin
        .from("profiles")
        .update({ presence: "online", last_active_at: now })
        .in("id", participantIds),
    ]);

    if (sessionUpdate.error) throw new Error(sessionUpdate.error.message);
    if (queueUpdate.error) throw new Error(queueUpdate.error.message);
    if (profileUpdate.error) throw new Error(profileUpdate.error.message);

    return idleState();
  });
