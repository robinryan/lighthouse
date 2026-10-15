/*
  # Count every AI cost toward the coach limits

  1. Changes
    - coach_limits(p_user): monthly spending now adds up cost_usd on every coach_messages row,
      not just coach replies. Reading a new user's onboarding description is recorded on the
      user's own (hidden) message, and now counts too.
*/

CREATE OR REPLACE FUNCTION coach_limits(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'user_month', coalesce(sum(cost_usd) FILTER (WHERE user_id = p_user AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'), 0),
    'all_month', coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'), 0),
    'last_hour', count(*) FILTER (WHERE user_id = p_user AND role = 'user' AND created_at >= now() - interval '1 hour'),
    'last_day', count(*) FILTER (WHERE user_id = p_user AND role = 'user' AND created_at >= now() - interval '1 day')
  )
  FROM coach_messages
  WHERE created_at >= least(date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc', now() - interval '1 day')
$$;
REVOKE ALL ON FUNCTION coach_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION coach_limits(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
