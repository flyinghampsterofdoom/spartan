import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/policy";
import { appUrl } from "@/lib/http/app-url";
import { assertSameOrigin } from "@/lib/http/security";
import { setEmployeeWage, WageValidationError } from "@/lib/wages";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const employeeId = String(form.get("employeeId") ?? "");
  const destination = /^[0-9a-f-]{36}$/i.test(employeeId) ? `/wages?employee=${employeeId}` : "/wages";
  try {
    if (String(form.get("action")) !== "wage_change") throw new WageValidationError("Unsupported wage action.");
    await setEmployeeWage(auth, form);
    return redirectWith(request.url, destination, "saved", "1");
  } catch (error) {
    const message = error instanceof WageValidationError || error instanceof AuthorizationError ? error.message : "The wage change could not be saved.";
    return redirectWith(request.url, destination, "error", message);
  }
}

function redirectWith(requestUrl: string, path: string, key: string, value: string) {
  const url = new URL(path, appUrl("/", requestUrl));
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}
