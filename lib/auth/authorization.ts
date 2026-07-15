import { getSql } from "@/db";
import { AuthorizationError, requirePermission as requireStaticPermission } from "./policy";
import type { AuthContext, ResourceScope } from "./types";

export { AuthorizationError, can } from "./policy";

export function requirePermission(context: AuthContext, permission: string) {
  requireStaticPermission(context, permission);
}

export async function authorizeResource(context: AuthContext, permission: string, resource: ResourceScope) {
  if (resource.organizationId !== context.organizationId) throw new AuthorizationError();
  const grant = context.permissions[permission];
  if (!grant?.allowed) throw new AuthorizationError();
  if (grant.scope === "organization") return;
  if (grant.scope === "self") {
    if (context.employeeId && context.employeeId === resource.employeeId) return;
    throw new AuthorizationError();
  }
  const sql = getSql();
  if (grant.scope === "assigned_project" && resource.projectId && context.employeeId) {
    const assigned = await sql<{ allowed: boolean }[]>`
      select exists (
        select 1 from projects p
        where p.id = ${resource.projectId} and p.organization_id = ${context.organizationId}
          and (p.foreman_employee_id = ${context.employeeId} or p.manager_employee_id = ${context.employeeId})
        union all
        select 1 from project_assignments pa
        join projects p on p.id = pa.project_id
        where pa.project_id = ${resource.projectId} and p.organization_id = ${context.organizationId}
          and (pa.employee_id = ${context.employeeId} or pa.crew_id in (
            select crew_id from crew_members where employee_id = ${context.employeeId}
          ))
      ) as allowed
    `;
    if (assigned[0]?.allowed) return;
  }
  if (grant.scope === "assigned_crew" && resource.crewId && context.employeeId) {
    const assigned = await sql<{ allowed: boolean }[]>`
      select exists (
        select 1 from crews where id = ${resource.crewId}
          and organization_id = ${context.organizationId} and foreman_employee_id = ${context.employeeId}
      ) as allowed
    `;
    if (assigned[0]?.allowed) return;
  }
  throw new AuthorizationError();
}
