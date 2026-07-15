import { NextRequest, NextResponse } from "next/server";
import { logoutCurrentSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  await logoutCurrentSession();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
