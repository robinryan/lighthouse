# Gym Bestie — strength training PWA with an AI coach

Gym Bestie plans each day's lifting session, logs what you actually do, progresses the weights for you, and has a Claude-powered coach you can ask mid-workout ("my elbow hurts today — what should I do instead?").

It's an installable Progressive Web App (works offline at the gym) built with React + Vite, using **Supabase** for accounts, the database and the coach's server function. It deploys as a static site (Netlify, which is what Bolt publishes to).

## Setting it up in Bolt

The app uses Bolt's built-in database (Bolt Database), so you don't need a separate database account. Bolt Database is Supabase-based, which is why the code talks to it with the Supabase client.

1. **Import** the repo into bolt.new from GitHub. The app code is on `master`.
2. **Create the database tables.** Bolt sets up a database for the project and fills in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then, in Bolt's chat, ask: *"Apply the database migrations in `supabase/migrations/` to the Bolt database, in order."* Bolt names the files it has applied with its own timestamp prefix; all of them should be applied. You can check it worked from the database icon at the top centre of the project.
3. **Publish.** The build is `npm run build` and the output is `dist/`; `netlify.toml` already says so. At this point everything works except the coach.
4. **Turn on the AI coach** (optional):
   - **Deploy the server function.** Ask Bolt: *"Deploy the `coach` edge function in `supabase/functions/coach`."*
   - **Add your Anthropic key.** Open the database icon, go to the secrets settings, and add a secret named `ANTHROPIC_API_KEY`. The function also needs `SUPABASE_SERVICE_ROLE_KEY`, which Supabase normally provides on its own; if the coach says it's missing, add it from the database's API settings.
   - **Set a spend limit with Anthropic.** In the Anthropic Console, give this app its own API key and set a monthly spend limit. That's the hard ceiling if anything else fails.
5. **Who can sign up:** if the app is just for you, turn off "Allow new users to sign up" in the database's authentication settings once your account exists. If you open it up, keep email confirmation on and turn on CAPTCHA protection there.
6. **Email links (password reset, magic link, confirmation).** Supabase only sends people to addresses on its allow list and falls back to its **Site URL** (by default `http://localhost:3000`) for anything else, which is why links can open a local address. In the database's authentication settings, under URL configuration:
   - set **Site URL** to your published address, e.g. `https://your-app.bolt.host`
   - add `https://your-app.bolt.host/**` under **Redirect URLs**
   - optionally, add a `VITE_SITE_URL` environment variable with the same address, so links requested from Bolt's preview still open the live app.
7. **Magic link codes:** on a phone, an emailed link opens in the browser rather than the installed app. To sign in inside the installed app, the login screen also accepts the code from the email. Supabase's default magic-link email only contains the link, so edit the **Magic Link** email template to add the code, e.g. `<p>Or enter this code: <strong>{{ .Token }}</strong></p>`.
8. **Accounts:** sign-up and sign-in use the database's built-in authentication. New accounts may need to confirm their email address first.

To install the app on your phone, open the published site and choose **Share → Add to Home Screen** (iOS) or **Install app** (Android).

If you ever want direct control over the database (SQL editor, backups, monitoring), Bolt lets you claim it into your own Supabase account without changing any code.

## Features

**Getting started**
- New users pick a goal and experience, or describe themselves in their own words: current health, goals, injuries or past setbacks, schedule.
- The coach reads that description and fills in the remaining setup steps, which the user can correct. It also saves joints to protect, exercises to avoid and other notes to the health profile, so the first program already works around them.
- After building the program, a **Your plan** screen explains in plain language why it fits that person, including any exercises swapped for their injuries. The coach writes it when there's a description; otherwise a built-in explanation is used. It's kept on the Program page ("Why this plan fits you") and as the first conversation in the Coach tab.
- Reading the description and writing the explanation cost roughly $0.05–0.06 per new user on Opus (an estimate, not measured), counted toward the same budgets and limits as the coach.

