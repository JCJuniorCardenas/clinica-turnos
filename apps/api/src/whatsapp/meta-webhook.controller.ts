import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { WHATSAPP_PROVIDER } from "../bot/types";
import type { WhatsAppProvider } from "../bot/types";
import { MetaCloudProvider, MetaWebhookPayload, verifySignature } from "./meta-cloud.provider";

/**
 * Webhook that Meta calls. Public by nature, so it never trusts a request that is not signed with the App Secret.
 * In production it is reached through the panel's /api proxy (Meta -> https://<panel>/api/whatsapp/webhook).
 */
@Controller("whatsapp/webhook")
export class MetaWebhookController {
  constructor(@Inject(WHATSAPP_PROVIDER) private wa: WhatsAppProvider) {}

  private provider(): MetaCloudProvider {
    // Looks like a route that does not exist unless the Meta provider is the active one.
    if (!(this.wa instanceof MetaCloudProvider)) throw new NotFoundException();
    return this.wa;
  }

  /** Meta's one-time check when the webhook URL is saved in its dashboard. Strict limit: the token travels in the URL. */
  @Get()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): string {
    this.provider();
    const expected = process.env.META_VERIFY_TOKEN ?? "";
    const a = Buffer.from(token ?? "");
    const b = Buffer.from(expected);
    const ok = mode === "subscribe" && expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    if (!ok) throw new ForbiddenException("Token de verificación inválido");
    return challenge ?? "";
  }

  @Post()
  @HttpCode(200)
  @SkipThrottle() // bursts from Meta are normal; abuse is stopped by the signature check
  receive(@Req() req: RawBodyRequest<Request>, @Body() payload: MetaWebhookPayload): string {
    const provider = this.provider();
    const secret = process.env.META_APP_SECRET;
    if (!secret) throw new ServiceUnavailableException("META_APP_SECRET no está configurada");
    if (!verifySignature(req.rawBody, req.header("x-hub-signature-256"), secret)) {
      throw new UnauthorizedException("Firma inválida");
    }
    // Answer 200 right away and process in the background: the AI may take several seconds and Meta retries on timeouts.
    if (process.env.BOT_ENABLED === "true") void provider.deliver(payload);
    return "EVENT_RECEIVED";
  }
}
