import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/policy";
import { appUrl } from "@/lib/http/app-url";
import { assertSameOrigin } from "@/lib/http/security";
import { approveTime, clockIn, clockOut, correctTimeEntry, endBreak, resolveCorrectionRequest, reviewTimeEntry, startBreak, submitCorrectionRequest, TimekeepingValidationError } from "@/lib/timekeeping";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  try {
    if (action === "clock_in") await clockIn(auth, form);
    else if (action === "start_break") await startBreak(auth);
    else if (action === "end_break") await endBreak(auth);
    else if (action === "clock_out") await clockOut(auth);
    else if (action === "correction_request") await submitCorrectionRequest(auth, form);
    else if (action === "correct") await correctTimeEntry(auth, form);
    else if (action === "review") await reviewTimeEntry(auth, uuidValue(form.get("timeEntryId")));
    else if (action === "approve") await approveTime(auth, uuidValue(form.get("timeEntryId")));
    else if (action === "resolve_correction") await resolveCorrectionRequest(auth, form);
    else throw new TimekeepingValidationError("Unsupported timekeeping action.");
    return redirectWith(request.url, "saved", "1");
  } catch (error) {
    const message = error instanceof TimekeepingValidationError || error instanceof AuthorizationError ? error.message : "The timekeeping change could not be saved.";
    return redirectWith(request.url, "error", message);
  }
}

function uuidValue(value: FormDataEntryValue | null) {
  const result = String(value ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(result)) throw new TimekeepingValidationError("Time entry is invalid.");
  return result;
}

function redirectWith(requestUrl: string, key: string, value: string) {
  const url = new URL("/time", appUrl("/", requestUrl));
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}
