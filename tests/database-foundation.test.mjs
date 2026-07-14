import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("the initial PostgreSQL migration creates Spartan's canonical model", async () => {
  const db = new PGlite();
  const migration = await readFile(
    new URL("../drizzle/0000_sudden_daredevil.sql", import.meta.url),
    "utf8",
  );

  await db.exec(migration.replaceAll("--> statement-breakpoint", ""));

  const tables = await db.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const tableNames = new Set(tables.rows.map((row) => row.table_name));

  for (const required of [
    "organizations",
    "organization_memberships",
    "sessions",
    "employees",
    "projects",
    "schedule_entries",
    "time_entries",
    "break_entries",
    "wage_history",
    "punch_items",
    "punch_item_events",
    "attachments",
    "audit_events",
  ]) {
    assert.ok(tableNames.has(required), `missing required table: ${required}`);
  }

  assert.equal(tableNames.size, 26);

  const timeColumns = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'time_entries'
  `);
  const timeColumnNames = new Set(timeColumns.rows.map((row) => row.column_name));
  assert.ok(timeColumnNames.has("wage_snapshot_cents"));
  assert.ok(timeColumnNames.has("regular_minutes"));
  assert.ok(timeColumnNames.has("overtime_minutes"));

  await db.close();
});
