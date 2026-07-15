import { NextRequest, NextResponse } from "next/server";
import { completePasswordReset } from "@/lib/auth/tokens";
import { assertSameOrigin } from "@/lib/http/security";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");
  if (!token || password !== confirmPassword) return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}&error=1`, request.url), 303);
  try {
    const complete = await completePasswordReset(token, password);
    if (!complete) throw new Error("Invalid reset token.");
    return NextResponse.redirect(new URL("/login?reset=1", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL(`/reset-password?token=${encodeURIComponent(token)}&error=1`, request.url), 303);
  }
}
