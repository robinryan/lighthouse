/*
  # Lock down the AI coach

  1. Security
    - coach_messages: users can read their messages and update only the `actions` column
      (Apply / Dismiss buttons). Inserting, editing and deleting messages is reserved for the
      `coach` edge function (service role), so nobody can reset their spending or plant fake
      coach replies in the conversation.
  2. New functions
    - coach_limits(p_user): this month's spend for the user and for the whole app, and the
      user's message counts over the last hour and day. Callable only by the service role.
*/

DROP POLICY IF EXISTS "Users insert own rows" ON coach_messages;
DROP POLICY IF EXISTS "Users delete own rows" ON coach_messages;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON coach_messages FROM anon, authenticated;
GRANT UPDATE (actions) ON coach_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON coach_messages TO service_role;

CREATE INDEX IF NOT EXISTS coach_created ON coach_messages (created_at);

CREATE OR REPLACE FUNCTION coach_limits(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'user_month', coalesce(sum(cost_usd) FILTER (WHERE user_id = p_user AND role = 'assistant' AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'), 0),
    'all_month', coalesce(sum(cost_usd) FILTER (WHERE role = 'assistant' AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'), 0),
    'last_hour', count(*) FILTER (WHERE user_id = p_user AND role = 'user' AND created_at >= now() - interval '1 hour'),
    'last_day', count(*) FILTER (WHERE user_id = p_user AND role = 'user' AND created_at >= now() - interval '1 day')
  )
  FROM coach_messages
  WHERE created_at >= least(date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc', now() - interval '1 day')
$$;
REVOKE ALL ON FUNCTION coach_limits(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION coach_limits(uuid) TO service_role;
