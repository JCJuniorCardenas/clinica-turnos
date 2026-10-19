import "reflect-metadata";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./setup";

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 chars");
  }
  if (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "true") {
    console.warn("[seguridad] COOKIE_SECURE no es 'true': en producción la cookie de sesión debe viajar solo por HTTPS.");
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Railway's proxy: trust one hop so rate limiting sees the real client IP, not the proxy's.
  app.set("trust proxy", 1);
  configureApp(app);
  await app.listen(Number(process.env.API_PORT ?? process.env.PORT ?? 3001));
}
bootstrap();
