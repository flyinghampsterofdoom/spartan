import Link from "next/link";
import { notFound } from "next/navigation";
import { OperationsFrame } from "@/components/OperationsFrame";
import { requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/auth/policy";
import { getProjectPageData } from "@/lib/operations";

export const dynamic = "force-dynamic";

const hours = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "Not set";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  const { projectId } = await params;
  const [data, query] = await Promise.all([getProjectPageData(auth, projectId), searchParams]);
  if (!data) notFound();
  const { project, assignments, schedule, labor, punch } = data;
  return <OperationsFrame auth={auth} active="/projects"><div className="page project-home">
    <Link className="text-button back-link" href="/projects">← All projects</Link>
    <section className="welcome project-hero"><div><p className="eyebrow">{project.project_number} · {project.status}</p><h1>{project.name}</h1><p>{project.client_name} · {project.jobsite_address}</p></div>{can(auth, "projects.manage") && <Link className="secondary button-anchor" href={`/projects/${project.id}/edit`}>Edit project</Link>}</section>
    {query.saved && <div className="form-success">Project changes saved.</div>}
    <section className="project-summary-strip"><span><small>MANAGER</small><strong>{project.manager_name ?? "Unassigned"}</strong></span><span><small>FOREMAN</small><strong>{project.foreman_name ?? "Unassigned"}</strong></span><span><small>ACTUAL LABOR</small><strong>{hours(labor.paid_minutes)}</strong></span><span><small>OPEN PUNCH</small><strong>{punch.open_count}</strong></span></section>
    <div className="project-sections">
      <ProjectSection title="Job Details" summary={`${project.status} · ${date(project.start_date)} start`} open><div className="project-detail-grid"><Detail label="Client" value={project.client_name}/><Detail label="Jobsite" value={project.jobsite_address}/><Detail label="Start" value={date(project.start_date)}/><Detail label="Estimated completion" value={date(project.estimated_completion_date)}/><Detail label="Actual completion" value={date(project.actual_completion_date)}/><Detail label="Status" value={project.active ? project.status : `${project.status} · Inactive`}/></div>{project.notes && <p className="project-notes">{project.notes}</p>}</ProjectSection>
      <ProjectSection title="Work Plan" summary="Not configured"><p className="muted">Work Plans are not part of this milestone. This section is reserved for the job-specific plan when that module is built.</p></ProjectSection>
      <ProjectSection title="Crew" summary={`${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`}><div className="project-record-list">{assignments.map(item => <article key={item.id}><span className="avatar slate">{item.kind === "crew" ? "C" : "E"}</span><span><strong>{item.name}</strong><small>{item.kind === "crew" ? "Crew" : "Employee"}{item.starts_on ? ` · ${date(item.starts_on)}` : ""}{item.ends_on ? `–${date(item.ends_on)}` : ""}</small></span></article>)}{assignments.length === 0 && <p className="muted">No project assignments yet.</p>}</div><Link className="text-button" href="/crews">Manage company crews →</Link></ProjectSection>
      <ProjectSection title="Schedule" summary={`${schedule.employee_count} workers · ${hours(schedule.scheduled_minutes)}`}><div className="section-stat-grid"><Detail label="Assignments" value={String(schedule.entry_count)}/><Detail label="Scheduled workers" value={String(schedule.employee_count)}/><Detail label="Scheduled hours" value={hours(schedule.scheduled_minutes)}/></div><Link className="text-button" href="/schedule">Open company schedule →</Link></ProjectSection>
      <ProjectSection title="Time & Labor" summary={`${hours(labor.paid_minutes)} · ${money(labor.labor_cost_cents)}`}><div className="section-stat-grid"><Detail label="Time entries" value={String(labor.entry_count)}/><Detail label="Workers" value={String(labor.employee_count)}/><Detail label="Paid hours" value={hours(labor.paid_minutes)}/>{can(auth, "wage.view") && <Detail label="Labor cost" value={money(labor.labor_cost_cents)}/>}</div><Link className="text-button" href="/time">Open company timekeeping →</Link></ProjectSection>
      <ProjectSection title="Punch List" summary={`${punch.open_count} open · ${punch.review_count} need review`}><div className="section-stat-grid"><Detail label="Total items" value={String(punch.total_count)}/><Detail label="Open" value={String(punch.open_count)}/><Detail label="Need review" value={String(punch.review_count)}/><Detail label="Approved" value={String(punch.approved_count)}/></div><Link className="text-button" href="/punch">Open company punch list →</Link></ProjectSection>
      <ProjectSection title="Change Orders" summary="Not available yet"><p className="muted">Change Orders are not part of this milestone. This section reserves their future home without adding the module now.</p></ProjectSection>
      <ProjectSection title="Photos & Files" summary={`${punch.photo_count} punch photo${punch.photo_count === 1 ? "" : "s"}`}><p className="muted">Punch photos are stored securely in Spartan. General project files will use the same attachment foundation in a future milestone.</p><Link className="text-button" href="/punch">View punch photos →</Link></ProjectSection>
    </div>
  </div></OperationsFrame>;
}

function ProjectSection({ title, summary, open, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) { return <details className="panel project-section" open={open}><summary><span><strong>{title}</strong><small>{summary}</small></span><b>⌄</b></summary><div className="project-section-body">{children}</div></details>; }
function Detail({ label, value }: { label: string; value: string }) { return <span className="project-detail"><small>{label}</small><strong>{value}</strong></span>; }
