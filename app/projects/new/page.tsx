import Link from "next/link";
import { OperationsFrame } from "@/components/OperationsFrame";
import { ProjectForm } from "@/components/ProjectForm";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/auth/policy";
import { listEmployees, operationScope } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const auth = await requireAuth();
  requirePermission(auth, "projects.manage");
  const employees = operationScope(auth, "employees.view") ? await listEmployees(auth) : [];
  return <OperationsFrame auth={auth} active="/projects"><div className="page operations-page narrow-operations-page"><Link className="text-button back-link" href="/projects">← Projects</Link><section className="welcome page-title"><div><p className="eyebrow">NEW JOB</p><h1>Create project</h1><p>Add the foundational job details. Operational sections become available after saving.</p></div></section><ProjectForm employees={employees} returnTo="/projects"/></div></OperationsFrame>;
}
