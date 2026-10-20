import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, WhatsAppProvider, WhatsAppStatus } from "../bot/types";

// Official WhatsApp Cloud API (Meta). Messages arrive as signed webhook calls and answers go out through the Graph API.
// No QR, no linked phone, no ban risk: this is the provider meant for production, and also for the demo.

/**
 * Meta delivers Argentine mobiles as 549XXXXXXXXXX (with the 9), but its list of test recipients stores them as
 * 54XXXXXXXXXX. To answer, the 9 must be dropped; otherwise the Graph API fails with error 131030.
 */
export function normalizeRecipient(phone: string): string {
  return /^549\d{10}$/.test(phone) ? "54" + phone.slice(3) : phone;
}

/** Validates the X-Hub-Signature-256 header: "sha256=" + HMAC-SHA256(raw body, App Secret). */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header || !secret) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual needs equal lengths and avoids leaking information through response time.
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only the fields of Meta's payload that are used.
export interface MetaWebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        messages?: { from?: string; id?: string; type?: string; text?: { body?: string } }[];
        statuses?: unknown[];
      };
    }[];
  }[];
}

/** Turns a webhook payload into our neutral messages. Delivery receipts ("statuses") and malformed items are skipped. */
export function extractMessages(payload: MetaWebhookPayload): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        if (!m?.from || !/^\d{6,20}$/.test(m.from)) continue;
        out.push({
          from: m.from,
          phone: `+${m.from}`,
          // Audio, images, stickers, etc. arrive without text: the bot answers that it only understands text.
          text: m.type === "text" ? m.text?.body : undefined,
          id: m.id,
        });
      }
    }
  }
  return out;
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly kind = "meta" as const;
  private handler?: (msg: IncomingMessage) => Promise<void>;

  onMessage(handler: (msg: IncomingMessage) => Promise<void>) {
    this.handler = handler;
  }

  /** "conectado" once every required variable is present (there is no session to link). */
  status(): WhatsAppStatus {
    return { estado: this.missingConfig().length === 0 ? "conectado" : "desconectado" };
  }

  missingConfig(): string[] {
    return ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_APP_SECRET", "META_VERIFY_TOKEN"].filter((k) => !process.env[k]);
  }

  /** Called by the webhook controller after the signature has been verified. Returns once all messages were handled. */
  async deliver(payload: MetaWebhookPayload): Promise<void> {
    for (const msg of extractMessages(payload)) {
      try {
        await this.handler?.(msg);
      } catch (e) {
        console.error("[whatsapp] error procesando mensaje:", (e as Error).message);
      }
    }
  }

  async sendText(to: string, text: string): Promise<void> {
    const version = process.env.META_API_VERSION ?? "v21.0";
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    const token = process.env.META_ACCESS_TOKEN;
    if (!phoneId || !token) throw new Error("WhatsApp (Meta) is not configured");

    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: normalizeRecipient(to), type: "text", text: { body: text } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // The body may echo the recipient; keep only the status and Meta's error code/message.
      const err = await res.json().catch(() => null);
      throw new Error(`Graph API ${res.status}: ${err?.error?.code ?? "?"} ${err?.error?.message ?? ""}`.trim());
    }
  }
}
