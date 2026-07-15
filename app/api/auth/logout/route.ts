import { NextRequest, NextResponse } from "next/server";
import { logoutCurrentSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  await logoutCurrentSession();
  return NextResponse.redirect(appUrl("/login", request.url), 303);
}
