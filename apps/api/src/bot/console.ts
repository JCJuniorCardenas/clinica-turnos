// Chat with the bot from the terminal (no phone needed): pnpm --filter api bot:console
import "reflect-metadata";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });
process.env.WHATSAPP_PROVIDER = "console";
process.env.BOT_ENABLED = "true";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";

NestFactory.createApplicationContext(AppModule, { logger: ["error"] }).catch((e) => {
  console.error(e);
  process.exit(1);
});
