import assert from "node:assert/strict";
import test from "node:test";
import { assertNotSelfApproval, can, ensureAuthenticated, isAccountUsable, redactWages, requirePlatformRole } from "../lib/auth/policy";
import { hashPassword, verifyPassword } from "../lib/auth/crypto";
import type { AuthContext } from "../lib/auth/types";
import { appUrl } from "../lib/http/app-url";
import { assertSameOrigin } from "../lib/http/security";
import { NextRequest } from "next/server";
import { operationScope, parseMoneyToCents, ValidationError } from "../lib/operations";
import { addDays, getWeekStart, parseScheduleDate, scheduleScope, ScheduleValidationError } from "../lib/scheduling";
import { calculateLabor, dateInTimeZone, timeScope } from "../lib/timekeeping";
import { effectiveWageFromHistory, hasWageAdministrationAccess, parseWageCents, parseWageDate, WageValidationError } from "../lib/wages";
import { assertApprovalTransition, assertExecutionTransition, punchAccessScope, punchAssignmentBelongsToEmployee, PunchValidationError } from "../lib/punch";
import { attachmentAccessAllowed, attachmentObjectKey, deletePermissionsForAttachment, eventTypesForAttachmentContext, parseAttachmentRemoval, uploadPermissionsForContext, validateImageSignature, AttachmentValidationError } from "../lib/attachments";
import { reconcileObjectKeys } from "../lib/attachment-maintenance";

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
  const redacted = redactWages(context(), { id: "employee-a", name: "Worker A", defaultHourlyWageCents: 3100, current_wage_cents: 3100, futureWageCents: 3300, snapshotted_labor_cents: 120000, wageHistory: [3100] });
  assert.equal(redacted.name, "Worker A");
  assert.equal("defaultHourlyWageCents" in redacted, false);
  assert.equal("current_wage_cents" in redacted, false);
  assert.equal("futureWageCents" in redacted, false);
  assert.equal("snapshotted_labor_cents" in redacted, false);
  assert.equal("wageHistory" in redacted, false);
});

test("wage administration remains a separate permission boundary", () => {
  assert.equal(hasWageAdministrationAccess(context()), false);
  assert.equal(hasWageAdministrationAccess(context({ permissions: { "wage.audit": { allowed: true, scope: "organization" } } })), true);
});

test("effective wage selection preserves past rates and activates future changes by work date", () => {
  const history = [
    { effectiveDate: "2026-07-01", wageCents: 2800 },
    { effectiveDate: "2026-08-01", wageCents: 3100 },
  ];
  assert.equal(effectiveWageFromHistory(history, "2026-06-30", 2600), 2600);
  assert.equal(effectiveWageFromHistory(history, "2026-07-31", 2600), 2800);
  assert.equal(effectiveWageFromHistory(history, "2026-08-01", 2600), 3100);
  assert.equal(parseWageCents("31.50"), 3150);
  assert.equal(parseWageDate("2026-08-01"), "2026-08-01");
  assert.throws(() => parseWageCents("31.999"), WageValidationError);
  assert.throws(() => parseWageDate("2026-02-31"), WageValidationError);
});

test("self approval is rejected for time and punch work", () => {
  const auth = context();
  assert.throws(() => assertNotSelfApproval(auth, "employee-a", "time"), /cannot approve your own time/);
  assert.throws(() => assertNotSelfApproval(auth, "employee-a", "punch"), /cannot approve your own punch/);
});

test("punch execution and approval remain independent state machines", () => {
  assert.doesNotThrow(() => assertExecutionTransition("not_started", "in_progress", "not_reviewed"));
  assert.doesNotThrow(() => assertExecutionTransition("in_progress", "work_complete", "not_reviewed"));
  assert.doesNotThrow(() => assertApprovalTransition("not_reviewed", "approved", "work_complete"));
  assert.throws(() => assertApprovalTransition("not_reviewed", "approved", "in_progress"), PunchValidationError);
  assert.throws(() => assertExecutionTransition("work_complete", "in_progress", "approved"), PunchValidationError);
});

