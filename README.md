# Lighthouse — strength training PWA with an AI coach

Lighthouse plans each day's lifting session, logs what you actually do, progresses the weights for you, and has a Claude-powered coach you can ask mid-workout ("my elbow hurts today — what should I do instead?").

It's an installable Progressive Web App (works offline at the gym) with email/password accounts, so each user gets their own history and recommendations.

## Features

**Programming**
- A 4-session rotation based on GZCLP. Every day has **two main lifts**: a heavy T1 lift (e.g. 5×3, last set as many reps as possible) and a volume T2 lift (e.g. 3×10). Accessories (T3) follow.
  - A1: Squat + Bench
  - A2: OHP + Deadlift
  - B1: Bench + Squat
  - B2: Deadlift + OHP
- **Automatic progression.** Weight goes up every time you hit your reps; the increment depends on the lift and your experience. A big AMRAP set earns a double jump for beginners. A missed session moves the lift to the next rep stage at the same weight (5×3 → 6×2 → 10×1) before the weight ever drops. Failing the last stage resets the lift from your estimated max.
- **Accessories use double progression.** Add reps within the range (e.g. 10–15), then add weight. Three sessions below the range trigger a 10% deload.
- **Easing back in.** If you haven't done a lift in over two weeks, it starts 10% lighter.
- **Personalised from your profile.** Goal (strength, hypertrophy or general) sets the rep schemes. Session length sets how many accessories you get. Your equipment and the joints you want to protect decide which exercises are picked; for example, a dumbbells-only setup gets dumbbell variants, and protected elbows get a neutral-grip press.
- **Lighter by choice isn't a failure.** Lifting below the prescription (say, on a sore day) doesn't count as a failed session.

**Logging** (modelled on Strong and Hevy, the most popular trackers)
- Set rows show set number, **last time's numbers** (tap to copy), weight, reps and a checkmark.
- Warm-up sets are calculated automatically for the heavy lift. The last set is marked AMRAP, with optional RPE.
- A **rest timer** starts when you check off a set. Each tier has its own rest time (3:00 heavy, 2:00 volume, 1:15 accessories). It has ±15 s and skip buttons, and sounds, vibrates or notifies when rest is over. Because it's based on timestamps, it survives locking your phone.
- **Plate calculator** for kg and lb.
- Swap an exercise for today or for good; the picker can filter for "easy on elbows/shoulders/…" and your equipment. You can also add or remove exercises and sets, and keep notes per exercise and per workout.
- Personal records are flagged live as you log. A summary when you finish shows what changes next time.

**Progress**
- Estimated 1RM per lift (Epley formula), with charts of e1RM, top set and volume, a rep-record table and session history.
- Weekly **hard sets per muscle** against the 10–20 sets/week evidence band.
- Training calendar, week streak, bodyweight log and CSV export.

**AI coach (Claude)**
- Available inside every workout and as its own tab. It sees your profile, program, today's workout and recent sessions.
- Uses **web search** for research questions and cites sources.
- Proposes changes as one-tap **Apply** buttons: swap an exercise (today or in the program), lighten the remaining sets, add stretches or rehab drills, change a program slot, or record a joint to protect. Nothing changes until you tap Apply.
- Safety guidance is built into the prompt: stop and see a professional for sharp pain, swelling or numbness. It is not medical advice.

## Running locally

Requires Node 20+.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY to enable the coach (optional)
npm run dev                   # API on :3001, app on http://localhost:5173
```

`npm run dev` doesn't load `.env` automatically. Export the variables in your shell first, for example `export ANTHROPIC_API_KEY=...`, or use a tool like `dotenv`.

Production build:

```bash
npm run build
ANTHROPIC_API_KEY=... npm start   # serves the app and API on :3001
```

Tests (programming engine, full API flow, and the coach tool loop against a fake Claude server):

```bash
npm test
```

## Deploying

A PWA needs HTTPS to be installable and to work offline. The included `Dockerfile` runs anywhere that runs containers, such as Fly.io, Railway, Render or a VPS. Mount a persistent volume at `/data`; that's where the SQLite database lives.

```bash
docker build -t lighthouse .
docker run -p 3001:3001 -v lighthouse-data:/data -e ANTHROPIC_API_KEY=... -e ALLOW_SIGNUP=false lighthouse
```

While it's just for you, set `ALLOW_SIGNUP=false`. Only the first account can then be created. Later, either open sign-ups or set `SIGNUP_INVITE_CODE`.

On your phone, open the site, then choose **Share → Add to Home Screen** (iOS) or **Install app** (Android).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables the AI coach |
| `COACH_MODEL` | `claude-opus-5-5` | Model the coach uses |
| `DATABASE_PATH` | `./data/lighthouse.db` | SQLite file location |
| `PORT` | `3001` | HTTP port |
| `ALLOW_SIGNUP` | `true` | `false` allows only the first account |
| `SIGNUP_INVITE_CODE` | — | Require this code to register |

The coach runs Claude Opus 5.5 at medium effort, with server-side refusal fallbacks enabled (`fallbacks: "default"`). Web search is capped at 5 searches per message. A typical question costs a few cents. Questions that trigger web research cost more.

## Layout

```
server/  Express + SQLite API
  src/engine.ts      programming & progression rules (pure functions, unit tested)
  src/exercises.ts   exercise catalog (muscles, equipment, joint stress, cues)
  src/training.ts    workouts, lift state, onboarding
  src/coach.ts       Claude integration: context, tools, proposals
  src/stats.ts       e1RM, PRs, weekly volume, CSV export
client/  React + Vite PWA
  src/pages/Workout.tsx         logging screen
  src/components/RestTimer.tsx  rest timer
  src/components/CoachChat.tsx  coach UI
```
