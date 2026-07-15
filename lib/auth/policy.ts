import type { AuthContext, PermissionGrant, PermissionScope, ResourceScope } from "./types";

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function ensureAuthenticated<T>(context: T | null | undefined): T {
  if (!context) throw new AuthorizationError("Authentication is required.");
  return context;
}

export function isAccountUsable(user: { active: boolean; status: string }, membership?: { status: string }, organization?: { active: boolean; status: string }) {
  if (!user.active || user.status !== "active") return false;
  if (membership && membership.status !== "active") return false;
  if (organization && (!organization.active || organization.status !== "active")) return false;
  return true;
}

export function can(context: AuthContext, permission: string, resource?: ResourceScope) {
  const grant = context.permissions[permission];
  if (!grant?.allowed) return false;
  if (!resource) return grant.scope === "organization";
  if (resource.organizationId !== context.organizationId) return false;
  return scopeAllows(context, grant, resource);
}

function scopeAllows(context: AuthContext, grant: PermissionGrant, resource: ResourceScope) {
  switch (grant.scope as PermissionScope) {
    case "organization":
      return true;
    case "self":
      return Boolean(context.employeeId && resource.employeeId === context.employeeId);
    case "assigned_project":
      return Boolean(resource.projectId && resource.projectAssigned);
    case "assigned_crew":
      return Boolean(resource.crewId && resource.crewAssigned);
    default:
      return false;
  }
}

export function requirePermission(context: AuthContext, permission: string, resource?: ResourceScope) {
  if (!can(context, permission, resource)) throw new AuthorizationError();
}

export function requirePlatformRole(context: AuthContext, ...roles: string[]) {
  if (!roles.some((role) => context.platformRoles.includes(role))) {
    throw new AuthorizationError("Platform administration access is required.");
  }
}

export function assertNotSelfApproval(context: AuthContext, recordEmployeeId: string, kind: "time" | "punch") {
  if (context.employeeId && context.employeeId === recordEmployeeId) {
    throw new AuthorizationError(`You cannot approve your own ${kind} record.`);
  }
}

export function redactWages<T extends Record<string, unknown>>(context: AuthContext, record: T) {
  if (context.permissions["wage.view"]?.allowed) return record;
  const result = { ...record };
  for (const key of [
    "defaultHourlyWageCents", "default_hourly_wage_cents", "wageEffectiveDate", "wage_effective_date",
    "currentWageCents", "current_wage_cents", "futureWageCents", "future_wage_cents",
    "oldWageCents", "old_wage_cents", "newWageCents", "new_wage_cents",
    "wageSnapshotCents", "wage_snapshot_cents", "laborCostCents", "labor_cost_cents",
    "snapshottedLaborCents", "snapshotted_labor_cents", "wageHistory", "wage_history",
  ]) {
    delete result[key];
  }
  return result;
}
