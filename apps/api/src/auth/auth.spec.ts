import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { Roles, RolesGuard } from "../common/roles";
import { configureApp } from "../setup";
import type { INestApplication } from "@nestjs/common";

import { passwordFor } from "../test-utils";

describe("auth (requires seeded DB)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());

  it.each(["admin@demo.test", "recepcion@demo.test", "doctor@demo.test"])(
    "logs in %s and sets an httpOnly cookie",
    async (email) => {
      const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: passwordFor(email) });
      expect(res.status).toBe(200);
      const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
      expect(cookie).toMatch(/access_token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(res.body).not.toHaveProperty("token");
    },
  );

  it("/auth/me returns clinic and role, token carries clinicaId", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/auth/login").send({ email: "doctor@demo.test", password: passwordFor("doctor@demo.test") }).expect(200);
    const me = await agent.get("/auth/me").expect(200);
    expect(me.body.rol).toBe("DOCTOR");
    expect(me.body.doctorId).toBeTruthy();
    expect(me.body.clinica.id).toBeTruthy();
  });

  it("rejects wrong password and unknown email with the same 401", async () => {
    const a = await request(app.getHttpServer()).post("/auth/login").send({ email: "admin@demo.test", password: "nope" });
    const b = await request(app.getHttpServer()).post("/auth/login").send({ email: "nadie@demo.test", password: "nope" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it("rejects /auth/me without cookie or with a forged token", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).get("/auth/me").set("Cookie", "access_token=abc.def.ghi").expect(401);
  });

  it("rejects invalid payloads", async () => {
    await request(app.getHttpServer()).post("/auth/login").send({ email: "no-es-email", password: "x" }).expect(400);
  });
});

describe("RolesGuard", () => {
  class Dummy {
    @Roles("ADMIN" as any)
    adminOnly() {}
  }
  const guard = new RolesGuard(new Reflector());
  const ctx = (rol?: string) =>
    ({
      getHandler: () => Dummy.prototype.adminOnly,
      getClass: () => Dummy,
      switchToHttp: () => ({ getRequest: () => ({ user: rol ? { rol } : undefined }) }),
    }) as unknown as ExecutionContext;

  it("allows the required role", () => expect(guard.canActivate(ctx("ADMIN"))).toBe(true));
  it("blocks other roles and anonymous", () => {
    expect(guard.canActivate(ctx("RECEPCION"))).toBe(false);
    expect(guard.canActivate(ctx())).toBe(false);
  });
});
