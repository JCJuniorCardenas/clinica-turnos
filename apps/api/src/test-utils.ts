import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "./setup";

export const PASSWORD = process.env.SEED_PASSWORD ?? "Demo1234!";

export async function createApp(): Promise<INestApplication> {
  const { AppModule } = await import("./app.module");
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Logs in and returns a supertest agent that keeps the httpOnly cookie. */
export async function loginAs(app: INestApplication, email: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/auth/login").send({ email, password: PASSWORD }).expect(200);
  return agent;
}

/** Next local date (YYYY-MM-DD, UTC-based is fine for tests) falling on `weekday`, at least 2 days ahead. */
export function nextWeekday(weekday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
