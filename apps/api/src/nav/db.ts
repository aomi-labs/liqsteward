import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema.js";

export type NavDb = NodePgDatabase<typeof schema>;

export function createNavDb(databaseUrl: string): { db: NavDb; close: () => Promise<void> } {
  const ca = process.env.DATABASE_CA_CERT;
  const url = new URL(databaseUrl);
  // URL SSL options override pg's explicit TLS configuration, including its CA.
  if (ca) {
    for (const option of ["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(option);
  }
  const pool = new pg.Pool({
    connectionString: ca ? url.toString() : databaseUrl,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
  });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function migrateNavDb(db: NavDb): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
}
