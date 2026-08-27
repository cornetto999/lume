-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('user', 'moderator', 'admin');
CREATE TYPE public.presence_status AS ENUM ('offline', 'online', 'searching', 'in_call', 'away');
CREATE TYPE public.account_status AS ENUM ('pending_profile', 'active', 'suspended', 'banned', 'deleted');
CREATE TYPE public.gender_type AS ENUM ('female', 'male', 'non_binary', 'other', 'prefer_not_to_say');
CREATE TYPE public.queue_status AS ENUM ('searching', 'matched', 'cancelled');
CREATE TYPE public.call_status AS ENUM ('pending', 'connecting', 'connected', 'ended', 'failed');
CREATE TYPE public.report_reason AS ENUM ('harassment', 'sexual_content', 'nudity', 'spam', 'scam', 'hate', 'underage', 'other');
CREATE TYPE public.report_status AS ENUM ('open', 'reviewing', 'actioned', 'dismissed');
CREATE TYPE public.moderation_action_type AS ENUM ('warn', 'suspend', 'ban', 'unban', 'terminate_session', 'dismiss_report');

-- ============ SHARED TRIGGER FN ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  username TEXT UNIQUE,
  avatar_url TEXT,
  date_of_birth DATE,
  gender public.gender_type,
  country TEXT,
  bio TEXT,
  interests TEXT[] NOT NULL DEFAULT '{}',
  presence public.presence_status NOT NULL DEFAULT 'offline',
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_status public.account_status NOT NULL DEFAULT 'pending_profile',
  profile_completed BOOLEAN NOT NULL DEFAULT false,
  suspended_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,24}$'),
  CONSTRAINT profiles_bio_len CHECK (bio IS NULL OR char_length(bio) <= 240),
  CONSTRAINT profiles_display_name_len CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 40),
  CONSTRAINT profiles_interests_len CHECK (array_length(interests, 1) IS NULL OR array_length(interests, 1) <= 12)
);
CREATE INDEX profiles_presence_idx ON public.profiles (presence);
CREATE INDEX profiles_account_status_idx ON public.profiles (account_status);
CREATE INDEX profiles_last_active_idx ON public.profiles (last_active_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','moderator'));
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Prevent self-escalation of privileged profile columns
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.account_status := OLD.account_status;
  NEW.suspended_until := OLD.suspended_until;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END; $$;
CREATE TRIGGER profiles_guard BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Safe public projection of profiles (no DOB, no email, no moderation state)
CREATE VIEW public.public_profiles
WITH (security_invoker = false) AS
SELECT
  p.id,
  p.display_name,
  p.username,
  p.avatar_url,
  p.country,
  p.gender,
  p.bio,
  p.interests,
  p.presence,
  p.last_active_at,
  CASE WHEN p.date_of_birth IS NULL THEN NULL
       ELSE date_part('year', age(p.date_of_birth))::int END AS age
FROM public.profiles p
WHERE p.account_status = 'active';
GRANT SELECT ON public.public_profiles TO authenticated;

-- ============ BLOCKS ============
CREATE TABLE public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON public.blocks (blocked_id);
GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;
GRANT ALL ON public.blocks TO service_role;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own blocks" ON public.blocks FOR SELECT TO authenticated
USING (blocker_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Users create own blocks" ON public.blocks FOR INSERT TO authenticated
WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "Users delete own blocks" ON public.blocks FOR DELETE TO authenticated
USING (blocker_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_blocked_pair(_a UUID, _b UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = _a AND blocked_id = _b) OR (blocker_id = _b AND blocked_id = _a)
  );
$$;

-- ============ MATCHMAKING ============
CREATE TABLE public.matchmaking_queue (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.queue_status NOT NULL DEFAULT 'searching',
  session_id UUID,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX matchmaking_queue_search_idx ON public.matchmaking_queue (status, joined_at);
CREATE INDEX matchmaking_queue_heartbeat_idx ON public.matchmaking_queue (heartbeat_at);
GRANT SELECT ON public.matchmaking_queue TO authenticated;
GRANT ALL ON public.matchmaking_queue TO service_role;
ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER matchmaking_queue_updated_at BEFORE UPDATE ON public.matchmaking_queue
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Users read own queue entry" ON public.matchmaking_queue FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE public.match_cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  other_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, other_user_id)
);
CREATE INDEX match_cooldowns_expiry_idx ON public.match_cooldowns (expires_at);
GRANT SELECT ON public.match_cooldowns TO authenticated;
GRANT ALL ON public.match_cooldowns TO service_role;
ALTER TABLE public.match_cooldowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own cooldowns" ON public.match_cooldowns FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- ============ CALL SESSIONS ============
CREATE TABLE public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name TEXT NOT NULL UNIQUE,
  user_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.call_status NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  ended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  end_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT call_sessions_distinct_users CHECK (user_a <> user_b)
);
CREATE INDEX call_sessions_user_a_idx ON public.call_sessions (user_a, started_at DESC);
CREATE INDEX call_sessions_user_b_idx ON public.call_sessions (user_b, started_at DESC);
CREATE INDEX call_sessions_status_idx ON public.call_sessions (status);
GRANT SELECT ON public.call_sessions TO authenticated;
GRANT ALL ON public.call_sessions TO service_role;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER call_sessions_updated_at BEFORE UPDATE ON public.call_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Participants read own sessions" ON public.call_sessions FOR SELECT TO authenticated
USING (user_a = auth.uid() OR user_b = auth.uid() OR public.is_staff(auth.uid()));

ALTER TABLE public.matchmaking_queue
  ADD CONSTRAINT matchmaking_queue_session_fk FOREIGN KEY (session_id)
  REFERENCES public.call_sessions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_session_participant(_session_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.call_sessions
    WHERE id = _session_id AND (user_a = _user_id OR user_b = _user_id)
  );
$$;

-- ============ MESSAGES ============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT messages_body_len CHECK (char_length(body) BETWEEN 1 AND 500)
);
CREATE INDEX messages_session_idx ON public.messages (session_id, created_at);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants read session messages" ON public.messages FOR SELECT TO authenticated
USING (public.is_session_participant(session_id, auth.uid()) OR public.is_staff(auth.uid()));
CREATE POLICY "Participants send session messages" ON public.messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.is_session_participant(session_id, auth.uid()));

