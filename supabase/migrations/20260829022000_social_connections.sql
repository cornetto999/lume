-- Mutual connections created during calls, plus messages after both users confirm.
CREATE TABLE public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT connections_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT connections_status_check CHECK (
    status IN ('pending', 'accepted', 'declined', 'cancelled')
  )
);

CREATE UNIQUE INDEX connections_active_pair_idx
ON public.connections (
  LEAST(requester_id::text, addressee_id::text),
  GREATEST(requester_id::text, addressee_id::text)
)
WHERE status IN ('pending', 'accepted');

CREATE INDEX connections_requester_idx ON public.connections (requester_id, status, updated_at DESC);
CREATE INDEX connections_addressee_idx ON public.connections (addressee_id, status, updated_at DESC);
CREATE TRIGGER connections_updated_at BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.connections TO authenticated;
GRANT ALL ON public.connections TO service_role;
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own connections" ON public.connections FOR SELECT TO authenticated
USING (requester_id = auth.uid() OR addressee_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_connection_participant(_connection_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connections
    WHERE id = _connection_id
      AND status = 'accepted'
      AND (requester_id = _user_id OR addressee_id = _user_id)
  );
$$;

CREATE TABLE public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_no_self CHECK (sender_id <> recipient_id),
  CONSTRAINT direct_messages_body_len CHECK (char_length(body) BETWEEN 1 AND 500)
);

CREATE INDEX direct_messages_connection_idx ON public.direct_messages (connection_id, created_at);
CREATE INDEX direct_messages_recipient_unread_idx
ON public.direct_messages (recipient_id, read_at, created_at DESC);

GRANT SELECT ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Connected users read direct messages" ON public.direct_messages FOR SELECT TO authenticated
USING (public.is_connection_participant(connection_id, auth.uid()) OR public.is_staff(auth.uid()));

REVOKE ALL ON FUNCTION public.is_connection_participant(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_connection_participant(UUID, UUID) TO authenticated, service_role;

ALTER TABLE public.connections REPLICA IDENTITY FULL;
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.connections;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
