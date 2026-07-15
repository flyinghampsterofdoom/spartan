import { getSql } from "@/db";

type EmailMessage = {
  type: "invitation" | "password_reset" | "security_notification";
  to: string;
  subject: string;
  text: string;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
};

interface EmailAdapter {
  send(message: EmailMessage): Promise<{ providerMessageId?: string }>;
}

class DevelopmentEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage) {
    console.info(`[Spartan email:${message.type}] ${message.to} — ${message.subject}\n${message.text}`);
    return { providerMessageId: `development-${Date.now()}` };
  }
}

class ResendEmailAdapter implements EmailAdapter {
  constructor(private apiKey: string, private from: string) {}

  async send(message: EmailMessage) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    const result = await response.json() as { id?: string };
    return { providerMessageId: result.id };
  }
}

function getAdapter(): EmailAdapter {
  if (process.env.EMAIL_PROVIDER === "resend") {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new Error("RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend.");
    }
    return new ResendEmailAdapter(process.env.RESEND_API_KEY, process.env.EMAIL_FROM);
  }
  return new DevelopmentEmailAdapter();
}

export async function sendEmail(message: EmailMessage) {
  const sql = getSql();
  const delivery = await sql<{ id: string }[]>`
    insert into email_deliveries (message_type, recipient_email, organization_id, metadata)
    values (${message.type}, ${message.to}, ${message.organizationId ?? null}, ${sql.json((message.metadata ?? {}) as never)})
    returning id
  `;
  try {
    const result = await getAdapter().send(message);
    await sql`
      update email_deliveries set status = 'sent', sent_at = now(), provider_message_id = ${result.providerMessageId ?? null}
      where id = ${delivery[0].id}
    `;
  } catch (error) {
    await sql`
      update email_deliveries set status = 'failed', failure_reason = ${error instanceof Error ? error.message : "Unknown email error"}
      where id = ${delivery[0].id}
    `;
    throw error;
  }
}

export function applicationUrl(path: string) {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}