**Programming**
- A 4-session rotation based on GZCLP. Every day has **two main lifts**: a heavy T1 lift (e.g. 5×3, last set as many reps as possible) and a volume T2 lift (e.g. 3×10). Accessories (T3) follow.
  - A1: Squat + Bench
  - A2: OHP + Deadlift
  - B1: Bench + Squat
  - B2: Deadlift + OHP
- **Automatic progression.** Weight goes up every time you hit your reps. A missed session moves the lift to the next rep stage at the same weight (5×3 → 6×2 → 10×1) before the weight ever drops. Accessories use double progression: add reps within a range, then add weight. After more than two weeks off, a lift starts 10% lighter.
- **Personalised from your profile.** Goal, session length, equipment and the joints you want to protect decide which exercises are picked and how many accessories you get.
- **Adapts when you train more often than planned.** Each session is adjusted when you start it, based on what you did in the last day. No AI is used.
  - An accessory you did yesterday becomes a different exercise for the same muscles. A Lat Pulldown yesterday becomes a row today. If today already trains that muscle, it becomes an exercise for a muscle that's behind for the week instead. This also applies to exercises you or the coach added, and the card offers **Do … instead** to switch back.
  - A muscle worked very hard yesterday (6+ hard sets) gets a day off: its accessory is replaced with one for a muscle that's behind for the week. Exercises you or the coach chose aren't changed for this.
  - On your third training day in a row or later, a leg volume lift (squat or deadlift T2) drops one set if your legs worked hard the day before. Heavy T1 lifts never change, and weight increases still happen as normal.
  - Today shows a notice when you've trained at least 1 day a week more than your plan says over the last 3 weeks, and offers to update it. The coach is told how often you actually train.

**Logging** (modelled on Strong and Hevy)
- Set rows show set number, last time's numbers (tap to copy), weight, reps and a checkmark.
- Warm-ups are calculated for the heavy lift. The last set is marked AMRAP, with optional RPE.
- A rest timer starts when you check off a set. It has ±15 s and skip buttons, and sounds, vibrates or notifies when rest is over.
  - The beep plays over your music or podcast instead of pausing it, and the app holds no audio between beeps, so coming back to it never stops what you were listening to. On iPhone this needs iOS 16.4 or later, and the beep follows the silent switch.
- Plate calculator, swaps (today only or for good), live personal records, and a summary when you finish showing what changes next time.
- Tapping any exercise name opens an **in-app demo**: an embedded video plus form tips and, for stretches, how long. Videos load only when you tap Play, to save data. If a video can't be embedded, the app offers a YouTube search instead. Three form and safety tips also sit under each lift; you can hide them in Settings.
- **Skip an exercise or single sets**, saying why: pain (and where), equipment busy, tired, short on time, too hard or easy, dislike, or other. The app then offers replacements ranked for that reason. For example, elbow pain on bench suggests presses that don't load the elbow. Skipped sets never count as a failed session.
- **Add exercise** opens with a ranked "Suggested for you" list, ordered by what helps most. It uses muscles under-trained this week from your recent lifts, today's workout, your health profile and coach feedback, and shows the reason for each.
- Sets logged without signal are queued and synced when you're back online.

**Stretches**
- Every lift lists its recommended stretches and mobility drills, each marked **Before** or **After**, with an **importance rating out of 10** and the reason. One tap adds any of them to the workout.
- Stretches are workout items in their own right, with:
  - a YouTube demo link
  - three tips
  - a "how long" (e.g. "2 × 30 s each side")
  - check-off sets
- The most important prep drills (7/10+) for the two main lifts are added automatically just before each lift, plus a short cool-down at the end. Turn this off in Settings.
- Before lifting, the app uses dynamic drills and short holds; longer static holds go after, because long static stretching (60 s+) right before lifting can briefly reduce strength.
- Ratings go up for stretches that help a joint your health profile marks as sensitive.
- Stretches never affect lift progression.

