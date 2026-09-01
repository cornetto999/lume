import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  Database,
  Json,
  Tables,
  TablesInsert,
} from "@/integrations/supabase/types";
import type {
  CallConnectionState,
  ConnectionRequestState,
  ConnectionStatus,
  DirectMessage,
  PublicProfile,
  SocialConnection,
  SocialSummary,
} from "@/types/models";

type SupabaseAdminClient = SupabaseClient<Database, "public", "public">;
type ConnectionRow = Tables<"connections">;
type DirectMessageRow = Tables<"direct_messages">;
type NotificationRow = Tables<"notifications">;
type NotificationInsert = TablesInsert<"notifications">;
type ProfileRow = Pick<
  Tables<"profiles">,
  | "id"
  | "display_name"
  | "username"
  | "avatar_url"
  | "country"
  | "gender"
  | "bio"
  | "interests"
  | "presence"
  | "last_active_at"
>;

const ACTIVE_CONNECTION_STATUSES = ["pending", "accepted"] as const;
const SOCIAL_MESSAGE_LIMIT = 120;
const SOCIAL_NOTIFICATION_LIMIT = 30;

const callRequestSchema = z.object({
  sessionId: z.string().uuid(),
  partnerId: z.string().uuid(),
});

const respondSchema = z.object({
  connectionId: z.string().uuid(),
  action: z.enum(["accept", "decline"]),
});

const connectionMessageSchema = z.object({
  connectionId: z.string().uuid(),
  body: z.string().trim().min(1).max(500),
});

const connectionReadSchema = z.object({
  connectionId: z.string().uuid(),
});

async function getAdmin() {
  const { getSupabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  return getSupabaseAdmin();
}

function connectionPairFilter(userId: string, otherUserId: string) {
  return `and(requester_id.eq.${userId},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${userId})`;
}

function getOtherUserId(connection: ConnectionRow, userId: string) {
  return connection.requester_id === userId
    ? connection.addressee_id
    : connection.requester_id;
}

function getConnectionDirection(
  connection: ConnectionRow,
  userId: string,
): SocialConnection["direction"] {
  if (connection.status === "accepted") return "accepted";
  return connection.addressee_id === userId ? "incoming" : "outgoing";
}

function getRequestState(
  connection: ConnectionRow | null,
  userId: string,
): ConnectionRequestState {
  if (!connection) return "none";
  if (connection.status === "accepted") return "accepted";
  if (connection.status !== "pending") return "none";
  return connection.addressee_id === userId
    ? "pending_incoming"
    : "pending_outgoing";
}

function toPublicProfile(
  profile: ProfileRow | null | undefined,
): PublicProfile | null {
  if (!profile) return null;

  return {
    id: profile.id,
    display_name: profile.display_name,
    username: profile.username,
    avatar_url: profile.avatar_url,
    country: profile.country,
    gender: profile.gender,
    bio: profile.bio,
    interests: profile.interests,
    presence: profile.presence,
    last_active_at: profile.last_active_at,
    age: null,
  };
}

function getProfileName(profile: PublicProfile | null, fallback = "Someone") {
  return profile?.display_name || profile?.username || fallback;
}

function getMessageTime(message: DirectMessageRow | null | undefined) {
  return message ? Date.parse(message.created_at) || 0 : 0;
}

function getConnectionActivityTime(connection: SocialConnection) {
  return (
    getMessageTime(connection.lastMessage) ||
    Date.parse(connection.responded_at ?? connection.requested_at) ||
    0
  );
}

function sortConnectionSummaries(connections: SocialConnection[]) {
  return [...connections].sort(
    (a, b) => getConnectionActivityTime(b) - getConnectionActivityTime(a),
  );
}

async function loadProfileMap(
  supabaseAdmin: SupabaseAdminClient,
  userIds: string[],
) {
  const uniqueIds = Array.from(new Set(userIds)).filter(Boolean);
  if (uniqueIds.length === 0) return new Map<string, PublicProfile>();

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, display_name, username, avatar_url, country, gender, bio, interests, presence, last_active_at",
    )
    .in("id", uniqueIds);

  if (error) throw new Error(error.message);

  return new Map(
    ((data ?? []) as ProfileRow[]).map((profile) => [
      profile.id,
      toPublicProfile(profile),
    ]),
  );
}

