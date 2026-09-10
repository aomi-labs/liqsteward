import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema.js";

export type NavDb = NodePgDatabase<typeof schema>;

export function createNavDb(databaseUrl: string): { db: NavDb; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function migrateNavDb(db: NavDb): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  await migrate(db, { migrationsFolder });
}