-- ============ REPORTS ============
CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,
  reason public.report_reason NOT NULL,
  details TEXT,
  status public.report_status NOT NULL DEFAULT 'open',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_no_self CHECK (reporter_id <> reported_id),
  CONSTRAINT reports_details_len CHECK (details IS NULL OR char_length(details) <= 1000)
);
CREATE INDEX reports_status_idx ON public.reports (status, created_at DESC);
CREATE INDEX reports_reported_idx ON public.reports (reported_id);
GRANT SELECT, INSERT ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER reports_updated_at BEFORE UPDATE ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "Reporters read own reports" ON public.reports FOR SELECT TO authenticated
USING (reporter_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "Users file own reports" ON public.reports FOR INSERT TO authenticated
WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "Staff update reports" ON public.reports FOR UPDATE TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ============ NOTIFICATIONS ============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- ============ USER DEVICES ============
CREATE TABLE public.user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'web',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_devices_user_idx ON public.user_devices (user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO authenticated;
GRANT ALL ON public.user_devices TO service_role;
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own devices" ON public.user_devices FOR ALL TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============ MODERATION ============
CREATE TABLE public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action public.moderation_action_type NOT NULL,
  reason TEXT,
  report_id UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON public.moderation_actions (target_user_id, created_at DESC);
GRANT SELECT ON public.moderation_actions TO authenticated;
GRANT ALL ON public.moderation_actions TO service_role;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read moderation actions" ON public.moderation_actions FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR target_user_id = auth.uid());

CREATE TABLE public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
GRANT SELECT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit logs" ON public.admin_audit_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============ REALTIME ============
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.matchmaking_queue REPLICA IDENTITY FULL;
ALTER TABLE public.call_sessions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matchmaking_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_sessions;