**Health profile**
- Built continually from:
  - skip reasons: pain becomes a sensitive joint plus an exercise to avoid, and fades after six weeks unless it recurs
  - coach chats: the coach saves what you tell it, with an Undo button
  - your own entries
- Tracks sensitive joints (with severity), exercises to avoid, ones that work well, ones you dislike, and general notes.
- Feeds suggestions, the coach's advice and program rebuilds. Review and edit it under Settings → Health profile.

**Built for a phone at the gym**
- **During a workout:**
  - The screen stays on.
  - The header, with elapsed time, set count, Coach and Finish, stays pinned while you scroll.
  - Finished exercises collapse to one line, and the page scrolls to the next one.
- **Logging sets:**
  - Checkmarks are large and give a short haptic tick.
  - Tapping a weight or reps box selects its number, so typing replaces it.
  - The number keypad opens automatically, and inputs are sized so iOS doesn't zoom in.
- **Rest timer:** the countdown also shows in the tab title, so it's visible in the app switcher.
- **Stretch flags** collapse to a one-line summary.
- **Loading:** pages load on demand, the app works offline, and there's an "Install app" prompt (Android) or instructions (iOS).

**Progress**
- **Your training lately:** a written summary of the last 30 and 90 days. It covers how regularly you trained compared with your plan and the period before, which lifts went up and which have stalled, more reps at the same weight on accessories, sets per session, workout length, total weight moved, and which muscles get plenty or too little work. It ends with one to three things to focus on over the next one to three months. It's rule-based, so it costs nothing to run.
- Estimated 1RM charts, rep records and session history for each lift.
- Weekly hard sets per muscle against the 10–20 sets/week evidence band.
- Training calendar, week streak, bodyweight log and CSV export.

**AI coach (Claude)**
- Lives in every workout and has its own tab. It sees your profile, program, today's workout and recent sessions, and can search the web, citing its sources.
- Changes to the workout you're doing (swapping an exercise, lightening the remaining sets, adding stretches or rehab drills) are applied straight away, each with an **Undo**. If the coach thinks a swap should stick, you can also tap **Keep for future sessions**.
- **Program changes you ask for are saved straight away.** Say "add calf raises to my program", "swap bench for dumbbell press permanently" or "drop leg curls", and the coach changes your program: it can replace an exercise, add an accessory to one or more days, or remove an accessory. Main lifts can be replaced but not removed. Each change has an **Undo**. Changes the coach suggests on its own (a program slot, a joint to protect) wait for you to tap **Apply**.
- **Keeps working if you switch apps.** If you leave the app or the chat while the coach is answering, it finishes on the server. When you come back, the chat picks up the saved answer and applies its changes. Nothing needs to be re-sent.
- Rebuilding the program (Settings → Save & rebuild) starts from a fresh program, so accessories the coach added are dropped.
- The message box sits at the top of the chat; the newest question and answer appear right under it.
- It isn't medical advice. It tells you to stop and see a professional for sharp pain, swelling or numbness.
- Each question goes to the cheapest Claude model that answers it well (see **Plans** below), with server-side refusal fallbacks on Sonnet and Opus.

**Plans** (free, paid, admin)
- Every account is **free** until an admin moves it to **paid** on the admin page. Admins are set by email: `robin.ryan@gmail.com` by default, or the comma-separated `COACH_ADMIN_EMAILS` secret.
- A cheap Haiku check reads each question first and sorts it as *simple* (general how-to), *personal* (about your own training) or *safety* (any pain, injury or medical issue). Injury words always count as safety, even if the check says otherwise or fails. The question then goes to:

  | Question | Free | Paid and admin |
  |---|---|---|
  | Simple | Haiku 5.5 | Haiku 5.5 |
  | Personal | Haiku 5.5 | Sonnet 5.5 |
  | Pain, injury, medical | Sonnet 5.5 | Opus 5.5 |
  | 🔎 Research (web search) | not included | Opus 5.5 |
