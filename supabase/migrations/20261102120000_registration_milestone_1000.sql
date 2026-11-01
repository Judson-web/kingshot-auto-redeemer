-- Public registration milestone count and an atomic one-time 1,000-player claim.
CREATE TABLE IF NOT EXISTS public.kingshot_registration_milestones (
  milestone integer PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kingshot_registration_milestones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kingshot_registration_milestones FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kingshot_public_registration_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT count(*)::bigint FROM public.kingshot_autoredeem;
$function$;
REVOKE ALL ON FUNCTION public.kingshot_public_registration_count() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.kingshot_public_registration_count() TO anon, service_role;

CREATE OR REPLACE FUNCTION public.claim_kingshot_registration_milestone(p_milestone integer DEFAULT 1000)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE current_count bigint;
BEGIN
  IF p_milestone <> 1000 THEN RETURN false; END IF;
  SELECT count(*) INTO current_count FROM public.kingshot_autoredeem;
  IF current_count < p_milestone THEN RETURN false; END IF;
  INSERT INTO public.kingshot_registration_milestones(milestone)
  VALUES (p_milestone)
  ON CONFLICT (milestone) DO NOTHING;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_kingshot_registration_milestone(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_kingshot_registration_milestone(integer) TO service_role;
