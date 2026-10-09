// Turns API usage into an estimated dollar cost. Prices are USD per million tokens
// (Anthropic list prices, October 2026). Check https://www.anthropic.com/pricing when they change.

export interface ModelPrice { input: number; output: number; cacheWrite: number; cacheRead: number }

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/** Web search is billed per search. */
export const WEB_SEARCH_PER_SEARCH = 0.01;

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
  requests: number;
}

export const emptyUsage = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, webSearches: 0, requests: 0 });

// deno-lint-ignore no-explicit-any
export function addUsage(t: UsageTotals, u: any) {
  if (!u) return;
  t.inputTokens += u.input_tokens ?? 0;
  t.outputTokens += u.output_tokens ?? 0;
  t.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  t.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  t.webSearches += u.server_tool_use?.web_search_requests ?? 0;
  t.requests += 1;
}

/** Unknown models are priced as Opus so estimates err on the high side. */
export function costUsd(model: string, t: UsageTotals): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const tokens = (t.inputTokens * p.input + t.outputTokens * p.output + t.cacheWriteTokens * p.cacheWrite + t.cacheReadTokens * p.cacheRead) / 1_000_000;
  return Math.round((tokens + t.webSearches * WEB_SEARCH_PER_SEARCH) * 10_000) / 10_000;
}