- Onboarding (reading a new user's description and explaining their plan) uses Sonnet for free users and Opus for paid users.
- Settings shows each user's plan and how much of this month's coach allowance they've used, as a percentage. Only admins see dollar amounts, including the cost and model of each coach reply.
- **Admin page** (Settings → Open admin): every user with their plan, workouts, coach messages and spending this month and all time, plus spending by model and by day. A Free/Paid switch on each user changes their plan. Chat content isn't shown.

**AI cost controls** (only the coach uses AI; everything else is rule-based and free to run)
- **Usage tracking:** every reply stores its token counts, web searches, model, question type and estimated cost.
- **One round per reply:** the coach writes its answer alongside any changes; the app checks and applies them itself, so the conversation isn't sent back for a second round. A second round only happens if a change was invalid.
- **At most 3 changes and 2 health notes per reply.**
- **Small prompt:** the exercise list is filtered to your equipment. Simple questions get only your profile and today's exercise list; other questions also get the program, a one-line summary of each exercise's sets, and the best set from each of your last 3 sessions. Only the last 4 chat messages are sent, with older coach replies shortened.
- **Caching:** the instructions and tools are cached for an hour (mid-workout questions are often more than 5 minutes apart), plus a 5-minute cache for the rest of the conversation.
- **Web search only on request:** the search tool is attached only when 🔎 Research is on (paid). It's capped at 2 searches and limited to reputable sources (PubMed, BJSM, JOSPT, Physiopedia, AAOS, Mayo Clinic, NHS, ACSM, NSCA, Stronger By Science, and others).
- **Short answers:** about 120 words, up to about 250 for injury and research questions.

**Abuse protection** (so nobody can use the coach as a free general-purpose AI on your bill)
- **Topic screen:** Claude Haiku 5.5 checks each message first, for a fraction of a cent. Off-topic requests (code, essays, homework, general knowledge) get a polite one-line refusal and never reach the main model. The coach's own instructions also refuse off-topic tasks.
- **Tamper-proof usage records:** only the coach function can write chat messages. Users can read them and tap Apply/Dismiss, but can't edit, delete or reprice them, so they can't reset their budget or plant fake replies.
- **Limits**, all checked before any API call. You can change each one with a secret (0 turns it off):

  | Secret | Default | Limit |
  |---|---|---|
  | `COACH_FREE_MONTHLY_BUDGET_USD` | 0.50 | Per free user, per month |
  | `COACH_FREE_HOURLY_LIMIT` / `COACH_FREE_DAILY_LIMIT` | 10 / 20 | Messages per free user |
  | `COACH_PAID_MONTHLY_BUDGET_USD` | 10 | Per paid user, per month (`COACH_MONTHLY_BUDGET_USD` also works) |
  | `COACH_TOTAL_MONTHLY_BUDGET_USD` | 25 | All free and paid users combined, per month (admins are exempt) |
  | `COACH_PAID_HOURLY_LIMIT` / `COACH_PAID_DAILY_LIMIT` | 20 / 60 | Messages per paid user (`COACH_HOURLY_LIMIT` / `COACH_DAILY_LIMIT` also work) |

  Admins have no limits. `COACH_FORCE_MODEL` sends every question to one model, for testing only; the old `COACH_MODEL` secret is ignored so it can't switch routing off.
- **Size caps:** messages are limited to 1,000 characters, and replies to 2,500 tokens including thinking (6,000 for injury and research questions).

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
    frequency.ts              training frequency and session adjustments (pure, unit tested)
    insights.ts               30/90-day written summary and focus areas (pure, unit tested)
    exercises.ts              exercise catalog (muscles, equipment, joint stress, cues)
    coach.ts                  coach prompt, tools, context, validation
tests/                        engine unit tests + Postgres integration tests
```
