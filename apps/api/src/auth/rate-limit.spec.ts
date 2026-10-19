import { Test } from "@nestjs/testing";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

describe("login rate limiting", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LOGIN_RATE_LIMIT = "5";
    // Imported after the env var is set: the decorator reads it at load time.
    const { AppModule } = await import("../app.module");
    const { configureApp } = await import("../setup");
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());

  it("returns 429 after too many login attempts", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app.getHttpServer()).post("/auth/login").send({ email: "admin@demo.test", password: "mal" });
      codes.push(r.status);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);
  });
});
