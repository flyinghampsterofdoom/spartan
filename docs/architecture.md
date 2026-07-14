# Spartan MVP architecture

## Recommended stack

- **Web:** TypeScript, React 19, Next-compatible Vinext app router, Tailwind/CSS.
- **Runtime:** Node 22 on Render using a Next-compatible Vinext app router. Route handlers remain stateless and API-ready for a future native app.
- **Database:** Render PostgreSQL 18 with Drizzle ORM, checked-in migrations, and managed PgBouncer.
- **Files:** Object storage for punch photos and future documents; PostgreSQL stores attachment metadata and visibility.
- **Identity:** Native email/password sessions and organization invitations are the production target. Application roles and permissions remain in Spartan's own database.
- **Exports:** Server-generated CSV initially; XLSX and accounting/payroll adapters can be added behind the reporting service.

## Application architecture

The browser and a future native client call the same route/service layer. Authorization is enforced server-side. Modules share canonical relational records; there is no separate scheduling, payroll, or punch database.

`Web/native clients -> route handlers -> authorization + domain services -> Drizzle -> PostgreSQL / object storage`

Domain boundaries are Projects, People, Scheduling, Timekeeping, Punch, Reporting, and Audit. Cross-module changes write the business record and an audit/event record in the same transaction where possible.

## Entity relationship structure

- A User can belong to one or more Organizations through Memberships. Memberships have a Role and optional Permission Overrides; an Employee may link to a User.
- Employees join Crews and are assigned or scheduled to Projects.
- ScheduleEntry is planned labor; TimeEntry plus BreakEntry is actual labor.
- TimeEntry stores an immutable wage snapshot; WageHistory records employee wage changes.
- Projects own Areas, PunchLists, PunchItems, schedules, time, and assignments.
- PunchItem has one canonical current state plus append-only PunchItemEvents.
- Attachments reference an owner type/id and store bytes in R2.
- AuditEvent records actor, entity, action, before/after values, reason, and timestamp.

The complete initial relational schema is in `db/schema.ts`. PostgreSQL migrations
run as a Render pre-deploy command, so a failed migration prevents a new release
from replacing the last healthy deployment.

## Permission model

Permissions are capabilities, not UI labels. Effective access is: explicit user override, then role grant, otherwise denied. Every sensitive API action checks a capability and record scope.

| Area | Owner | Manager | Foreman | Employee | Viewer |
| --- | --- | --- | --- | --- | --- |
| Projects / schedule | Full | Manage | Assigned scope | Own view | View |
| Employee records | Full | Manage | Crew view | Own view | Limited view |
| Wage view / edit | Full | Explicit grant | Explicit grant | Never | Never |
| Time editing / approval | Full | Manage | Assigned scope | Request own correction | View only |
| Punch work | Full | Manage/approve | Assigned scope/approve | Update assigned work | View only |
| Reports / exports | Full | Granted | Granted summaries | Own time | Granted view |

Employees can never approve their own time or punch work. Wage capabilities are separate from employee visibility. Data queries also enforce project, crew, or self scope.

## Primary user flows

1. Employee opens Today, sees scheduled job, clocks in, starts/ends lunch, then clocks out.
2. Manager builds a weekly schedule from crews, then overrides individuals.
3. Employee requests a time correction; authorized reviewer edits with a required reason and audit event, then approves.
4. Manager changes a wage with an effective date; new entries snapshot it while history remains unchanged.
5. Foreman creates punch items rapidly by area, assigns work, reviews completion, requests rework or approves.
6. Owner filters labor reports and exports payroll-ready CSV.

## Folder structure

```text
app/                 routes, screens, route handlers
components/          shared shell and field/manager UI
db/                  schema and database access
drizzle/             generated SQL migrations
lib/                  permissions, domain services, validation
public/               static assets
worker/               Cloudflare worker entry
docs/                 architecture and product decisions
tests/                rendered and domain tests
```

## MVP implementation plan

1. Foundation: schema, identity, roles, permission checks, audit helpers, seed data.
2. Operations shell: responsive navigation, manager dashboard, employee Today screen.
3. People/projects: employee, wage history, crews, project areas/categories.
4. Planning: weekly company/project/employee schedules and crew assignment.
5. Actuals: clock workflow, multi-break model, corrections, review/approval.
6. Punch: lists, rapid walk entry, assignment, photos, event-driven review/rework.
7. Reporting: timecards, project labor, schedule variance, CSV payroll export.
8. Hardening: validation, scoped authorization tests, accessibility, mobile QA, backups/retention.
