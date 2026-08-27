import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Tables } from "@/integrations/supabase/types";

type SupabaseAdminClient = SupabaseClient<Database, "public", "public">;
type Profile = Tables<"profiles">;
type QueueEntry = Tables<"matchmaking_queue">;
type CallSession = Tables<"call_sessions">;

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

const idleState = (): MatchmakingState => ({
  state: "idle",
  queue: null,
  session: null,
  partner: null,
});

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
) {
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("profile_completed, account_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.profile_completed) {
    throw new Error("Finish your profile before matching.");
  }
  if (profile.account_status !== "active") {
    throw new Error("This account is not ready for matching.");
  }
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
    // @ts-ignore: atomic_matchmaking might not be in the generated types yet
    "atomic_matchmaking",
    {
      p_user_id: userId,
      p_stale_cutoff: staleCutoff,
    }
  );

  if (!rpcError && atomicSession) {
    return hydrateMatchState(supabaseAdmin, userId);
  }

  // Fallback path: Manual matching loop
  const { data: candidates, error } = await supabaseAdmin
    .from("matchmaking_queue")
    .select("*")
    .eq("status", "searching")
    .is("session_id", null)
    .neq("user_id", userId)
    .gte("heartbeat_at", staleCutoff)
    .order("joined_at", { ascending: true })
    .limit(8);

  if (error) throw new Error(error.message);

  for (const candidate of candidates ?? []) {
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
  .handler(async ({ context }): Promise<MatchmakingState> => {
    const supabaseAdmin = await getSupabaseAdminClient();
    await assertCanMatch(supabaseAdmin, context.userId);

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
