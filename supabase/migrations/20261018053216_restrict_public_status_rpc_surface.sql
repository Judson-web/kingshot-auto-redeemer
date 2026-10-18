-- Keep these two RPCs as the only public interface to their status data.
-- The functions are deliberately SECURITY DEFINER because the backing tables are
-- not directly exposed; their output is limited to public announcement/status fields.
DROP POLICY IF EXISTS "Public can read active published announcements" ON public.kingshot_announcements;
REVOKE ALL ON TABLE public.kingshot_announcements FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kingshot_public_announcements()
RETURNS SETOF public.kingshot_announcements
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT a.*
  FROM public.kingshot_announcements AS a
  WHERE a.active = true
    AND a.published_at <= now()
    AND (a.expires_at IS NULL OR a.expires_at > now())
  ORDER BY a.published_at DESC
  LIMIT 5;
$function$;
REVOKE ALL ON FUNCTION public.kingshot_public_announcements() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.kingshot_public_announcements() TO anon, service_role;

DROP POLICY IF EXISTS "Public can read maintenance status" ON public.kingshot_site_settings;
REVOKE ALL ON TABLE public.kingshot_site_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kingshot_public_maintenance()
RETURNS TABLE(
  maintenance_enabled boolean,
  maintenance_message text,
  ends_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
