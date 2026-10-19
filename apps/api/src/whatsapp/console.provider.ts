import { createInterface } from "node:readline";
import type { IncomingMessage, WhatsAppProvider } from "../bot/types";

/** Terminal stand-in for WhatsApp: type as the patient, read the bot's replies. For development and demos without a phone. */
export class ConsoleWhatsApp implements WhatsAppProvider {
  private handler?: (msg: IncomingMessage) => Promise<void>;
  private readonly phone = process.env.CONSOLE_PHONE ?? "+5493770000001";

  onMessage(handler: (msg: IncomingMessage) => Promise<void>) {
    this.handler = handler;
  }

  async sendText(_to: string, text: string) {
    console.log(`\n🤖 ${text}\n`);
  }

  async start() {
    console.log(`Chat de consola como ${this.phone}. Escribí como si fueras el paciente (Ctrl+C para salir).\n`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("line", (line) => {
      const text = line.trim();
      void this.handler?.({ from: this.phone, phone: this.phone, text: text || undefined });
    });
  }
}
