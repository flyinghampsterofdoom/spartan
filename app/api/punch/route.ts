import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/policy";
import { appUrl } from "@/lib/http/app-url";
import { assertSameOrigin } from "@/lib/http/security";
import { addPunchNote, changePunchApproval, changePunchExecution, createPunchItem, createPunchList, PunchValidationError } from "@/lib/punch";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(appUrl("/login", request.url), 303);
  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  let destination = itemDestination(form.get("itemId"));
  try {
    if (action === "list_create") await createPunchList(auth, form);
    else if (action === "item_create") destination = `/punch?item=${await createPunchItem(auth, form)}`;
    else if (action === "execution_change") await changePunchExecution(auth, form);
    else if (action === "approval_change") await changePunchApproval(auth, form);
    else if (action === "note_add") await addPunchNote(auth, form);
    else throw new PunchValidationError("Unsupported punch-list action.");
    return redirectWith(request.url, destination, "saved", "1");
  } catch (error) {
    const message = error instanceof PunchValidationError || error instanceof AuthorizationError ? error.message : "The punch-list change could not be saved.";
    return redirectWith(request.url, destination, "error", message);
  }
}

function itemDestination(value: FormDataEntryValue | null) {
  const itemId = String(value ?? "");
  return /^[0-9a-f-]{36}$/i.test(itemId) ? `/punch?item=${itemId}` : "/punch";
}

function redirectWith(requestUrl: string, path: string, key: string, value: string) {
  const url = new URL(path, appUrl("/", requestUrl));
  url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}
