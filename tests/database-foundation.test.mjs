import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("the initial PostgreSQL migration creates Spartan's canonical model", async () => {
  const db = new PGlite();
  const migrationFiles = ["0000_sudden_daredevil.sql", "0001_omniscient_nemesis.sql", "0002_lyrical_annihilus.sql", "0003_dry_ender_wiggin.sql"];
  const migrations = await Promise.all(migrationFiles.map((file) => readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8")));

  for (const migration of migrations) await db.exec(migration.replaceAll("--> statement-breakpoint", ""));

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
    "password_reset_tokens",
    "platform_access",
    "email_deliveries",
    "auth_login_attempts",
  ]) {
    assert.ok(tableNames.has(required), `missing required table: ${required}`);
  }

  assert.equal(tableNames.size, 30);

  const timeColumns = await db.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'time_entries'
  `);
  const timeColumnNames = new Set(timeColumns.rows.map((row) => row.column_name));
  assert.ok(timeColumnNames.has("wage_snapshot_cents"));
  assert.ok(timeColumnNames.has("regular_minutes"));
  assert.ok(timeColumnNames.has("overtime_minutes"));

  const attachmentColumns = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='attachments'`);
  const attachmentColumnNames = new Set(attachmentColumns.rows.map((row) => row.column_name));
  for (const column of ["checksum_sha256", "related_event_id", "metadata", "deleted_at", "deleted_by_user_id", "deletion_reason", "object_delete_pending"]) assert.ok(attachmentColumnNames.has(column));

  const punchColumns = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='punch_items'`);
  assert.ok(new Set(punchColumns.rows.map((row) => row.column_name)).has("client_request_id"));

  await db.close();
});
