import { createHash } from "node:crypto";
import { getSql } from "@/db";

function loginKey(email: string, ipAddress: string | null) {
  return createHash("sha256").update(`${email.trim().toLowerCase()}|${ipAddress ?? "unknown"}`).digest("hex");
}

export async function isLoginAllowed(email: string, ipAddress: string | null) {
  const rows = await getSql()<{ blocked: boolean }[]>`
    select coalesce(blocked_until > now(), false) as blocked
    from auth_login_attempts where key_hash = ${loginKey(email, ipAddress)} limit 1
  `;
  return !rows[0]?.blocked;
}

export async function recordFailedLogin(email: string, ipAddress: string | null) {
  const sql = getSql();
  const key = loginKey(email, ipAddress);
  await sql`
    insert into auth_login_attempts (key_hash, attempt_count, window_started_at, last_attempt_at)
    values (${key}, 1, now(), now())
    on conflict (key_hash) do update set
      attempt_count = case when auth_login_attempts.window_started_at < now() - interval '15 minutes' then 1 else auth_login_attempts.attempt_count + 1 end,
      window_started_at = case when auth_login_attempts.window_started_at < now() - interval '15 minutes' then now() else auth_login_attempts.window_started_at end,
      last_attempt_at = now(),
      blocked_until = case
        when (case when auth_login_attempts.window_started_at < now() - interval '15 minutes' then 1 else auth_login_attempts.attempt_count + 1 end) >= 8
        then now() + interval '15 minutes'
        else auth_login_attempts.blocked_until
      end
  `;
}

export async function clearFailedLogins(email: string, ipAddress: string | null) {
  await getSql()`delete from auth_login_attempts where key_hash = ${loginKey(email, ipAddress)}`;
}
