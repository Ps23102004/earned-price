// Postgres pool (Neon pooled URL). One retry on connection-reset errors. No ORM.

import pg from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/** Make the SSL mode explicit so pg does not warn about the require/prefer/verify-ca aliases. */
export function withVerifyFull(url: string): string {
  const u = new URL(url);
  if (u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}

const g = globalThis as unknown as { __epPool?: pg.Pool };

function pool(): pg.Pool {
  if (!g.__epPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__epPool = new pg.Pool({ connectionString: withVerifyFull(url), max: 3, idleTimeoutMillis: 10_000 });
    g.__epPool.on("error", (err) => console.error("pg pool error:", err.message));
  }
  return g.__epPool;
}

function isReset(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "ECONNRESET" || e?.code === "57P01" || /Connection terminated/i.test(e?.message ?? "");
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isReset(err)) throw err;
    return fn();
  }
}

export function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return retry(() => pool().query<T>(text, params));
}

/** BEGIN / COMMIT / ROLLBACK around fn. Only acquiring the connection is retried, never fn. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await retry(() => pool().connect());
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    client.release();
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release(true);
    throw err;
  }
}
