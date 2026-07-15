import { NextResponse } from "next/server";
import { runAttachmentMaintenanceIfDue } from "@/lib/attachment-maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const version = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local";
  try {
    await runAttachmentMaintenanceIfDue();
    return NextResponse.json({ status: "ok", version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Attachment maintenance failed during health check", error);
    return NextResponse.json({ status: "ok", version, maintenance: "deferred" }, { headers: { "Cache-Control": "no-store" } });
  }
}
