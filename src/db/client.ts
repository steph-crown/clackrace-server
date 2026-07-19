import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import * as schema from "./schema.js";

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const sql = postgres(env.databaseUrl, { max: 10 });
export const db = drizzle(sql, { schema });
