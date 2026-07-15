export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const error = typeof params.error === "string";
  return <main className="auth-page"><section className="auth-card"><a className="auth-brand" href="/login"><span>S</span> SPARTAN</a><p className="section-mark">ACCOUNT RECOVERY</p><h1>Choose a new password</h1>{error && <div className="form-alert">This reset link is invalid, expired, or already used.</div>}<p>Use at least 12 characters with uppercase, lowercase, and a number.</p><form action="/api/auth/password-reset/complete" method="post" className="auth-form"><input type="hidden" name="token" value={token} /><label>New password<input type="password" name="password" autoComplete="new-password" minLength={12} required /></label><label>Confirm password<input type="password" name="confirmPassword" autoComplete="new-password" minLength={12} required /></label><button className="primary full" type="submit" disabled={!token}>Save password</button></form></section></main>;
}