async function notify(
  supabaseAdmin: SupabaseAdminClient,
  notifications: NotificationInsert[],
) {
  if (notifications.length === 0) return;

  const { error } = await supabaseAdmin
    .from("notifications")
    .insert(notifications);
  if (error) throw new Error(error.message);
}

async function findActiveConnection(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  otherUserId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("connections")
    .select("*")
    .or(connectionPairFilter(userId, otherUserId))
    .in("status", [...ACTIVE_CONNECTION_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

async function assertCallPartner(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  sessionId: string,
  partnerId: string,
) {
  const { data: session, error } = await supabaseAdmin
    .from("call_sessions")
    .select("id, user_a, user_b, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!session) throw new Error("This call is no longer available.");

  const isParticipant = session.user_a === userId || session.user_b === userId;
  const isPartner =
    (session.user_a === userId && session.user_b === partnerId) ||
    (session.user_b === userId && session.user_a === partnerId);

  if (!isParticipant || !isPartner) {
    throw new Error("You can only add the person in your active call.");
  }

  if (session.status === "ended" || session.status === "failed") {
    throw new Error("This call has already ended.");
  }
}

async function assertConnectionParticipant(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  connectionId: string,
) {
  const { data: connection, error } = await supabaseAdmin
    .from("connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!connection) throw new Error("Connection not found.");
  if (
    connection.requester_id !== userId &&
    connection.addressee_id !== userId
  ) {
    throw new Error("You do not have access to this connection.");
  }

  return connection;
}

async function buildConnectionSummaries(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  connections: ConnectionRow[],
) {
  const profiles = await loadProfileMap(
    supabaseAdmin,
    connections.map((connection) => getOtherUserId(connection, userId)),
  );
  const acceptedConnectionIds = connections
    .filter((connection) => connection.status === "accepted")
    .map((connection) => connection.id);
  const unreadByConnection = new Map<string, number>();
  const lastMessageByConnection = new Map<string, DirectMessageRow>();
  let messages: DirectMessageRow[] = [];

  if (acceptedConnectionIds.length > 0) {
    const [recentMessages, unreadMessages] = await Promise.all([
      supabaseAdmin
        .from("direct_messages")
        .select("*")
        .in("connection_id", acceptedConnectionIds)
        .order("created_at", { ascending: false })
        .limit(SOCIAL_MESSAGE_LIMIT),
      supabaseAdmin
        .from("direct_messages")
        .select("id, connection_id")
        .in("connection_id", acceptedConnectionIds)
        .eq("recipient_id", userId)
        .is("read_at", null),
    ]);

    if (recentMessages.error) throw new Error(recentMessages.error.message);
    if (unreadMessages.error) throw new Error(unreadMessages.error.message);

    (recentMessages.data ?? []).forEach((message) => {
      if (!lastMessageByConnection.has(message.connection_id)) {
        lastMessageByConnection.set(message.connection_id, message);
      }
    });

    (unreadMessages.data ?? []).forEach((message) => {
      unreadByConnection.set(
        message.connection_id,
        (unreadByConnection.get(message.connection_id) ?? 0) + 1,
      );
    });

    messages = [...(recentMessages.data ?? [])].reverse();
  }

  const summaries = connections.map((connection): SocialConnection => {
    const otherUserId = getOtherUserId(connection, userId);
    return {
      id: connection.id,
      requester_id: connection.requester_id,
      addressee_id: connection.addressee_id,
      session_id: connection.session_id,
      status: connection.status as ConnectionStatus,
      direction: getConnectionDirection(connection, userId),
      requested_at: connection.requested_at,
      responded_at: connection.responded_at,
      otherUser: profiles.get(otherUserId) ?? null,
      lastMessage: lastMessageByConnection.get(connection.id) ?? null,
      unreadCount: unreadByConnection.get(connection.id) ?? 0,
    };
  });

  return { summaries, messages };
}

async function buildCallConnectionState(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  connection: ConnectionRow | null,
): Promise<CallConnectionState> {
  if (!connection) return { state: "none", connection: null };

  const { summaries } = await buildConnectionSummaries(supabaseAdmin, userId, [
    connection,
  ]);

  return {
    state: getRequestState(connection, userId),
    connection: summaries[0] ?? null,
  };
}

async function insertConnectionRequestNotification(
  supabaseAdmin: SupabaseAdminClient,
  connection: ConnectionRow,
  requesterProfile: PublicProfile | null,
) {
  const requesterName = getProfileName(requesterProfile, "Your match");

  await notify(supabaseAdmin, [
    {
      user_id: connection.addressee_id,
      type: "connection_request",
      title: `${requesterName} wants to add you`,
      body: "Confirm to save them and unlock messages.",
      data: {
        connectionId: connection.id,
        requesterId: connection.requester_id,
        sessionId: connection.session_id,
      } satisfies Json,
    },
  ]);
}

async function insertAcceptedNotifications(
  supabaseAdmin: SupabaseAdminClient,
  connection: ConnectionRow,
  accepterProfile: PublicProfile | null,
  requesterProfile: PublicProfile | null,
) {
  const accepterName = getProfileName(accepterProfile, "Your match");
  const requesterName = getProfileName(requesterProfile, "Your match");
  const data = {
    connectionId: connection.id,
    requesterId: connection.requester_id,
    addresseeId: connection.addressee_id,
    sessionId: connection.session_id,
  } satisfies Json;

  await notify(supabaseAdmin, [
    {
      user_id: connection.requester_id,
      type: "connection_accepted",
      title: `${accepterName} accepted your request`,
      body: "You can message each other from Lume Messages.",
      data,
    },
    {
      user_id: connection.addressee_id,
      type: "connection_accepted",
      title: `You and ${requesterName} are connected`,
      body: "You can message each other from Lume Messages.",
      data,
    },
  ]);
}

export const getSocialSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SocialSummary> => {
    const supabaseAdmin = await getAdmin();

    const [connectionsResult, notificationsResult] = await Promise.all([
      supabaseAdmin
        .from("connections")
        .select("*")
        .or(
          `requester_id.eq.${context.userId},addressee_id.eq.${context.userId}`,
        )
        .in("status", [...ACTIVE_CONNECTION_STATUSES])
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("notifications")
        .select("*")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(SOCIAL_NOTIFICATION_LIMIT),
    ]);

    if (connectionsResult.error) {
      throw new Error(connectionsResult.error.message);
    }
    if (notificationsResult.error) {
      throw new Error(notificationsResult.error.message);
    }

    const { summaries, messages } = await buildConnectionSummaries(
      supabaseAdmin,
      context.userId,
      connectionsResult.data ?? [],
    );
    const notifications = (notificationsResult.data ?? []) as NotificationRow[];

    return {
      connections: sortConnectionSummaries(
        summaries.filter((connection) => connection.status === "accepted"),
      ),
      pendingRequests: sortConnectionSummaries(
        summaries.filter((connection) => connection.status === "pending"),
      ),
      messages: messages as DirectMessage[],
      notifications,
      unreadMessages: summaries.reduce(
        (total, connection) => total + connection.unreadCount,
        0,
      ),
      unreadNotifications: notifications.filter(
        (notification) => !notification.read_at,
      ).length,
    };
  });

export const getCallConnectionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => callRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<CallConnectionState> => {
    const supabaseAdmin = await getAdmin();
    await assertCallPartner(
      supabaseAdmin,
      context.userId,
      data.sessionId,
      data.partnerId,
    );

    const connection = await findActiveConnection(
      supabaseAdmin,
      context.userId,
      data.partnerId,
    );

    return buildCallConnectionState(supabaseAdmin, context.userId, connection);
  });

export const requestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => callRequestSchema.parse(input))
  .handler(async ({ data, context }): Promise<CallConnectionState> => {
    const supabaseAdmin = await getAdmin();
    await assertCallPartner(
      supabaseAdmin,
      context.userId,
      data.sessionId,
      data.partnerId,
    );

    const profiles = await loadProfileMap(supabaseAdmin, [
      context.userId,
      data.partnerId,
    ]);
    const currentProfile = profiles.get(context.userId) ?? null;
    const partnerProfile = profiles.get(data.partnerId) ?? null;
    const existingConnection = await findActiveConnection(
      supabaseAdmin,
      context.userId,
      data.partnerId,
    );

    if (existingConnection?.status === "accepted") {
      return buildCallConnectionState(
        supabaseAdmin,
        context.userId,
        existingConnection,
      );
    }

    if (existingConnection?.status === "pending") {
      if (existingConnection.addressee_id !== context.userId) {
        return buildCallConnectionState(
          supabaseAdmin,
          context.userId,
          existingConnection,
        );
      }

      const { data: accepted, error } = await supabaseAdmin
        .from("connections")
        .update({
          status: "accepted",
          responded_at: new Date().toISOString(),
        })
        .eq("id", existingConnection.id)
        .select("*")
        .single();

      if (error) throw new Error(error.message);

      await insertAcceptedNotifications(
        supabaseAdmin,
        accepted,
        currentProfile,
        partnerProfile,
      );

      return buildCallConnectionState(supabaseAdmin, context.userId, accepted);
    }

    const { data: requested, error } = await supabaseAdmin
      .from("connections")
      .insert({
        requester_id: context.userId,
        addressee_id: data.partnerId,
        session_id: data.sessionId,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await insertConnectionRequestNotification(
      supabaseAdmin,
      requested,
      currentProfile,
    );

    return buildCallConnectionState(supabaseAdmin, context.userId, requested);
  });

export const respondConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => respondSchema.parse(input))
  .handler(async ({ data, context }): Promise<CallConnectionState> => {
    const supabaseAdmin = await getAdmin();
    const connection = await assertConnectionParticipant(
      supabaseAdmin,
      context.userId,
      data.connectionId,
    );

    if (connection.status !== "pending") {
      return buildCallConnectionState(
        supabaseAdmin,
        context.userId,
        connection,
      );
    }

    if (connection.addressee_id !== context.userId) {
      throw new Error("Only the person who receives a request can confirm it.");
    }

    const status = data.action === "accept" ? "accepted" : "declined";
    const { data: updated, error } = await supabaseAdmin
      .from("connections")
      .update({
        status,
        responded_at: new Date().toISOString(),
      })
      .eq("id", data.connectionId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    if (data.action === "accept") {
      const profiles = await loadProfileMap(supabaseAdmin, [
        updated.requester_id,
        updated.addressee_id,
      ]);
      await insertAcceptedNotifications(
        supabaseAdmin,
        updated,
        profiles.get(updated.addressee_id) ?? null,
        profiles.get(updated.requester_id) ?? null,
      );
    }

    return buildCallConnectionState(
      supabaseAdmin,
      context.userId,
      data.action === "accept" ? updated : null,
    );
  });

export const sendConnectionMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => connectionMessageSchema.parse(input))
  .handler(async ({ data, context }): Promise<DirectMessage> => {
    const supabaseAdmin = await getAdmin();
    const connection = await assertConnectionParticipant(
      supabaseAdmin,
      context.userId,
      data.connectionId,
    );

    if (connection.status !== "accepted") {
      throw new Error("Both people need to confirm before messaging.");
    }

    const recipientId = getOtherUserId(connection, context.userId);
    const profiles = await loadProfileMap(supabaseAdmin, [
      context.userId,
      recipientId,
    ]);
    const senderName = getProfileName(
      profiles.get(context.userId) ?? null,
      "A connection",
    );

    const { data: message, error } = await supabaseAdmin
      .from("direct_messages")
      .insert({
        connection_id: data.connectionId,
        sender_id: context.userId,
        recipient_id: recipientId,
        body: data.body,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await notify(supabaseAdmin, [
      {
        user_id: recipientId,
        type: "direct_message",
        title: `${senderName} sent you a message`,
        body: data.body.slice(0, 120),
        data: {
          connectionId: data.connectionId,
          messageId: message.id,
          senderId: context.userId,
        } satisfies Json,
      },
    ]);

    return message;
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await getAdmin();
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("read_at", null);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markConnectionMessagesRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => connectionReadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getAdmin();
    const connection = await assertConnectionParticipant(
      supabaseAdmin,
      context.userId,
      data.connectionId,
    );

    if (connection.status !== "accepted") {
      throw new Error("Messages are only available after both people confirm.");
    }

    const { error } = await supabaseAdmin
      .from("direct_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("connection_id", data.connectionId)
      .eq("recipient_id", context.userId)
      .is("read_at", null);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
