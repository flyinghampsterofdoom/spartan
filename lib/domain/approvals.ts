import type { AuthContext } from "@/lib/auth/types";
import { changePunchApproval } from "@/lib/punch";
import { approveTime } from "@/lib/timekeeping";

export async function approveTimeEntry(context: AuthContext, timeEntryId: string) {
  await approveTime(context, timeEntryId);
}

export async function approvePunchItem(context: AuthContext, punchItemId: string) {
  const form = new FormData();
  form.set("itemId", punchItemId);
  form.set("approvalStatus", "approved");
  form.set("reason", "Approved in Spartan");
  await changePunchApproval(context, form);
}
