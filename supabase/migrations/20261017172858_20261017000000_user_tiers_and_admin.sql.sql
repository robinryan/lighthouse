/*
  # User classes (free / paid / admin) and the admin usage report

  1. New tables
    - user_tiers: one row per user who isn't on the default free class.
      - user_id (uuid, primary key, references auth.users)
      - tier (text: 'free', 'paid' or 'admin')
      - updated_at (timestamptz)
      - updated_by (uuid, who changed it)
  2. Security
    - RLS on: users can read their own row only. Nobody can change a class from the app directly;
      the `coach` edge function (service role) does it for admins.
  3. New functions
    - coach_admin_report(): every user with class, workouts, coach messages and spending, plus spending
      by model and by day. Callable only by the service role (the edge function checks the caller is an admin).
  4. Data
    - robin.ryan@gmail.com is an admin (the edge function also treats that address as admin).
*/

CREATE TABLE IF NOT EXISTS user_tiers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid', 'admin')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE user_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own tier" ON user_tiers;
CREATE POLICY "Users read own tier" ON user_tiers FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_tiers FROM anon, authenticated;
GRANT SELECT ON user_tiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tiers TO service_role;

INSERT INTO user_tiers (user_id, tier)
SELECT id, 'admin' FROM auth.users WHERE lower(email) = 'robin.ryan@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET tier = 'admin', updated_at = now();

-- SECURITY DEFINER so it can read auth.users; EXECUTE is limited to the service role below.
CREATE OR REPLACE FUNCTION coach_admin_report() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  WITH bounds AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc' AS month_start
  ),
  per_user AS (
    SELECT
      u.id, u.email, coalesce(nullif(p.name, ''), u.raw_user_meta_data ->> 'name', '') AS name,
      coalesce(t.tier, 'free') AS tier, u.created_at AS joined,
      (SELECT count(*) FROM workouts w WHERE w.user_id = u.id AND w.status = 'completed') AS workouts,
      (SELECT max(w.date) FROM workouts w WHERE w.user_id = u.id) AS last_workout,
      coalesce(sum(m.cost_usd) FILTER (WHERE m.created_at >= b.month_start), 0) AS month_usd,
      coalesce(sum(m.cost_usd), 0) AS total_usd,
      count(m.id) FILTER (WHERE m.role = 'user' AND m.created_at >= b.month_start) AS month_messages,
      count(m.id) FILTER (WHERE m.role = 'user') AS total_messages,
      max(m.created_at) AS last_coach
    FROM auth.users u
    CROSS JOIN bounds b
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN user_tiers t ON t.user_id = u.id
    LEFT JOIN coach_messages m ON m.user_id = u.id
    GROUP BY u.id, u.email, p.name, u.raw_user_meta_data, t.tier, u.created_at
  )
  SELECT jsonb_build_object(
    'users', coalesce((SELECT jsonb_agg(to_jsonb(per_user) ORDER BY month_usd DESC, joined DESC) FROM per_user), '[]'::jsonb),
    'byModel', coalesce((
      SELECT jsonb_agg(jsonb_build_object('model', model, 'replies', replies, 'usd', usd) ORDER BY usd DESC)
      FROM (
        SELECT coalesce(m.usage ->> 'model', 'unknown') AS model, count(*) AS replies, coalesce(sum(m.cost_usd), 0) AS usd
        FROM coach_messages m, bounds b
        WHERE m.cost_usd IS NOT NULL AND m.created_at >= b.month_start
        GROUP BY 1
      ) x), '[]'::jsonb),
    'byDay', coalesce((
      SELECT jsonb_agg(jsonb_build_object('day', day, 'replies', replies, 'usd', usd) ORDER BY day)
      FROM (
        SELECT (m.created_at AT TIME ZONE 'utc')::date AS day, count(*) FILTER (WHERE m.role = 'assistant') AS replies, coalesce(sum(m.cost_usd), 0) AS usd
        FROM coach_messages m
        WHERE m.created_at >= now() - interval '30 days'
        GROUP BY 1
      ) y), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION coach_admin_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION coach_admin_report() TO service_role;

NOTIFY pgrst, 'reload schema';
