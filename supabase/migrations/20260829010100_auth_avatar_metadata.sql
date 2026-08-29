-- Copy real auth-provider names/photos into Lume profiles more reliably.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_display_name TEXT;
  profile_avatar_url TEXT;
BEGIN
  profile_display_name := NULLIF(trim(COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'user_name',
    NEW.raw_user_meta_data->>'preferred_username',
    ''
  )), '');

  IF profile_display_name IS NOT NULL
    AND char_length(profile_display_name) NOT BETWEEN 2 AND 40 THEN
    profile_display_name := NULL;
  END IF;

  profile_avatar_url := NULLIF(trim(COALESCE(
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'picture',
    NEW.raw_user_meta_data->>'photo_url',
    NEW.raw_user_meta_data->>'picture_url',
    NEW.raw_user_meta_data->>'image_url',
    ''
  )), '');

  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, profile_display_name, profile_avatar_url)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

WITH auth_defaults AS (
  SELECT
    id,
    CASE
      WHEN char_length(display_name) BETWEEN 2 AND 40 THEN display_name
      ELSE NULL
    END AS display_name,
    avatar_url
  FROM (
    SELECT
      id,
      NULLIF(trim(COALESCE(
        raw_user_meta_data->>'full_name',
        raw_user_meta_data->>'name',
        raw_user_meta_data->>'display_name',
        raw_user_meta_data->>'user_name',
        raw_user_meta_data->>'preferred_username',
        ''
      )), '') AS display_name,
      NULLIF(trim(COALESCE(
        raw_user_meta_data->>'avatar_url',
        raw_user_meta_data->>'picture',
        raw_user_meta_data->>'photo_url',
        raw_user_meta_data->>'picture_url',
        raw_user_meta_data->>'image_url',
        ''
      )), '') AS avatar_url
    FROM auth.users
  ) users_with_metadata
)
UPDATE public.profiles profiles
SET
  display_name = COALESCE(profiles.display_name, auth_defaults.display_name),
  avatar_url = COALESCE(profiles.avatar_url, auth_defaults.avatar_url)
FROM auth_defaults
WHERE profiles.id = auth_defaults.id
  AND (
    (profiles.display_name IS NULL AND auth_defaults.display_name IS NOT NULL)
    OR (profiles.avatar_url IS NULL AND auth_defaults.avatar_url IS NOT NULL)
  );

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
