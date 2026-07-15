import postgres from "postgres";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../lib/auth/crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed Spartan.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const bootstrapEmail = process.env.SPARTAN_BOOTSTRAP_EMAIL?.trim().toLowerCase() || "justin.rawlinson@gmail.com";
const bootstrapPasswordHash = process.env.SPARTAN_BOOTSTRAP_PASSWORD
  ? await hashPassword(process.env.SPARTAN_BOOTSTRAP_PASSWORD)
  : null;
let bootstrapInvitationLink: string | null = null;

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  ownerUser: "00000000-0000-4000-8000-000000000002",
  ownerMembership: "00000000-0000-4000-8000-000000000003",
  roles: {
    owner: "10000000-0000-4000-8000-000000000001",
    manager: "10000000-0000-4000-8000-000000000002",
    foreman: "10000000-0000-4000-8000-000000000003",
    employee: "10000000-0000-4000-8000-000000000004",
    viewer: "10000000-0000-4000-8000-000000000005",
  },
  employees: {
    justin: "20000000-0000-4000-8000-000000000001",
    jake: "20000000-0000-4000-8000-000000000002",
    carlos: "20000000-0000-4000-8000-000000000003",
    mike: "20000000-0000-4000-8000-000000000004",
    sam: "20000000-0000-4000-8000-000000000005",
    maya: "20000000-0000-4000-8000-000000000006",
  },
  crews: {
    interior: "30000000-0000-4000-8000-000000000001",
    finish: "30000000-0000-4000-8000-000000000002",
  },
  projects: {
    smith: "40000000-0000-4000-8000-000000000001",
    johnson: "40000000-0000-4000-8000-000000000002",
    mercer: "40000000-0000-4000-8000-000000000003",
  },
};

const roles = [
  [ids.roles.owner, "Owner", "Full organization access"],
  [ids.roles.manager, "Manager", "Operational management access"],
  [ids.roles.foreman, "Foreman", "Assigned project and crew access"],
  [ids.roles.employee, "Employee", "Personal schedule, time, and assigned punch work"],
  [ids.roles.viewer, "Viewer", "Read-only scoped access"],
] as const;

const permissionKeys = [
  "projects.view", "projects.manage", "employees.view", "employees.manage",
  "wages.view", "wages.manage", "schedules.view", "schedules.manage",
  "time.view", "time.clock", "time.edit", "time.approve",
  "punch.view", "punch.work", "punch.manage", "punch.approve",
  "reports.view", "exports.create", "settings.manage",
  "organization.settings.manage", "organization.memberships.manage", "organization.invitations.manage",
  "wage.view", "wage.edit", "wage.audit", "platform.diagnostics.view",
] as const;

const employees = [
  [ids.employees.justin, "EMP-001", "Justin", "Rawlinson", bootstrapEmail, ids.roles.owner, 4200, "2026-01-01"],
  [ids.employees.jake, "EMP-014", "Jake", "Morrison", "jake@example.com", ids.roles.foreman, 3100, "2026-06-01"],
  [ids.employees.carlos, "EMP-018", "Carlos", "Diaz", "carlos@example.com", ids.roles.employee, 2850, "2026-01-01"],
  [ids.employees.mike, "EMP-021", "Mike", "Mercer", "mike@example.com", ids.roles.foreman, 3350, "2026-03-15"],
  [ids.employees.sam, "EMP-024", "Sam", "Chen", "sam@example.com", ids.roles.employee, 2750, "2026-01-01"],
  [ids.employees.maya, "EMP-027", "Maya", "Brooks", "maya@example.com", ids.roles.manager, 3900, "2026-05-01"],
] as const;

