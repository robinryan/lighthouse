# Lighthouse — strength training PWA with an AI coach

Lighthouse plans each day's lifting session, logs what you actually do, progresses the weights for you, and has a Claude-powered coach you can ask mid-workout ("my elbow hurts today — what should I do instead?").

It's an installable Progressive Web App (works offline at the gym) built with React + Vite, using **Supabase** for accounts, the database and the coach's server function. It deploys as a static site (Netlify, which is what Bolt publishes to).

## Setting it up in Bolt

The app uses Bolt's built-in database (Bolt Database), so you don't need a separate database account. Bolt Database is Supabase-based, which is why the code talks to it with the Supabase client.

1. **Import** the repo into bolt.new from GitHub. The app code is on `master`.
2. **Create the database tables.** Bolt sets up a database for the project and fills in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then, in Bolt's chat, ask: *"Apply the database migration in `supabase/migrations/` to the Bolt database."* You can check it worked from the database icon at the top centre of the project.
3. **Publish.** The build is `npm run build` and the output is `dist/`; `netlify.toml` already says so. At this point everything works except the coach.
4. **Turn on the AI coach** (optional):
   - **Deploy the server function.** Ask Bolt: *"Deploy the `coach` edge function in `supabase/functions/coach`."*
   - **Add your Anthropic key.** Open the database icon, go to the secrets settings, and add a secret named `ANTHROPIC_API_KEY`. You can also add `COACH_MODEL` to override the default model, `claude-opus-5-5`.
5. **Accounts:** sign-up and sign-in use the database's built-in authentication. New accounts may need to confirm their email address first. If confirmation emails link to the wrong address, set the site URL in the database's authentication settings to your published URL.

To install the app on your phone, open the published site and choose **Share → Add to Home Screen** (iOS) or **Install app** (Android).

If you ever want direct control over the database (SQL editor, backups, monitoring), Bolt lets you claim it into your own Supabase account without changing any code.

## Features

**Programming**
- A 4-session rotation based on GZCLP. Every day has **two main lifts**: a heavy T1 lift (e.g. 5×3, last set as many reps as possible) and a volume T2 lift (e.g. 3×10). Accessories (T3) follow.
  - A1: Squat + Bench
  - A2: OHP + Deadlift
  - B1: Bench + Squat
  - B2: Deadlift + OHP
- **Automatic progression.** Weight goes up every time you hit your reps. A missed session moves the lift to the next rep stage at the same weight (5×3 → 6×2 → 10×1) before the weight ever drops. Accessories use double progression: add reps within a range, then add weight. After more than two weeks off, a lift starts 10% lighter.
- **Personalised from your profile.** Goal, session length, equipment and the joints you want to protect decide which exercises are picked and how many accessories you get.

**Logging** (modelled on Strong and Hevy)
- Set rows show set number, last time's numbers (tap to copy), weight, reps and a checkmark.
- Warm-ups are calculated for the heavy lift. The last set is marked AMRAP, with optional RPE.
- A rest timer starts when you check off a set. It has ±15 s and skip buttons, and sounds, vibrates or notifies when rest is over.
- Plate calculator, swaps (today only or for good), live personal records, and a summary when you finish showing what changes next time.
- Sets logged without signal are queued and synced when you're back online.

**Progress**
- Estimated 1RM charts, rep records and session history for each lift.
- Weekly hard sets per muscle against the 10–20 sets/week evidence band.
- Training calendar, week streak, bodyweight log and CSV export.

**AI coach (Claude)**
- Lives in every workout and has its own tab. It sees your profile, program, today's workout and recent sessions, and can search the web, citing its sources.
- Proposes changes as one-tap **Apply** buttons: swap an exercise, lighten the remaining sets, add stretches or rehab drills, change a program slot, or record a joint to protect. Nothing changes until you tap Apply.
- It isn't medical advice. It tells you to stop and see a professional for sharp pain, swelling or numbness.
- Runs Claude Opus 5.5 at medium effort, with server-side refusal fallbacks enabled and web search capped at 5 searches per message.

## Development

```bash
npm install
cp .env.example .env    # fill in your Supabase URL and anon key
npm run dev             # http://localhost:5173
```

Tests:
- **Programming engine:** unit tests that always run.
- **Data layer and coach core:** integration tests that run against real Postgres with the migration applied, so row level security is exercised. They need a Postgres superuser URL:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

## Layout

```
src/                          React app
  data/training.ts            workouts, progression, program (via Supabase)
  data/stats.ts               e1RM, PRs, weekly volume, CSV export
  data/coach.ts               coach messages and applying proposals
  pages/Workout.tsx           logging screen
supabase/
  migrations/                 tables, row level security, views
  functions/coach/index.ts    edge function: Claude + web search + proposal tools
  functions/_shared/          code shared by the app and the edge function
    engine.ts                 programming & progression rules (pure, unit tested)
    exercises.ts              exercise catalog (muscles, equipment, joint stress, cues)
    coach.ts                  coach prompt, tools, context, validation
tests/                        engine unit tests + Postgres integration tests
```