test("punch rework cycles preserve completion, rejection, and resubmission transitions", () => {
  assert.doesNotThrow(() => assertApprovalTransition("approved", "rework_required", "work_complete"));
  assert.doesNotThrow(() => assertExecutionTransition("work_complete", "in_progress", "rework_required"));
  assert.doesNotThrow(() => assertExecutionTransition("in_progress", "work_complete", "rework_required"));
  assert.doesNotThrow(() => assertApprovalTransition("rework_required", "not_reviewed", "work_complete"));
});

test("punch approval treats direct and crew assignments as self work", () => {
  assert.equal(punchAssignmentBelongsToEmployee("employee-a", "employee-a", false), true);
  assert.equal(punchAssignmentBelongsToEmployee("employee-a", "employee-b", true), true);
  assert.equal(punchAssignmentBelongsToEmployee("employee-a", "employee-b", false), false);
  assert.equal(punchAccessScope(context({ permissions: { "punch.work": { allowed: true, scope: "self" } } })), "self");
});

test("attachment access requires organization isolation and underlying authorization", () => {
  assert.equal(attachmentAccessAllowed("org-a", "org-a", true), true);
  assert.equal(attachmentAccessAllowed("org-a", "org-b", true), false);
  assert.equal(attachmentAccessAllowed("org-a", "org-a", false), false);
});

test("attachment upload and deletion permissions follow workflow context", () => {
  assert.deepEqual(uploadPermissionsForContext("completion"), ["punch.work", "punch.manage"]);
  assert.deepEqual(uploadPermissionsForContext("rejection_review"), ["punch.approve", "punch.manage"]);
  assert.deepEqual(deletePermissionsForAttachment(false, "completion"), ["punch.manage"]);
  assert.deepEqual(deletePermissionsForAttachment(true, "completion"), ["punch.work", "punch.manage"]);
});

test("punch photos resolve to the workflow event that produced them", () => {
  assert.deepEqual(eventTypesForAttachmentContext("initial_issue"), ["item.created"]);
  assert.deepEqual(eventTypesForAttachmentContext("completion"), ["execution.work_complete"]);
  assert.deepEqual(eventTypesForAttachmentContext("rejection_review"), ["approval.rework_required", "approval.approved"]);
});

test("attachment validation rejects MIME spoofing and creates collision-resistant keys", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  assert.doesNotThrow(() => validateImageSignature("image/jpeg", jpeg));
  assert.throws(() => validateImageSignature("image/png", jpeg), AttachmentValidationError);
  const key = attachmentObjectKey("10000000-0000-4000-8000-000000000001", "punch_item", "81000000-0000-4000-8000-000000000001", "91000000-0000-4000-8000-000000000001");
  assert.equal(key, "10000000-0000-4000-8000-000000000001/punch_item/81000000-0000-4000-8000-000000000001/91000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(key, /photo|\.jpg/i);
});

test("attachment removal reasons are structured and Other requires an explanation", () => {
  assert.deepEqual(parseAttachmentRemoval({ reason: "duplicate" }), { reason: "duplicate", reasonLabel: "Duplicate", explanation: null });
  assert.deepEqual(parseAttachmentRemoval({ reason: "other", explanation: "Contains private paperwork" }), { reason: "other", reasonLabel: "Other", explanation: "Contains private paperwork" });
  assert.throws(() => parseAttachmentRemoval({ reason: "other" }), AttachmentValidationError);
  assert.throws(() => parseAttachmentRemoval({ reason: "made_up" }), AttachmentValidationError);
});

