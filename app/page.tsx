import { SpartanApp } from "@/components/SpartanApp";
import { requireAuth } from "@/lib/auth/session";
import { listCrews, listEmployees, listProjects, operationScope } from "@/lib/operations";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await requireAuth();
  const [projects, employees, crews] = await Promise.all([
    operationScope(auth, "projects.view") ? listProjects(auth) : [],
    operationScope(auth, "employees.view") ? listEmployees(auth) : [],
    operationScope(auth, "employees.view") ? listCrews(auth) : [],
  ]);
  const recordLinks = {
    projects: Object.fromEntries(projects.map(project => [project.name, `/projects/${project.id}`])),
    employees: Object.fromEntries(employees.map(employee => [`${employee.first_name} ${employee.last_name}`, `/employees?edit=${employee.id}#employee-form`])),
    crews: Object.fromEntries(crews.map(crew => [crew.name, `/crews?crew=${crew.id}#crew-form`])),
  };
  return <SpartanApp userName={auth.displayName} roleName={auth.roleName} organizationName={auth.organizationName} canAdmin={Boolean(auth.permissions["organization.memberships.manage"]?.allowed)} isPlatformAdmin={auth.platformRoles.includes("PLATFORM_ADMIN") || auth.platformRoles.includes("PLATFORM_SUPPORT")} recordLinks={recordLinks}/>;
}
