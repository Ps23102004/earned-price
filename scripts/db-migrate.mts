// Applies db/schema.sql to the direct (non-pooled) Neon connection. Idempotent.
// Run: pnpm db:migrate

import { readFileSync } from "node:fs";
import pg from "pg";
import { withVerifyFull } from "../src/store/db";

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error("DATABASE_URL_DIRECT is not set");
  process.exit(1);
}
const client = new pg.Client({ connectionString: withVerifyFull(url) });
await client.connect();
try {
  await client.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const { rows } = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('rules','orders','redemptions','refunds')");
  console.log(`migrate ok: ${rows[0].n}/4 tables present`);
} finally {
  await client.end();
}
