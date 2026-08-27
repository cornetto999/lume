-- Add an index to speed up matchmaking queue queries
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_status_heartbeat 
ON matchmaking_queue (status, heartbeat_at);

-- Create a robust RPC function for atomic matchmaking
CREATE OR REPLACE FUNCTION atomic_matchmaking(p_user_id UUID, p_stale_cutoff TIMESTAMP WITH TIME ZONE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_candidate_id UUID;
    v_session_id UUID;
    v_session JSONB;
BEGIN
    -- Try to find a valid candidate and lock their row
    SELECT mq.user_id INTO v_candidate_id
    FROM matchmaking_queue mq
    JOIN profiles p ON p.id = mq.user_id
    WHERE mq.status = 'searching'
      AND mq.session_id IS NULL
      AND mq.user_id != p_user_id
      AND mq.heartbeat_at >= p_stale_cutoff
      AND p.profile_completed = true
      AND p.account_status = 'active'
      AND NOT is_blocked_pair(p_user_id, mq.user_id)
      AND NOT EXISTS (
          SELECT 1 FROM match_cooldowns mc
          WHERE mc.user_id = p_user_id
            AND mc.other_user_id = mq.user_id
            AND mc.expires_at > NOW()
      )
    ORDER BY mq.joined_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    -- If no candidate found, return null
    IF v_candidate_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- We have a locked candidate. Create a session.
    INSERT INTO call_sessions (user_a, user_b, room_name, status)
    VALUES (p_user_id, v_candidate_id, 'lume-' || gen_random_uuid(), 'pending')
    RETURNING id, room_name INTO v_session_id;

    -- Update both users in the queue
    UPDATE matchmaking_queue
    SET status = 'matched',
        session_id = v_session_id,
        heartbeat_at = NOW()
    WHERE user_id IN (p_user_id, v_candidate_id);

    -- Return the session info
    SELECT row_to_json(cs) INTO v_session
    FROM call_sessions cs
    WHERE id = v_session_id;

    RETURN v_session;
END;
$$;
