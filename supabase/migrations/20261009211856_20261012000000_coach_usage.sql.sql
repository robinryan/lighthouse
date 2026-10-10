/*
  # Coach usage tracking

  1. Changes
    - coach_messages.usage: token counts, web searches, model, effort and cost for each coach reply
    - coach_messages.cost_usd: estimated cost of that reply, summed for the monthly budget
*/

ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS usage jsonb;
ALTER TABLE coach_messages ADD COLUMN IF NOT EXISTS cost_usd double precision;
CREATE INDEX IF NOT EXISTS coach_user_created ON coach_messages (user_id, created_at DESC);