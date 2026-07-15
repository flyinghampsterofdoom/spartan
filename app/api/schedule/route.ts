import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/policy";
import { appUrl } from "@/lib/http/app-url";
import { assertSameOrigin } from "@/lib/http/security";
import { assignCrewRange, deleteScheduleEntry, saveScheduleEntry, ScheduleValidationError } from "@/lib/scheduling";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const week = String(form.get("week") ?? "");
  const destination = /^\d{4}-\d{2}-\d{2}$/.test(week) ? `/schedule?week=${week}` : "/schedule";
  try {
    if (action === "save") await saveScheduleEntry(auth, form);
    else if (action === "delete") await deleteScheduleEntry(auth, form);
    else if (action === "crew_range") await assignCrewRange(auth, form);
    else throw new ScheduleValidationError("Unsupported schedule action.");
    const url = new URL(destination, appUrl("/", request.url));
    url.searchParams.set("saved", "1");
    return NextResponse.redirect(url, 303);
  } catch (error) {
    const url = new URL(destination, appUrl("/", request.url));
    url.searchParams.set("error", error instanceof ScheduleValidationError || error instanceof AuthorizationError ? error.message : "The schedule change could not be saved.");
    return NextResponse.redirect(url, 303);
  }
}
