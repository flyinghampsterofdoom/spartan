import { SpartanApp } from "@/components/SpartanApp";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await requireAuth();
  return <SpartanApp userName={auth.displayName} roleName={auth.roleName} organizationName={auth.organizationName} canAdmin={Boolean(auth.permissions["organization.memberships.manage"]?.allowed)} isPlatformAdmin={auth.platformRoles.includes("PLATFORM_ADMIN") || auth.platformRoles.includes("PLATFORM_SUPPORT")} />;
}
