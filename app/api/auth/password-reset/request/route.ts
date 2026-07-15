import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/tokens";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const form = await request.formData();
  await requestPasswordReset(String(form.get("email") ?? ""), request.headers.get("x-forwarded-for")?.split(",")[0]?.trim());
  return NextResponse.redirect(appUrl("/forgot-password?sent=1", request.url), 303);
}
