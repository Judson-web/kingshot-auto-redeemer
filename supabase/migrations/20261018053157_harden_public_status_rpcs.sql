-- Harden the two intentionally public status RPCs without breaking the website.
-- Announcements are public only while active, published, and unexpired.
ALTER TABLE public.kingshot_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read active published announcements" ON public.kingshot_announcements;
CREATE POLICY "Public can read active published announcements"
  ON public.kingshot_announcements
  FOR SELECT TO anon
  USING (
    active = true
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  );
REVOKE ALL ON TABLE public.kingshot_announcements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kingshot_announcements TO anon;

CREATE OR REPLACE FUNCTION public.kingshot_public_announcements()
RETURNS SETOF public.kingshot_announcements
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT *
  FROM public.kingshot_announcements
  WHERE active = true
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY published_at DESC
  LIMIT 5;
$function$;
REVOKE ALL ON FUNCTION public.kingshot_public_announcements() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.kingshot_public_announcements() TO anon, service_role;

-- Maintenance status is public, but the public RPC must be read-only.
-- Treat a past end time as disabled in the returned status; do not mutate settings
-- from an unauthenticated request.
ALTER TABLE public.kingshot_site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read maintenance status" ON public.kingshot_site_settings;
CREATE POLICY "Public can read maintenance status"
  ON public.kingshot_site_settings
  FOR SELECT TO anon
  USING (id = true);
REVOKE ALL ON TABLE public.kingshot_site_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kingshot_site_settings TO anon;

CREATE OR REPLACE FUNCTION public.kingshot_public_maintenance()
RETURNS TABLE(
  maintenance_enabled boolean,
  maintenance_message text,
  ends_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    (s.maintenance_enabled AND (s.ends_at IS NULL OR s.ends_at > now())) AS maintenance_enabled,
    s.maintenance_message,
    s.ends_at,
    s.updated_at
  FROM public.kingshot_site_settings AS s
  WHERE s.id = true
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.kingshot_public_maintenance() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.kingshot_public_maintenance() TO anon, service_role;
