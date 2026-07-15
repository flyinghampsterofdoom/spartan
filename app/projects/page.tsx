import Link from "next/link";
import { OperationsFrame } from "@/components/OperationsFrame";
import { requireAuth } from "@/lib/auth/session";
import { can } from "@/lib/auth/policy";
import { listProjects, operationScope } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  if (!operationScope(auth, "projects.view")) return <OperationsFrame auth={auth} active="/projects"><div className="page"><div className="form-alert">You do not have permission to view projects.</div></div></OperationsFrame>;
  const [projects, params] = await Promise.all([listProjects(auth), searchParams]);
  const manage = can(auth, "projects.manage");
  return <OperationsFrame auth={auth} active="/projects"><div className="page operations-page">
    <section className="welcome page-title"><div><p className="eyebrow">PORTFOLIO</p><h1>Projects</h1><p>Open a job to see its crew, schedule, labor, punch work, and files in one place.</p></div>{manage && <Link className="primary button-anchor" href="/projects/new">＋ New project</Link>}</section>
    {params.saved && <div className="form-success">Project changes saved.</div>}{typeof params.error === "string" && <div className="form-alert">{params.error}</div>}
    <section className="project-card-grid project-index-grid">{projects.map(project => <Link href={`/projects/${project.id}`} className="project-card record-project" key={project.id}><div className="project-card-top"><span className={`status-pill ${project.status === "Punch" ? "punch" : project.active ? "active" : "rework"}`}>{project.status}</span><span>{project.project_number}</span></div><h2>{project.name}</h2><p>{project.client_name} · {project.jobsite_address}</p><div className="project-meta"><span><small>MANAGER</small><strong>{project.manager_name ?? "Unassigned"}</strong></span><span><small>FOREMAN</small><strong>{project.foreman_name ?? "Unassigned"}</strong></span><span><small>ASSIGNMENTS</small><strong>{project.assigned_count}</strong></span></div><b className="row-chevron">›</b></Link>)}</section>
    {projects.length === 0 && <div className="empty-state">No projects are available in your current scope.</div>}
  </div></OperationsFrame>;
}
