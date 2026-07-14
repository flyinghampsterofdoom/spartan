import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: ReturnType<typeof postgres> | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL access.");
  }

  if (!client) {
    client = postgres(databaseUrl, {
      max: 5,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    database = drizzle(client, { schema });
  }

  return database!;
}

export async function closeDb() {
  await client?.end();
  client = undefined;
  database = undefined;
}
