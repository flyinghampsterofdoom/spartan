import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { appUrl } from "@/lib/http/app-url";
import { saveCrew, saveEmployee, saveProject, updateCrewMember, updateOperationalState, ValidationError } from "@/lib/operations";
import { AuthorizationError } from "@/lib/auth/policy";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const returnTo = String(form.get("returnTo") ?? "/");
  const safeReturnTo = /^\/(employees|projects|crews)(\?.*)?$/.test(returnTo) ? returnTo : "/";
  try {
    if (action === "employee_save") await saveEmployee(auth, form);
    else if (action === "project_save") await saveProject(auth, form);
    else if (action === "crew_save") await saveCrew(auth, form);
    else if (action === "state") await updateOperationalState(auth, form);
    else if (action === "crew_member") await updateCrewMember(auth, form);
    else throw new Error("Unsupported action.");
    const url = new URL(safeReturnTo, appUrl("/", request.url));
    url.searchParams.set("saved", "1");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const url = new URL(safeReturnTo, appUrl("/", request.url));
    const safeMessage = error instanceof ValidationError || error instanceof AuthorizationError ? error.message : "The change could not be saved. Check for duplicate IDs or names and try again.";
    url.searchParams.set("error", safeMessage);
    return NextResponse.redirect(url, 303);
  }
}