test("attachment reconciliation reports orphans and missing active objects without deleting", () => {
  assert.deepEqual(reconcileObjectKeys(["org/kept", "org/orphan"], ["org/kept", "org/pending"], ["org/kept", "org/missing"]), {
    orphanKeys: ["org/orphan"], missingKeys: ["org/missing"],
  });
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

test("production redirects use Render's external HTTPS URL when APP_URL is unset", () => {
  const priorAppUrl = process.env.APP_URL;
  const priorRenderUrl = process.env.RENDER_EXTERNAL_URL;
  delete process.env.APP_URL;
  process.env.RENDER_EXTERNAL_URL = "https://spartan-operations.onrender.com";
  assert.equal(appUrl("/login"), "https://spartan-operations.onrender.com/login");
  if (priorAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = priorAppUrl;
  if (priorRenderUrl === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = priorRenderUrl;
});

test("same-origin protection accepts the configured public origin behind Render's proxy", () => {
  const priorAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://spartan-operations.onrender.com";
  const proxiedRequest = new NextRequest("http://internal-render-host:10000/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      origin: "https://spartan-operations.onrender.com",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.doesNotThrow(() => assertSameOrigin(proxiedRequest));

  const crossOriginRequest = new NextRequest("http://internal-render-host:10000/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.throws(() => assertSameOrigin(crossOriginRequest), /Cross-origin request rejected/);
  if (priorAppUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = priorAppUrl;
});

test("operational list scopes preserve server-side self and assignment boundaries", () => {
  assert.equal(operationScope(context(), "employees.view"), null);
  const selfContext = context({ permissions: { "employees.view": { allowed: true, scope: "self" } } });
  assert.equal(operationScope(selfContext, "employees.view"), "self");
  const foremanContext = context({ permissions: { "projects.view": { allowed: true, scope: "assigned_project" } } });
  assert.equal(operationScope(foremanContext, "projects.view"), "assigned_project");
});

test("hourly wages are normalized to integer cents and malformed values are rejected", () => {
  assert.equal(parseMoneyToCents("28"), 2800);
  assert.equal(parseMoneyToCents("31.50"), 3150);
  assert.throws(() => parseMoneyToCents("31.999"), ValidationError);
  assert.throws(() => parseMoneyToCents("-5"), ValidationError);
});

test("schedule scopes distinguish personal, assigned, and organization-wide access", () => {
  const employee = context({ permissions: { "schedules.view": { allowed: true, scope: "self" } } });
  assert.equal(scheduleScope(employee), "self");
  assert.equal(scheduleScope(employee, "schedules.manage"), null);
  const foreman = context({ permissions: {
    "schedules.view": { allowed: true, scope: "assigned_project" },
    "schedules.manage": { allowed: true, scope: "assigned_crew" },
  } });
  assert.equal(scheduleScope(foreman), "assigned_project");
  assert.equal(scheduleScope(foreman, "schedules.manage"), "assigned_crew");
});

test("weekly schedule date helpers use stable Monday boundaries", () => {
  assert.equal(getWeekStart("2026-07-14"), "2026-07-13");
  assert.equal(getWeekStart("2026-07-19"), "2026-07-13");
  assert.equal(addDays("2026-07-13", 6), "2026-07-19");
  assert.equal(parseScheduleDate("2026-07-14"), "2026-07-14");
  assert.throws(() => parseScheduleDate("2026-02-31"), ScheduleValidationError);
});

test("timekeeping calculations preserve daily regular and overtime allocation", () => {
  assert.deepEqual(calculateLabor({
    clockInMs: Date.parse("2026-07-13T14:08:00Z"),
    clockOutMs: Date.parse("2026-07-13T23:02:00Z"),
    unpaidBreakMinutes: 30,
    wageCents: 3100,
  }), {
    grossMinutes: 534,
    unpaidBreakMinutes: 30,
    paidMinutes: 504,
    regularMinutes: 480,
    overtimeMinutes: 24,
    laborCostCents: 26660,
  });
  const secondProject = calculateLabor({ clockInMs: 0, clockOutMs: 180 * 60000, unpaidBreakMinutes: 0, priorPaidMinutes: 420, wageCents: 3000 });
  assert.equal(secondProject.regularMinutes, 60);
  assert.equal(secondProject.overtimeMinutes, 120);
  assert.equal(secondProject.laborCostCents, 12000);
});

test("timekeeping uses the organization timezone and retains permission scope", () => {
  assert.equal(dateInTimeZone(new Date("2026-07-15T02:00:00Z"), "America/Los_Angeles"), "2026-07-14");
  assert.equal(timeScope(context({ permissions: { "time.view": { allowed: true, scope: "self" } } })), "self");
  assert.equal(timeScope(context({ permissions: { "time.view": { allowed: true, scope: "assigned_project" } } })), "assigned_project");
});
