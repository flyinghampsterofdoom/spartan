import Link from "next/link";
import { OperationsFrame } from "@/components/OperationsFrame";
import { PunchWalkClient } from "@/components/PunchWalkClient";
import { requireAuth } from "@/lib/auth/session";
import { punchPageData } from "@/lib/punch";

export const dynamic = "force-dynamic";

export default async function PunchWalkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAuth();
  if (!auth.permissions["punch.manage"]?.allowed) return <OperationsFrame auth={auth} active="/punch"><div className="page"><div className="form-alert">Punch Walk requires permission to create punch items.</div></div></OperationsFrame>;
  const [data, params] = await Promise.all([punchPageData(auth), searchParams]);
  const requestedProject = typeof params.project === "string" ? params.project : "";
  const initialProjectId = data.projects.some(project => project.id === requestedProject) ? requestedProject : data.projects[0]?.id ?? "";
  return <OperationsFrame auth={auth} active="/punch"><div className="page operations-page punch-walk-page"><div className="walk-back"><Link href="/punch">← Standard punch view</Link></div><PunchWalkClient initialProjectId={initialProjectId} projects={data.projects.map(project => ({ id: project.id, name: project.name, projectNumber: project.project_number }))} initialLists={data.lists.map(list => ({ id: list.id, name: list.name, projectId: list.project_id }))} areas={data.areas.map(area => ({ id: area.id, name: area.name, projectId: area.project_id }))} categories={data.categories} assignees={[...data.employees.filter(employee => employee.active).map(employee => ({ id: employee.id, name: `${employee.first_name} ${employee.last_name}`, kind: "employee" as const })), ...data.crews.filter(crew => crew.active).map(crew => ({ id: crew.id, name: crew.name, kind: "crew" as const }))]}/></div></OperationsFrame>;
}
