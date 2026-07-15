import { NextRequest, NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/auth/policy";
import { getAuthContext } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/http/security";
import { createPunchItem, createPunchList, PunchValidationError } from "@/lib/punch";

export async function POST(request: NextRequest) {
  assertSameOrigin(request);
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) if (value !== null && value !== undefined) form.set(key, String(value));
    if (body.action === "list_create") {
      const id = await createPunchList(auth, form);
      return NextResponse.json({ list: { id, projectId: String(body.projectId), name: String(body.name) } }, { status: 201 });
    }
    if (body.action !== "item_create") throw new PunchValidationError("Unsupported Punch Walk action.");
    const result = await createPunchItem(auth, form);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof PunchValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "The Punch Walk item could not be saved." }, { status: 500 });
  }
}
