DROP VIEW IF EXISTS public.public_profiles;

CREATE OR REPLACE FUNCTION public.get_public_profile(_user_id UUID)
RETURNS TABLE (
  id UUID, display_name TEXT, username TEXT, avatar_url TEXT, country TEXT,
  gender public.gender_type, bio TEXT, interests TEXT[],
  presence public.presence_status, last_active_at TIMESTAMPTZ, age INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.username, p.avatar_url, p.country, p.gender, p.bio,
         p.interests, p.presence, p.last_active_at,
         CASE WHEN p.date_of_birth IS NULL THEN NULL
              ELSE date_part('year', age(p.date_of_birth))::int END
  FROM public.profiles p
  WHERE p.id = _user_id AND p.account_status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.list_public_profiles(_user_ids UUID[])
RETURNS TABLE (
  id UUID, display_name TEXT, username TEXT, avatar_url TEXT, country TEXT,
  gender public.gender_type, bio TEXT, interests TEXT[],
  presence public.presence_status, last_active_at TIMESTAMPTZ, age INT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.display_name, p.username, p.avatar_url, p.country, p.gender, p.bio,
         p.interests, p.presence, p.last_active_at,
         CASE WHEN p.date_of_birth IS NULL THEN NULL
              ELSE date_part('year', age(p.date_of_birth))::int END
  FROM public.profiles p
  WHERE p.id = ANY(_user_ids) AND p.account_status = 'active';
$$;

-- Internal trigger helpers: not callable from the API at all
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_profile_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Policy/API helpers: signed-in callers only
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_blocked_pair(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_session_participant(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_public_profile(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_public_profiles(UUID[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_session_participant(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_profile(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_public_profiles(UUID[]) TO authenticated, service_role;