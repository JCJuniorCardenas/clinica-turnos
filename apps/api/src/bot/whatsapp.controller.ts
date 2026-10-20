import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import QRCode from "qrcode";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles, RolesGuard } from "../common/roles";
import { WHATSAPP_PROVIDER } from "./types";
import type { WhatsAppProvider } from "./types";

/** Connection state of the linked WhatsApp number, with the QR to scan the first time. */
@Controller("whatsapp")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class WhatsAppController {
  constructor(@Inject(WHATSAPP_PROVIDER) private wa: WhatsAppProvider) {}

  @Get("estado")
  async estado() {
    const s = this.wa.status?.() ?? { estado: "desconectado" as const };
    return {
      proveedor: this.wa.kind ?? "baileys",
      habilitado: process.env.BOT_ENABLED === "true",
      // Variables still missing (names only) when the provider is Meta.
      faltan: (this.wa as unknown as { missingConfig?: () => string[] }).missingConfig?.() ?? [],
      estado: s.estado,
      problema: s.problema ?? null,
      qr: s.qr ? await QRCode.toDataURL(s.qr, { margin: 1, width: 280 }) : null,
    };
  }
}
