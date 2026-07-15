import Link from "next/link";
import type { ReactNode } from "react";
import type { AuthContext } from "@/lib/auth/types";
import { can } from "@/lib/auth/policy";

const links = [
  ["/", "⌂", "Overview"], ["/projects", "▱", "Projects"], ["/schedule", "□", "Schedule"], ["/time", "◷", "Time"], ["/crews", "◫", "Crews"], ["/employees", "◎", "Employees"], ["/wages", "¤", "Wages"],
] as const;

export function OperationsFrame({ auth, active, children }: { auth: AuthContext; active: string; children: ReactNode }) {
  const initials = auth.displayName.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
  const visibleLinks = links.filter(([href]) => href === "/"
    || (href === "/projects" && auth.permissions["projects.view"]?.allowed)
    || (href === "/schedule" && auth.permissions["schedules.view"]?.allowed)
    || (href === "/time" && auth.permissions["time.view"]?.allowed)
    || (href === "/wages" && (auth.permissions["wage.view"]?.allowed || auth.permissions["wage.edit"]?.allowed || auth.permissions["wage.audit"]?.allowed))
    || ((href === "/crews" || href === "/employees") && auth.permissions["employees.view"]?.allowed));
  return <div className="app-shell operations-shell">
    <aside className="sidebar operations-sidebar">
      <Link href="/" className="brand"><span className="brand-mark">S</span><span>SPARTAN</span></Link>
      <nav aria-label="Primary navigation"><p className="nav-kicker">Workspace</p>{visibleLinks.map(([href, glyph, label]) => <Link key={href} href={href} className={`nav-item ${active === href ? "selected" : ""}`}><span>{glyph}</span>{label}</Link>)}</nav>
      <div className="sidebar-foot"><div className="profile-mini"><span className="avatar amber">{initials}</span><div><strong>{auth.displayName}</strong><small>{auth.roleName} · {auth.organizationName}</small></div></div><div className="account-links"><Link href="/account">Account & sessions</Link>{(can(auth, "organization.memberships.manage") || can(auth, "organization.settings.manage")) && <Link href="/settings">Company settings</Link>}<form action="/api/auth/logout" method="post"><button type="submit">Log out</button></form></div></div>
    </aside>
    <main className="main operations-main"><header className="topbar operations-topbar"><Link href="/" className="mobile-brand-link">SPARTAN</Link><strong>{links.find(link => link[0] === active)?.[2] ?? "Operations"}</strong><div className="top-actions"><span className="avatar amber">{initials}</span></div></header>{children}</main>
  </div>;
}
