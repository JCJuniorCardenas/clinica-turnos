import "reflect-metadata";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./setup";

async function bootstrap() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set and at least 32 chars");
  }
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(Number(process.env.API_PORT ?? 3001));
}
bootstrap();
