import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReportReason } from "@/types/models";

const REPORT_REASONS = [
  "harassment",
  "sexual_content",
  "nudity",
  "spam",
  "scam",
  "hate",
  "underage",
  "other",
] as const;

const safetyReportSchema = z.object({
  sessionId: z.string().uuid(),
  reportedId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional().default(""),
  block: z.boolean().default(false),
});

export const fileSafetyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => safetyReportSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { getSupabaseAdmin } =
      await import("@/integrations/supabase/client.server");
    const supabaseAdmin = await getSupabaseAdmin();

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("call_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();

    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("This call session could not be found.");

    const currentUserIsParticipant =
      session.user_a === context.userId || session.user_b === context.userId;
    const partnerId =
      session.user_a === context.userId ? session.user_b : session.user_a;

    if (!currentUserIsParticipant || data.reportedId !== partnerId) {
      throw new Error("You can only report the person in your current call.");
    }

    const { data: report, error: reportError } = await supabaseAdmin
      .from("reports")
      .insert({
        reporter_id: context.userId,
        reported_id: data.reportedId,
        session_id: data.sessionId,
        reason: data.reason as ReportReason,
        details: data.details || null,
      })
      .select("id")
      .single();

    if (reportError) throw new Error(reportError.message);

    if (!data.block) {
      return { ok: true, reportId: report.id, blocked: false };
    }

    const now = new Date().toISOString();
    const startedAt = Date.parse(session.started_at);
    const durationSeconds = Number.isFinite(startedAt)
      ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
      : null;

    const [blockResult, sessionUpdate, queueUpdate, profileUpdate] =
      await Promise.all([
        supabaseAdmin.from("blocks").upsert(
          {
            blocker_id: context.userId,
            blocked_id: data.reportedId,
          },
          { onConflict: "blocker_id,blocked_id" },
        ),
        supabaseAdmin
          .from("call_sessions")
          .update({
            status: "ended",
            ended_at: now,
            ended_by: context.userId,
            end_reason: "safety_block",
            duration_seconds: durationSeconds,
          })
          .eq("id", data.sessionId),
        supabaseAdmin
          .from("matchmaking_queue")
          .update({
            status: "cancelled",
            heartbeat_at: now,
          })
          .eq("session_id", data.sessionId),
        supabaseAdmin
          .from("profiles")
          .update({ presence: "online", last_active_at: now })
          .in("id", [session.user_a, session.user_b]),
      ]);

    if (blockResult.error) throw new Error(blockResult.error.message);
    if (sessionUpdate.error) throw new Error(sessionUpdate.error.message);
    if (queueUpdate.error) throw new Error(queueUpdate.error.message);
    if (profileUpdate.error) throw new Error(profileUpdate.error.message);

    return { ok: true, reportId: report.id, blocked: true };
  });
