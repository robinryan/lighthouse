// Browser tests: builds the app, serves it with the site's real security headers, runs it against
// the local stand-in (server.mts) and walks through the main flows on a phone-sized screen.
//
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run e2e
//
// Screenshots of failures go to tests/e2e/output/.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, devices, type Page } from 'playwright';
import { startStandIn } from './server.mts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'output');
const API = 54421;
const WEB = 4273;
const B = `http://localhost:${WEB}`;

if (!process.env.TEST_DATABASE_URL) { console.error('Set TEST_DATABASE_URL to a Postgres you can create databases in.'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

// Build against the stand-in.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-bestie-e2e-'));
process.env.VITE_SUPABASE_URL = `http://localhost:${API}`;
process.env.VITE_SUPABASE_ANON_KEY = 'anon';
await build({ root, logLevel: 'error', build: { outDir: dist, emptyOutDir: true } });

// Serve it like production: single-page fallback and the headers from netlify.toml.
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
const siteHeaders = Object.fromEntries([...toml.slice(toml.indexOf('for = "/*"')).matchAll(/^\s+([\w-]+) = "(.*)"$/gm)].map((m) => [m[1], m[2]]));
// The only difference from production: the stand-in is plain http on localhost, so allow connecting to it.
siteHeaders['Content-Security-Policy'] = siteHeaders['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' http://localhost:${API}`);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const web = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(req.url!.split('?')[0]));
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  res.writeHead(200, { ...siteHeaders, 'Content-Type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise<void>((r) => web.listen(WEB, r));
const stopApi = await startStandIn(process.env.TEST_DATABASE_URL, API);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
const page = await context.newPage();
const problems: string[] = [];
page.on('pageerror', (e) => problems.push(`page error: ${e}`));
page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) problems.push(m.text()); });
page.on('dialog', (d) => void d.accept());

let failed = 0;
async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`ok    ${name}`); } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(e).split('\n').slice(0, 3).join('\n      ')}`);
    await page.screenshot({ path: path.join(out, `${name.replace(/\W+/g, '_')}.png`), fullPage: true }).catch(() => {});
  }
}
const card = (p: Page, name: RegExp) => p.locator('.ex-card', { has: p.locator('.ex-head a.ex-link', { hasText: name }) }).first();
const email = `e2e${Date.now()}@example.com`;

await step('sign up and build a program', async () => {
  await page.goto(B);
  await page.getByText('Create an account').click();
  await page.getByLabel('Name').fill('Robin');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password').fill('supersecret1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('What are you training for?').waitFor();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Build my program' }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await page.getByRole('button', { name: 'Start workout' }).waitFor();
});

await step('start a workout, log a set, rest timer starts', async () => {
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.locator('.time-pill').waitFor();
  await card(page, /^Back Squat/).getByRole('button', { name: 'Mark done' }).first().click();
  await page.locator('.timer-bar').waitFor();
  await card(page, /^Back Squat/).getByRole('button', { name: 'Mark not done' }).first().waitFor();
  // The pinned bars are where they belong.
  const tab = await page.locator('.tabbar').boundingBox();
  const head = await page.locator('.workout-header').boundingBox();
  const h = page.viewportSize()!.height;
  if (!tab || Math.abs(tab.y + tab.height - h) > 2) throw new Error('tab bar is not at the bottom');
  if (!head || head.y > 2) throw new Error('workout toolbar is not at the top');
});

await step('the logged set survives a reload', async () => {
  await page.reload();
  await card(page, /^Back Squat/).getByRole('button', { name: 'Mark not done' }).first().waitFor();
});

await step('coach changes today\'s workout, and the change can be undone', async () => {
  await page.getByRole('button', { name: 'Coach', exact: true }).click();
  await page.getByPlaceholder(/What's going on/).fill('My elbow hurts on bench today');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText('Swap to a machine press today', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByText(/Applied to today's workout/).first().waitFor();
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.getByText(/Undone/i).first().waitFor();
});

await step('a dropped connection still gets its answer, and a program change is saved', async () => {
  await page.route('**/functions/v1/coach', async (route) => {
    const b = route.request().postDataJSON();
    if (b?.text?.includes('to my program')) { route.fetch().catch(() => {}); await route.abort('connectionreset'); } else await route.continue();
  });
  await page.goto(`${B}/coach`);
  await page.getByPlaceholder(/What's going on/).fill('Please add calf raises to my program');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByText(/Thinking…/).waitFor();
  await page.getByText('I\'ve added calf raises').waitFor({ timeout: 20000 });
  await page.getByText('✓ Saved to your program').waitFor();
  if (await page.locator('.error').count()) throw new Error(`error shown: ${await page.locator('.error').first().textContent()}`);
  await page.unroute('**/functions/v1/coach');
  await page.goto(`${B}/program`);
  await page.getByText('Calf Raise').first().waitFor();
});

await step('progress shows the written summary', async () => {
  await page.goto(`${B}/progress`);
  await page.getByRole('heading', { name: 'Your training lately' }).waitFor();
  await page.getByRole('heading', { name: 'Focus for the next 1–3 months' }).waitFor();
});

await step('settings shows the plan and matching versions; sign out returns to sign-in', async () => {
  await page.goto(`${B}/settings`);
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  await page.getByText(/coach up to date/).waitFor();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
});

await step('signing back in works, and another account sees none of the first one\'s data', async () => {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password').fill('supersecret1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Your plan' }).waitFor();
  await page.goto(B);
  await page.getByText('Resume workout').waitFor();
  await page.goto(`${B}/settings`);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByText('Create an account').click();
  await page.getByLabel('Name').fill('Sam');
  await page.getByLabel('Email', { exact: true }).fill(`other${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('supersecret2');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('What are you training for?').waitFor();
  const leftovers = await page.evaluate(async () => ({
    outbox: localStorage.getItem('lh_outbox'), timer: localStorage.getItem('lh_timer'), cached: (await caches.keys()).includes('api') ? (await (await caches.open('api')).keys()).length : 0,
  }));
  if (leftovers.outbox || leftovers.timer) throw new Error(`left on the device: ${JSON.stringify(leftovers)}`);
});

await step('no page errors or blocked resources', async () => {
  if (problems.length) throw new Error(problems.slice(0, 5).join(' | '));
});

await browser.close();
await new Promise((r) => web.close(r));
await stopApi();
fs.rmSync(dist, { recursive: true, force: true });
console.log(failed ? `\n${failed} step(s) failed. Screenshots: ${out}` : '\nAll browser steps passed.');
process.exit(failed ? 1 : 0);
