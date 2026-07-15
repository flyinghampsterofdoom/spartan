import { NextResponse } from "next/server";
import { runAttachmentMaintenanceIfDue } from "@/lib/attachment-maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await runAttachmentMaintenanceIfDue();
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Attachment maintenance failed during health check", error);
    return NextResponse.json({ status: "ok", maintenance: "deferred" }, { headers: { "Cache-Control": "no-store" } });
  }
}
