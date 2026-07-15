import { redirect } from "next/navigation";
import { getSessionIdentity } from "@/lib/auth/session";
import { serverAppUrl } from "@/lib/http/app-url";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSessionIdentity();
  if (session) redirect(await serverAppUrl(session.activeOrganizationId ? "/" : "/select-organization"));
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : "";
  return <main className="auth-page"><section className="auth-card"><a className="auth-brand" href="/login"><span>S</span> SPARTAN</a><p className="section-mark">SECURE ACCESS</p><h1>Welcome back</h1><p>Sign in to your company’s Spartan workspace.</p>{error && <div className="form-alert">{error === "disabled" ? "This account is disabled or suspended." : error === "access" ? "Your organization access is not active." : "The email or password was not recognized."}</div>}<form action="/api/auth/login" method="post" className="auth-form"><label>Email<input type="email" name="email" autoComplete="email" required /></label><label>Password<input type="password" name="password" autoComplete="current-password" required /></label><button className="primary full" type="submit">Log in</button></form><a className="auth-link" href="/forgot-password">Forgot your password?</a></section></main>;
}
