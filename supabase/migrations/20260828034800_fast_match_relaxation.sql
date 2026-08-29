-- Keep smart matching first, then widen after a short wait so searches do not
-- stall forever when language or country preferences are too narrow.
CREATE OR REPLACE FUNCTION public.atomic_matchmaking(
  p_user_id UUID,
  p_stale_cutoff TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_id UUID;
  v_session_id UUID;
  v_session JSONB;
  v_now TIMESTAMPTZ := now();
  v_cooldown_expires_at TIMESTAMPTZ := now() + interval '5 seconds';
  v_relax_after INTERVAL := interval '1 second';
BEGIN
  SELECT mq.user_id INTO v_candidate_id
  FROM public.matchmaking_queue mq
  JOIN public.profiles p ON p.id = mq.user_id
  CROSS JOIN (
    SELECT
      me.id,
      me.country,
      me.interests,
      meq.preferences,
      meq.joined_at
    FROM public.profiles me
    JOIN public.matchmaking_queue meq ON meq.user_id = me.id
    WHERE me.id = p_user_id
      AND me.profile_completed = true
      AND me.account_status = 'active'
      AND meq.status = 'searching'
      AND meq.session_id IS NULL
  ) current_member
  WHERE mq.status = 'searching'
    AND mq.session_id IS NULL
    AND mq.user_id <> p_user_id
    AND mq.heartbeat_at >= p_stale_cutoff
    AND p.profile_completed = true
    AND p.account_status = 'active'
    AND NOT public.is_blocked_pair(p_user_id, mq.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.match_cooldowns mc
      WHERE mc.user_id = p_user_id
        AND mc.other_user_id = mq.user_id
        AND mc.expires_at > v_now
    )
    AND (
      current_member.joined_at <= v_now - v_relax_after
      OR COALESCE(current_member.preferences->>'language', 'Any') = 'Any'
      OR COALESCE(mq.preferences->>'language', 'Any') = 'Any'
      OR lower(COALESCE(current_member.preferences->>'language', '')) =
        lower(COALESCE(mq.preferences->>'language', ''))
    )
    AND (
      current_member.joined_at <= v_now - v_relax_after
      OR NOT (
        COALESCE(current_member.preferences->>'countryMode', 'global') = 'same_country'
        OR COALESCE(mq.preferences->>'countryMode', 'global') = 'same_country'
      )
      OR (
        NULLIF(lower(trim(COALESCE(current_member.country, ''))), '') IS NOT NULL
        AND lower(trim(COALESCE(current_member.country, ''))) =
          lower(trim(COALESCE(p.country, '')))
      )
    )
  ORDER BY
    (
      CASE
        WHEN COALESCE(current_member.preferences->>'language', 'Any') <> 'Any'
          AND lower(COALESCE(current_member.preferences->>'language', '')) =
            lower(COALESCE(mq.preferences->>'language', ''))
        THEN 40
        ELSE 0
      END
      +
      CASE
        WHEN NULLIF(lower(trim(COALESCE(current_member.country, ''))), '') IS NOT NULL
          AND lower(trim(COALESCE(current_member.country, ''))) =
            lower(trim(COALESCE(p.country, '')))
        THEN 25
        ELSE 0
      END
      +
      CASE
        WHEN COALESCE(current_member.preferences->>'vibe', '') =
          COALESCE(mq.preferences->>'vibe', '')
        THEN 20
        ELSE 0
      END
      +
      (
        SELECT count(*)::int * 12
        FROM (
          SELECT DISTINCT lower(topic) AS topic
          FROM unnest(
            COALESCE(current_member.interests, '{}'::text[])
            || ARRAY(
              SELECT jsonb_array_elements_text(
                COALESCE(current_member.preferences->'topics', '[]'::jsonb)
              )
            )
            || ARRAY[COALESCE(current_member.preferences->>'vibe', '')]
          ) topic
          WHERE NULLIF(trim(topic), '') IS NOT NULL
        ) current_topics
        JOIN (
          SELECT DISTINCT lower(topic) AS topic
          FROM unnest(
            COALESCE(p.interests, '{}'::text[])
            || ARRAY(
              SELECT jsonb_array_elements_text(
                COALESCE(mq.preferences->'topics', '[]'::jsonb)
              )
            )
            || ARRAY[COALESCE(mq.preferences->>'vibe', '')]
          ) topic
          WHERE NULLIF(trim(topic), '') IS NOT NULL
        ) candidate_topics USING (topic)
      )
    ) DESC,
    mq.joined_at ASC
  LIMIT 1
  FOR UPDATE OF mq SKIP LOCKED;

  IF v_candidate_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.call_sessions (user_a, user_b, room_name, status)
  VALUES (p_user_id, v_candidate_id, 'lume-' || gen_random_uuid(), 'connecting')
  RETURNING id INTO v_session_id;

  UPDATE public.matchmaking_queue
  SET status = 'matched',
      session_id = v_session_id,
      heartbeat_at = v_now
  WHERE user_id IN (p_user_id, v_candidate_id)
    AND status = 'searching';

  UPDATE public.profiles
  SET presence = 'in_call',
      last_active_at = v_now
  WHERE id IN (p_user_id, v_candidate_id);

  INSERT INTO public.match_cooldowns (user_id, other_user_id, expires_at)
  VALUES
    (p_user_id, v_candidate_id, v_cooldown_expires_at),
    (v_candidate_id, p_user_id, v_cooldown_expires_at)
  ON CONFLICT (user_id, other_user_id)
  DO UPDATE SET expires_at = excluded.expires_at;

  SELECT row_to_json(cs) INTO v_session
  FROM public.call_sessions cs
  WHERE cs.id = v_session_id;

  RETURN v_session;
END;
$$;