await sql.begin(async (transaction) => {
  // postgres.js omits the tag call signature from its transaction helper type.
  const tx = transaction as unknown as typeof sql;
  for (const [id, name, description] of roles) {
    await tx`insert into roles (id, name, description) values (${id}, ${name}, ${description}) on conflict (name) do nothing`;
  }

  for (let i = 0; i < permissionKeys.length; i += 1) {
    const key = permissionKeys[i];
    const id = `11000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
    await tx`insert into permissions (id, key, description) values (${id}, ${key}, ${key}) on conflict (key) do nothing`;
  }

  await tx`
    insert into role_permissions (role_id, permission_id)
    select ${ids.roles.owner}::uuid, id from permissions
    on conflict (role_id, permission_id) do nothing
  `;
  await tx`
    delete from role_permissions
    where role_id = ${ids.roles.manager} and permission_id in (
      select id from permissions where key in ('settings.manage','wages.view','wages.manage','wage.view','wage.edit','wage.audit','platform.diagnostics.view')
    )
  `;
  await tx`
    insert into role_permissions (role_id, permission_id)
    select ${ids.roles.manager}::uuid, id from permissions
    where key not in ('settings.manage','wages.view','wages.manage','wage.view','wage.edit','wage.audit','platform.diagnostics.view')
    on conflict (role_id, permission_id) do nothing
  `;
  await tx`
    insert into role_permissions (role_id, permission_id)
    select ${ids.roles.foreman}::uuid, id from permissions
    where key in ('projects.view','employees.view','schedules.view','schedules.manage','time.view','time.clock','time.edit','time.approve','punch.view','punch.work','punch.manage','punch.approve','reports.view')
    on conflict (role_id, permission_id) do nothing
  `;
  await tx`
    update role_permissions set scope = 'assigned_project'
    where role_id = ${ids.roles.foreman} and permission_id in (
      select id from permissions where key in ('projects.view','schedules.view','time.view','time.edit','time.approve','punch.view','punch.work','punch.manage','punch.approve','reports.view')
    )
  `;
  await tx`
    update role_permissions set scope = 'assigned_crew'
    where role_id = ${ids.roles.foreman} and permission_id in (
      select id from permissions where key in ('employees.view','schedules.manage')
    )
  `;
  await tx`
    insert into role_permissions (role_id, permission_id)
    select ${ids.roles.employee}::uuid, id from permissions
    where key in ('projects.view','schedules.view','time.view','time.clock','punch.view','punch.work')
    on conflict (role_id, permission_id) do nothing
  `;
  await tx`
    update role_permissions set scope = 'self'
    where role_id = ${ids.roles.employee} and permission_id in (
      select id from permissions where key in ('schedules.view','time.view','time.clock','punch.work')
    )
  `;
  await tx`
    insert into role_permissions (role_id, permission_id)
    select ${ids.roles.viewer}::uuid, id from permissions
    where key in ('projects.view','employees.view','schedules.view','time.view','punch.view','reports.view')
    on conflict (role_id, permission_id) do nothing
  `;

  await tx`insert into organizations (id, name, slug) values (${ids.organization}, 'Spartan Construction', 'spartan-construction') on conflict (slug) do nothing`;
  await tx`
    insert into users (id, email, display_name, password_hash, active, status, email_verified_at, password_changed_at)
    values (${ids.ownerUser}, ${bootstrapEmail}, 'Justin Rawlinson', ${bootstrapPasswordHash}, true, 'active', now(), ${bootstrapPasswordHash ? new Date() : null})
    on conflict (id) do update set email = excluded.email,
      password_hash = coalesce(excluded.password_hash, users.password_hash),
      status = 'active', active = true, updated_at = now()
  `;
  await tx`
    insert into organization_memberships (id, organization_id, user_id, role_id, status, joined_at)
    values (${ids.ownerMembership}, ${ids.organization}, ${ids.ownerUser}, ${ids.roles.owner}, 'active', now())
    on conflict (organization_id, user_id) do update set status = 'active', role_id = excluded.role_id, updated_at = now()
  `;
  await tx`
    insert into platform_access (user_id, role, status, granted_by_user_id)
    values (${ids.ownerUser}, 'PLATFORM_ADMIN', 'active', ${ids.ownerUser})
    on conflict (user_id, role) do update set status = 'active', revoked_at = null
  `;

  for (const [id, number, first, last, email, roleId, wage, effectiveDate] of employees) {
    await tx`
      insert into employees (id, organization_id, user_id, employee_number, first_name, last_name, email, role_id, default_hourly_wage_cents, wage_effective_date)
      values (${id}, ${ids.organization}, ${id === ids.employees.justin ? ids.ownerUser : null}, ${number}, ${first}, ${last}, ${email}, ${roleId}, ${wage}, ${effectiveDate})
      on conflict (organization_id, employee_number) do update set
        email = excluded.email,
        user_id = coalesce(excluded.user_id, employees.user_id),
        updated_at = now()
    `;
    await tx`
      insert into wage_history (employee_id, old_wage_cents, new_wage_cents, effective_date, changed_by_user_id, reason)
      select ${id}, null, ${wage}, ${effectiveDate}, ${ids.ownerUser}, 'Initial wage import'
      where not exists (select 1 from wage_history where employee_id = ${id} and effective_date = ${effectiveDate})
    `;
  }
  await tx`update organization_memberships set employee_id = ${ids.employees.justin}, updated_at = now() where id = ${ids.ownerMembership}`;

  await tx`insert into crews (id, organization_id, name, foreman_employee_id) values (${ids.crews.interior}, ${ids.organization}, 'Justin Interior Crew', ${ids.employees.jake}) on conflict (organization_id, name) do nothing`;
  await tx`insert into crews (id, organization_id, name, foreman_employee_id) values (${ids.crews.finish}, ${ids.organization}, 'Mercer Finish Crew', ${ids.employees.mike}) on conflict (organization_id, name) do nothing`;

  for (const [crewId, employeeId] of [
    [ids.crews.interior, ids.employees.jake], [ids.crews.interior, ids.employees.carlos],
    [ids.crews.interior, ids.employees.sam], [ids.crews.finish, ids.employees.mike],
    [ids.crews.finish, ids.employees.maya],
  ]) {
    await tx`insert into crew_members (crew_id, employee_id, starts_on) values (${crewId}, ${employeeId}, '2026-01-01') on conflict (crew_id, employee_id, starts_on) do nothing`;
  }

  await tx`insert into projects (id, organization_id, project_number, name, client_name, jobsite_address, status, start_date, estimated_completion_date, manager_employee_id, foreman_employee_id, notes) values (${ids.projects.smith}, ${ids.organization}, 'S-1042', 'Smith Residence', 'Alex and Morgan Smith', '3427 Hawthorne Ave, Portland, OR', 'Active', '2026-02-02', '2026-08-28', ${ids.employees.maya}, ${ids.employees.jake}, 'Interior finish phase') on conflict (organization_id, project_number) do nothing`;
  await tx`insert into projects (id, organization_id, project_number, name, client_name, jobsite_address, status, start_date, estimated_completion_date, manager_employee_id, foreman_employee_id) values (${ids.projects.johnson}, ${ids.organization}, 'J-1038', 'Johnson Remodel', 'Jordan Johnson', '118 SE Alder St, Portland, OR', 'Active', '2026-03-16', '2026-09-18', ${ids.employees.maya}, ${ids.employees.jake}) on conflict (organization_id, project_number) do nothing`;
  await tx`insert into projects (id, organization_id, project_number, name, client_name, jobsite_address, status, start_date, estimated_completion_date, manager_employee_id, foreman_employee_id) values (${ids.projects.mercer}, ${ids.organization}, 'M-1051', 'Mercer Offices', 'Mercer & Co.', '620 SW Fifth Ave, Portland, OR', 'Punch', '2025-11-03', '2026-07-24', ${ids.employees.maya}, ${ids.employees.mike}) on conflict (organization_id, project_number) do nothing`;

  for (const [id, name, code] of [
    ["50000000-0000-4000-8000-000000000001", "General", "GENERAL"],
    ["50000000-0000-4000-8000-000000000002", "Painting", "PAINT"],
    ["50000000-0000-4000-8000-000000000003", "Finish Carpentry", "FINISH"],
    ["50000000-0000-4000-8000-000000000004", "Cleanup", "CLEANUP"],
  ]) {
    await tx`insert into work_categories (id, organization_id, name, code) values (${id}, ${ids.organization}, ${name}, ${code}) on conflict (organization_id, code) do nothing`;
  }

  const scheduleRows = [
    ["60000000-0000-4000-8000-000000000001", ids.employees.jake, "2026-07-14", "07:00", "15:30", ids.projects.smith, ids.crews.interior],
    ["60000000-0000-4000-8000-000000000002", ids.employees.carlos, "2026-07-14", "07:00", "15:30", ids.projects.smith, ids.crews.interior],
    ["60000000-0000-4000-8000-000000000003", ids.employees.sam, "2026-07-14", "07:00", "12:00", ids.projects.smith, ids.crews.interior],
    ["60000000-0000-4000-8000-000000000004", ids.employees.sam, "2026-07-14", "13:00", "16:00", ids.projects.johnson, ids.crews.interior],
    ["60000000-0000-4000-8000-000000000005", ids.employees.mike, "2026-07-14", "07:30", "16:00", ids.projects.mercer, ids.crews.finish],
  ] as const;
  for (const [id, employeeId, workDate, startTime, endTime, projectId, crewId] of scheduleRows) {
    await tx`insert into schedule_entries (id, organization_id, employee_id, work_date, status, start_time, end_time, project_id, crew_id, foreman_employee_id, created_by_user_id) values (${id}, ${ids.organization}, ${employeeId}, ${workDate}, 'scheduled_to_work', ${startTime}, ${endTime}, ${projectId}, ${crewId}, ${ids.employees.jake}, ${ids.ownerUser}) on conflict (id) do nothing`;
  }

  await tx`insert into time_entries (id, organization_id, employee_id, work_date, project_id, schedule_entry_id, clock_in_at, clock_out_at, gross_minutes, unpaid_break_minutes, paid_minutes, regular_minutes, overtime_minutes, wage_snapshot_cents, labor_cost_cents, status) values ('70000000-0000-4000-8000-000000000001', ${ids.organization}, ${ids.employees.jake}, '2026-07-13', ${ids.projects.smith}, null, '2026-07-13T14:08:00Z', '2026-07-13T23:02:00Z', 534, 30, 504, 480, 24, 3100, 26660, 'approved') on conflict (id) do nothing`;
  await tx`insert into time_entries (id, organization_id, employee_id, work_date, project_id, schedule_entry_id, clock_in_at, gross_minutes, unpaid_break_minutes, paid_minutes, regular_minutes, overtime_minutes, wage_snapshot_cents, labor_cost_cents, status) values ('70000000-0000-4000-8000-000000000002', ${ids.organization}, ${ids.employees.jake}, '2026-07-14', ${ids.projects.smith}, '60000000-0000-4000-8000-000000000001', '2026-07-14T14:08:00Z', 0, 0, 0, 0, 0, 3100, 0, 'active') on conflict (id) do nothing`;

  await tx`insert into punch_lists (id, project_id, name, description, created_by_user_id) values ('80000000-0000-4000-8000-000000000001', ${ids.projects.smith}, 'Final Construction Punch', 'Internal final walkthrough', ${ids.ownerUser}) on conflict (id) do nothing`;
  await tx`insert into punch_lists (id, project_id, name, description, created_by_user_id) values ('80000000-0000-4000-8000-000000000002', ${ids.projects.mercer}, 'Client Walkthrough', 'Client closeout items', ${ids.ownerUser}) on conflict (id) do nothing`;
  await tx`insert into punch_items (id, item_number, project_id, punch_list_id, description, priority, assigned_employee_id, due_date, execution_status, verification_status, created_by_user_id) values ('81000000-0000-4000-8000-000000000001', 'P-001', ${ids.projects.smith}, '80000000-0000-4000-8000-000000000001', 'Touch up paint above primary bathroom vanity', 'normal', ${ids.employees.carlos}, '2026-07-17', 'in_progress', 'not_reviewed', ${ids.ownerUser}) on conflict (project_id, item_number) do nothing`;
  await tx`insert into punch_items (id, item_number, project_id, punch_list_id, description, priority, assigned_employee_id, due_date, execution_status, verification_status, exception_status, created_by_user_id) values ('81000000-0000-4000-8000-000000000002', 'P-014', ${ids.projects.mercer}, '80000000-0000-4000-8000-000000000002', 'Correct paint flashing in conference room', 'high', ${ids.employees.mike}, '2026-07-15', 'work_complete', 'rework_required', 'needs_rework', ${ids.ownerUser}) on conflict (project_id, item_number) do nothing`;
  await tx`insert into punch_item_events (id, punch_item_id, event_type, actor_user_id, notes) values ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'review_failed', ${ids.ownerUser}, 'Paint flashing remains visible under conference lighting') on conflict (id) do nothing`;

  if (!bootstrapPasswordHash) {
    const owner = await tx<{ password_hash: string | null }[]>`select password_hash from users where id = ${ids.ownerUser}`;
    if (!owner[0]?.password_hash) {
      const token = createOpaqueToken();
      await tx`update invitations set status = 'revoked', revoked_at = now() where organization_id = ${ids.organization} and lower(email) = ${bootstrapEmail} and status = 'invited'`;
      await tx`
        insert into invitations (organization_id, email, role_id, employee_id, token_hash, invited_by_user_id, expires_at, status)
        values (${ids.organization}, ${bootstrapEmail}, ${ids.roles.owner}, ${ids.employees.justin}, ${hashOpaqueToken(token)}, ${ids.ownerUser}, now() + interval '24 hours', 'invited')
      `;
      bootstrapInvitationLink = new URL(`/invite?token=${encodeURIComponent(token)}`, process.env.APP_URL ?? "http://localhost:3000").toString();
    }
  }
});

await sql.end();
console.log("Spartan demo data is ready.");
if (bootstrapInvitationLink) console.log(`Spartan Owner activation link (expires in 24 hours): ${bootstrapInvitationLink}`);
