import Link from "next/link";
import { notFound } from "next/navigation";
import { OperationsFrame } from "@/components/OperationsFrame";
import { ProjectForm } from "@/components/ProjectForm";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/policy";
import { getProjectPageData, listEmployees, operationScope } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  requirePermission(auth, "projects.manage");
  const { projectId } = await params;
  const [data, employees, query] = await Promise.all([getProjectPageData(auth, projectId), operationScope(auth, "employees.view") ? listEmployees(auth) : [], searchParams]);
  if (!data) notFound();
  return <OperationsFrame auth={auth} active="/projects"><div className="page operations-page narrow-operations-page"><Link className="text-button back-link" href={`/projects/${projectId}`}>← {data.project.name}</Link><section className="welcome page-title"><div><p className="eyebrow">PROJECT SETTINGS</p><h1>Edit project</h1><p>Update job identity, leadership, dates, status, and notes.</p></div></section>{query.saved && <div className="form-success">Project changes saved.</div>}{typeof query.error === "string" && <div className="form-alert">{query.error}</div>}<ProjectForm project={data.project} employees={employees} returnTo={`/projects/${projectId}/edit`}/></div></OperationsFrame>;
}
