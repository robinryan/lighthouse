// A small stand-in for the parts of supabase-js the app uses, executing real SQL on
// Postgres as the `authenticated` role with the user's JWT claims set — so the
// migration's row level security is what's actually being exercised.

import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // date → 'YYYY-MM-DD', like PostgREST
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(20, (v) => Number(v)); // bigint ids → number
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

type Result = { data: any; error: { message: string } | null; status: number };

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const toParam = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private cols = '*';
  private returning: string | null = null;
  private filters: Array<(p: unknown[]) => string> = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private off: number | null = null;
  private one: 'single' | 'maybe' | null = null;
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private conflict: string[] = [];

  constructor(private run: (sql: string, params: unknown[]) => Promise<any[]>, private table: string) {}

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else this.returning = cols;
    return this;
  }
  insert(rows: object | object[]) { this.op = 'insert'; this.rows = ([] as object[]).concat(rows) as Record<string, unknown>[]; return this; }
  upsert(rows: object | object[], opts: { onConflict: string }) {
    this.op = 'upsert'; this.rows = ([] as object[]).concat(rows) as Record<string, unknown>[];
    this.conflict = opts.onConflict.split(',').map((s) => s.trim());
    return this;
  }
  update(patch: object) { this.op = 'update'; this.patch = patch as Record<string, unknown>; return this; }
  delete() { this.op = 'delete'; return this; }

  private where(op: string, col: string, v: unknown) {
    this.filters.push((p) => { p.push(toParam(v)); return `${q(col)} ${op} $${p.length}`; });
    return this;
  }
  eq(c: string, v: unknown) { return this.where('=', c, v); }
  neq(c: string, v: unknown) { return this.where('<>', c, v); }
  gte(c: string, v: unknown) { return this.where('>=', c, v); }
  gt(c: string, v: unknown) { return this.where('>', c, v); }
  lte(c: string, v: unknown) { return this.where('<=', c, v); }
  lt(c: string, v: unknown) { return this.where('<', c, v); }
  in(c: string, vs: unknown[]) {
    this.filters.push((p) => { p.push(vs); return `${q(c)} = ANY($${p.length})`; });
    return this;
  }
  is(c: string, v: null) { if (v !== null) throw new Error('is() only supports null'); this.filters.push(() => `${q(c)} IS NULL`); return this; }
  not(c: string, op: string, v: unknown) {
    if (op !== 'is' || v !== null) throw new Error('not() only supports is null');
    this.filters.push(() => `${q(c)} IS NOT NULL`);
    return this;
  }
  order(c: string, opts: { ascending?: boolean } = {}) { this.orders.push(`${q(c)} ${opts.ascending === false ? 'DESC' : 'ASC'}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.off = a; this.lim = b - a + 1; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }

  private colList(cols: string) {
    return cols.trim() === '*' ? '*' : cols.split(',').map((c) => q(c.trim())).join(', ');
  }

  private build(): [string, unknown[]] {
    const p: unknown[] = [];
    const where = () => (this.filters.length ? ` WHERE ${this.filters.map((f) => f(p)).join(' AND ')}` : '');
    const ret = this.returning ? ` RETURNING ${this.colList(this.returning)}` : '';
    if (this.op === 'select') {
      let sql = `SELECT ${this.colList(this.cols)} FROM ${q(this.table)}${where()}`;
      if (this.orders.length) sql += ` ORDER BY ${this.orders.join(', ')}`;
      if (this.lim != null) sql += ` LIMIT ${this.lim}`;
      if (this.off != null) sql += ` OFFSET ${this.off}`;
      return [sql, p];
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const values = this.rows.map((r) => `(${keys.map((k) => {
        if (!(k in r)) return 'DEFAULT';
        p.push(toParam(r[k]));
        return `$${p.length}`;
      }).join(', ')})`).join(', ');
      let sql = `INSERT INTO ${q(this.table)} (${keys.map(q).join(', ')}) VALUES ${values}`;
      if (this.op === 'upsert') {
        const set = keys.filter((k) => !this.conflict.includes(k)).map((k) => `${q(k)} = EXCLUDED.${q(k)}`);
        sql += ` ON CONFLICT (${this.conflict.map(q).join(', ')}) ${set.length ? `DO UPDATE SET ${set.join(', ')}` : 'DO NOTHING'}`;
      }
      return [sql + ret, p];
    }
    if (this.op === 'update') {
      const set = Object.entries(this.patch).map(([k, v]) => { p.push(toParam(v)); return `${q(k)} = $${p.length}`; });
      if (!this.filters.length) throw new Error('UPDATE requires a filter (Supabase safeupdate)');
      return [`UPDATE ${q(this.table)} SET ${set.join(', ')}${where()}${ret}`, p];
    }
    if (!this.filters.length) throw new Error('DELETE requires a filter (Supabase safeupdate)');
    return [`DELETE FROM ${q(this.table)}${where()}${ret}`, p];
  }

  async exec(): Promise<Result> {
    try {
      const [sql, params] = this.build();
      const rows = await this.run(sql, params);
      if (this.op !== 'select' && !this.returning) return { data: null, error: null, status: 201 };
      if (this.one === 'single') {
        if (rows.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rows.length}` }, status: 406 };
        return { data: rows[0], error: null, status: 200 };
      }
      if (this.one === 'maybe') {
        if (rows.length > 1) return { data: null, error: { message: 'multiple rows' }, status: 406 };
        return { data: rows[0] ?? null, error: null, status: 200 };
      }
      return { data: rows, error: null, status: 200 };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message }, status: 400 };
    }
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.exec().then(ok, fail);
  }
}

export function fakeSupabase(pool: pg.Pool, user: { id: string; email: string }) {
  const run = async (sql: string, params: unknown[]) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user.id, role: 'authenticated' })]);
      const r = await c.query(sql, params);
      await c.query('COMMIT');
      return r.rows;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  return {
    from: (table: string) => new Query(run, table),
    rpc: async (fn: string, args: Record<string, unknown>): Promise<Result> => {
      try {
        const keys = Object.keys(args);
        const rows = await run(`SELECT ${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')}) AS r`, keys.map((k) => args[k]));
        return { data: rows[0]?.r ?? null, error: null, status: 200 };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message }, status: 400 };
      }
    },
    auth: { getSession: async () => ({ data: { session: { user } } }) },
  };
}
