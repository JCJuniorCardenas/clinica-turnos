import { pathToFileURL } from "node:url";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { IncomingMessage, WhatsAppProvider } from "../bot/types";

// Baileys is unofficial and only for the demo (secondary SIM). Production must use Meta's official API
// behind this same WhatsAppProvider interface.

// Baileys is ESM-only and this API is CommonJS, so it is loaded with a native dynamic import.
const importEsm = new Function("specifier", "return import(specifier)") as (s: string) => Promise<any>;

const NON_CONTENT_KEYS = new Set(["senderKeyDistributionMessage", "protocolMessage", "reactionMessage", "messageContextInfo"]);

export class BaileysProvider implements WhatsAppProvider {
  private handler?: (msg: IncomingMessage) => Promise<void>;
  private sock: any;
  private stopped = false;
  private readonly authDir = process.env.BAILEYS_AUTH_DIR ?? "./.baileys-auth";

  onMessage(handler: (msg: IncomingMessage) => Promise<void>) {
    this.handler = handler;
  }

  async sendText(to: string, text: string) {
    if (!this.sock) throw new Error("WhatsApp is not connected");
    await this.sock.sendMessage(to, { text });
  }

  async start() {
    this.stopped = false;
    const baileys = await importEsm(pathToFileURL(require.resolve("@whiskeysockets/baileys")).href);
    await this.connect(baileys);
  }

  async stop() {
    this.stopped = true;
    this.sock?.end(undefined);
  }

  private async connect(baileys: any) {
    const makeWASocket = baileys.default ?? baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

    const sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: "silent" }),
      browser: ["Clinica Turnos", "Chrome", "1.0"],
      markOnlineOnConnect: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (u: any) => {
      if (u.qr) {
        console.log("\nEscaneá este QR desde WhatsApp > Dispositivos vinculados (usá el chip secundario):\n");
        qrcode.generate(u.qr, { small: true });
      }
      if (u.connection === "open") console.log("[whatsapp] conectado");
      if (u.connection === "close") {
        const status = u.lastDisconnect?.error?.output?.statusCode;
        if (status === DisconnectReason.loggedOut) {
          console.error("[whatsapp] la sesión se cerró desde el celular. Borrá la carpeta de sesión y volvé a vincular.");
        } else if (!this.stopped) {
          console.warn(`[whatsapp] conexión cerrada (${status ?? "?"}), reintentando...`);
          setTimeout(() => this.connect(baileys).catch((e) => console.error("[whatsapp] reconexión fallida:", e?.message)), 3000);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }: any) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const incoming = this.toIncoming(m);
        if (!incoming) continue;
        try {
          await this.handler?.(incoming);
        } catch (e) {
          console.error("[whatsapp] error procesando mensaje:", (e as Error).message);
        }
      }
    });
  }

  /** Returns null for anything that is not a private chat message from a person (groups, status, own messages, receipts). */
  private toIncoming(m: any): IncomingMessage | null {
    const key = m.key ?? {};
    const jid: string = key.remoteJid ?? "";
    if (key.fromMe || !m.message) return null;
    if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) return null;
    const kinds = Object.keys(m.message);
    if (kinds.every((k) => NON_CONTENT_KEYS.has(k))) return null;

    // WhatsApp may identify a chat by an internal "@lid"; the real phone then comes as the alternate JID.
    const phoneJid: string = key.remoteJidAlt?.endsWith("@s.whatsapp.net") ? key.remoteJidAlt : jid;
    const phone = `+${phoneJid.split("@")[0].split(":")[0].replace(/\D/g, "")}`;
    const text: string | undefined = m.message.conversation ?? m.message.extendedTextMessage?.text ?? undefined;
    return { from: jid, phone, text, id: key.id };
  }
}
