import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSelfApproval, can, ensureAuthenticated, isAccountUsable, redactWages, requirePlatformRole } from "../lib/auth/policy";
import { hashPassword, verifyPassword } from "../lib/auth/crypto";
import type { AuthContext } from "../lib/auth/types";

function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    sessionId: "session-a", userId: "user-a", email: "worker@example.com", displayName: "Worker A",
    organizationId: "org-a", organizationName: "Organization A", membershipId: "membership-a",
    membershipStatus: "active", roleName: "Employee", employeeId: "employee-a",
    permissions: {
      "schedules.view": { allowed: true, scope: "self" },
      "time.view": { allowed: true, scope: "self" },
      "wage.view": { allowed: false, scope: "organization" },
    },
    platformRoles: [],
    ...overrides,
  };
}

test("anonymous requests fail the server authentication guard", () => {
  assert.throws(() => ensureAuthenticated(null), /Authentication is required/);
});

test("organization isolation rejects records from another organization", () => {
  assert.equal(can(context(), "time.view", { organizationId: "org-b", employeeId: "employee-a" }), false);
});

test("an Employee cannot access Owner-only company administration", () => {
  assert.equal(can(context(), "organization.memberships.manage"), false);
  assert.equal(can(context(), "organization.settings.manage"), false);
});

test("assigned scopes require verified project or crew assignment", () => {
  const foreman = context({ permissions: {
    "projects.view": { allowed: true, scope: "assigned_project" },
    "employees.view": { allowed: true, scope: "assigned_crew" },
  } });
  assert.equal(can(foreman, "projects.view", { organizationId: "org-a", projectId: "project-a", projectAssigned: false }), false);
  assert.equal(can(foreman, "projects.view", { organizationId: "org-a", projectId: "project-a", projectAssigned: true }), true);
  assert.equal(can(foreman, "employees.view", { organizationId: "org-a", crewId: "crew-a", crewAssigned: true }), true);
});

test("self-only access permits own schedule and time but rejects another employee", () => {
  const auth = context();
  assert.equal(can(auth, "schedules.view", { organizationId: "org-a", employeeId: "employee-a" }), true);
  assert.equal(can(auth, "time.view", { organizationId: "org-a", employeeId: "employee-b" }), false);
});

test("wages are removed from server responses without wage permission", () => {
  const redacted = redactWages(context(), { id: "employee-a", name: "Worker A", defaultHourlyWageCents: 3100, wageHistory: [3100] });
  assert.equal(redacted.name, "Worker A");
  assert.equal("defaultHourlyWageCents" in redacted, false);
  assert.equal("wageHistory" in redacted, false);
});

test("self approval is rejected for time and punch work", () => {
  const auth = context();
  assert.throws(() => assertNotSelfApproval(auth, "employee-a", "time"), /cannot approve your own time/);
  assert.throws(() => assertNotSelfApproval(auth, "employee-a", "punch"), /cannot approve your own punch/);
});

test("organization Owner role does not imply platform administration", () => {
  assert.throws(() => requirePlatformRole(context({ roleName: "Owner" }), "PLATFORM_ADMIN"), /Platform administration/);
  assert.doesNotThrow(() => requirePlatformRole(context({ platformRoles: ["PLATFORM_ADMIN"] }), "PLATFORM_ADMIN"));
});

test("suspended or disabled accounts and memberships are unusable", () => {
  assert.equal(isAccountUsable({ active: false, status: "disabled" }), false);
  assert.equal(isAccountUsable({ active: true, status: "active" }, { status: "suspended" }), false);
  assert.equal(isAccountUsable({ active: true, status: "active" }, { status: "active" }, { active: false, status: "suspended" }), false);
});

test("password hashing is salted and verifiable", async () => {
  const first = await hashPassword("LongSecurePassword42");
  const second = await hashPassword("LongSecurePassword42");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("LongSecurePassword42", first), true);
  assert.equal(await verifyPassword("IncorrectPassword42", first), false);
});
