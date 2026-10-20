import { createHmac } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { LLM_PROVIDER, WHATSAPP_PROVIDER } from "../bot/types";
import type { ChatMessage, LlmProvider } from "../bot/types";
import { PrismaService } from "../prisma/prisma.service";
import { MetaCloudProvider, extractMessages, normalizeRecipient, verifySignature } from "./meta-cloud.provider";

const SECRET = "app-secret-de-prueba";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const payload = (messages: object[]) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { messages } }] }],
});

describe("Meta helpers", () => {
  it("drops the 9 of Argentine mobiles when answering (Graph API error 131030)", () => {
    expect(normalizeRecipient("5493772123456")).toBe("543772123456");
    expect(normalizeRecipient("543772123456")).toBe("543772123456");
    expect(normalizeRecipient("5511999999999")).toBe("5511999999999");
  });

  it("verifies signatures and rejects tampered, missing or wrongly signed requests", () => {
    const body = Buffer.from('{"a":1}');
    const good = sign('{"a":1}');
    expect(verifySignature(body, good, SECRET)).toBe(true);
    expect(verifySignature(Buffer.from('{"a":2}'), good, SECRET)).toBe(false); // body changed
    expect(verifySignature(body, sign('{"a":1}', "otro-secreto"), SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(undefined, good, SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=corto", SECRET)).toBe(false); // different length
    expect(verifySignature(body, good, "")).toBe(false); // no secret configured
  });

  it("extracts text messages, flags non-text ones and skips receipts and garbage", () => {
    const msgs = extractMessages(
      payload([
        { from: "5493772123456", id: "wamid.1", type: "text", text: { body: "hola" } },
        { from: "5493772123457", id: "wamid.2", type: "image" },
        { from: "no-es-numero", id: "wamid.3", type: "text", text: { body: "x" } },
        { id: "wamid.4", type: "text", text: { body: "sin remitente" } },
      ]),
    );
    expect(msgs).toEqual([
      { from: "5493772123456", phone: "+5493772123456", text: "hola", id: "wamid.1" },
      { from: "5493772123457", phone: "+5493772123457", text: undefined, id: "wamid.2" },
    ]);
    expect(extractMessages({ entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] })).toEqual([]);
    expect(extractMessages({} as never)).toEqual([]);
    expect(extractMessages(null as never)).toEqual([]);
  });
});

class EchoLlm implements LlmProvider {
  calls = 0;
  async chat(input: { messages: ChatMessage[] }) {
    this.calls++;
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    return { text: `respuesta a: ${last && last.role === "user" ? last.text : ""}`, toolCalls: [] };
  }
}

describe("Meta webhook (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: EchoLlm;
  let fetchMock: ReturnType<typeof vi.fn>;
  const ENV_KEYS = ["META_APP_SECRET", "META_VERIFY_TOKEN", "META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "BOT_ENABLED", "BOT_CLINICA_ID"];
  const saved: Record<string, string | undefined> = {};
  const WA_ID = "5493770009970"; // fictional

  const post = (body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    const req = request(app.getHttpServer()).post("/whatsapp/webhook").set("Content-Type", "application/json");
    if (signature !== undefined) req.set("X-Hub-Signature-256", signature);
    return req.send(raw);
  };
  const waitFor = async (cond: () => boolean, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !cond()) await new Promise((r) => setTimeout(r, 50));
  };
  const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    Object.assign(process.env, {
      META_APP_SECRET: SECRET,
      META_VERIFY_TOKEN: "token-de-verificacion",
      META_ACCESS_TOKEN: "token-de-acceso-falso",
      META_PHONE_NUMBER_ID: "1234567890",
      BOT_ENABLED: "true",
    });
    llm = new EchoLlm();
    const { AppModule } = await import("../app.module");
    const { configureApp } = await import("../setup");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER).useValue(new MetaCloudProvider())
      .overrideProvider(LLM_PROVIDER).useValue(llm)
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    process.env.BOT_CLINICA_ID = (await prisma.clinica.findFirstOrThrow({ where: { nombre: "Clínica Demo" } })).id;
  });

  beforeEach(() => {
    llm.calls = 0;
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    const convs = await prisma.conversacion.findMany({ where: { telefono: `+${WA_ID}` }, select: { id: true } });
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: convs.map((c) => c.id) } } });
    await prisma.conversacion.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } });
    await app.close();
  });

  it("GET verification: answers the challenge only with the right token", async () => {
    const q = (mode: string, token: string) => `/whatsapp/webhook?hub.mode=${mode}&hub.verify_token=${token}&hub.challenge=12345`;
    const ok = await request(app.getHttpServer()).get(q("subscribe", "token-de-verificacion")).expect(200);
    expect(ok.text).toBe("12345");
    await request(app.getHttpServer()).get(q("subscribe", "token-equivocado")).expect(403);
    await request(app.getHttpServer()).get(q("unsubscribe", "token-de-verificacion")).expect(403);
    await request(app.getHttpServer()).get("/whatsapp/webhook").expect(403);
  });

  it("POST without a valid signature is rejected and nothing is processed", async () => {
    const body = payload([{ from: WA_ID, id: "wamid.sin-firma", type: "text", text: { body: "hola" } }]);
    await post(body).expect(401);
    await post(body, "sha256=" + "0".repeat(64)).expect(401);
    await post(body, sign(JSON.stringify(body), "secreto-equivocado")).expect(401);
    await new Promise((r) => setTimeout(r, 300));
    expect(llm.calls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a signed message gets 200 at once and is answered through the Graph API (without the 9)", async () => {
    const body = payload([{ from: WA_ID, id: "wamid.firmado-1", type: "text", text: { body: "hola, necesito un turno" } }]);
    const res = await post(body, sign(JSON.stringify(body))).expect(200);
    expect(res.text).toBe("EVENT_RECEIVED");

    await waitFor(() => fetchMock.mock.calls.length > 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect(sentBodies()[0]).toEqual({
      messaging_product: "whatsapp",
      to: "54" + WA_ID.slice(3),
      type: "text",
      text: { body: "respuesta a: hola, necesito un turno" },
    });
  });

  it("Meta retries are not answered twice (same message id)", async () => {
    const body = payload([{ from: WA_ID, id: "wamid.reintento", type: "text", text: { body: "una sola vez" } }]);
    const sig = sign(JSON.stringify(body));
    await post(body, sig).expect(200);
    await post(body, sig).expect(200);
    await post(body, sig).expect(200);
    await waitFor(() => fetchMock.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(llm.calls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("delivery receipts are acknowledged and ignored; non-text messages get the fixed text-only reply", async () => {
    const receipts = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] };
    await post(receipts, sign(JSON.stringify(receipts))).expect(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchMock).not.toHaveBeenCalled();

    const image = payload([{ from: WA_ID, id: "wamid.imagen", type: "image" }]);
    await post(image, sign(JSON.stringify(image))).expect(200);
    await waitFor(() => fetchMock.mock.calls.length > 0);
    expect(sentBodies()[0].text.body).toMatch(/solo entiendo mensajes de texto/i);
    expect(llm.calls).toBe(0);
  });

  it("with BOT_ENABLED off the webhook still answers Meta but the bot stays silent", async () => {
    process.env.BOT_ENABLED = "false";
    try {
      const body = payload([{ from: WA_ID, id: "wamid.apagado", type: "text", text: { body: "hola" } }]);
      await post(body, sign(JSON.stringify(body))).expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(llm.calls).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.BOT_ENABLED = "true";
    }
  });

  it("refuses to accept anything when the App Secret is not configured", async () => {
    const secret = process.env.META_APP_SECRET;
    delete process.env.META_APP_SECRET;
    try {
      const body = payload([{ from: WA_ID, id: "wamid.sin-secreto", type: "text", text: { body: "hola" } }]);
      await post(body, sign(JSON.stringify(body))).expect(503);
    } finally {
      process.env.META_APP_SECRET = secret;
    }
  });

  it("a failed Graph API call is retried and then logged without crashing", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 131030, message: "no permitido" } }), { status: 400 }));
    const body = payload([{ from: WA_ID, id: "wamid.error-graph", type: "text", text: { body: "probando error" } }]);
    await post(body, sign(JSON.stringify(body))).expect(200);
    await waitFor(() => fetchMock.mock.calls.length >= 3, 6000);
    expect(fetchMock.mock.calls.length).toBe(3); // three attempts, then it gives up
  });
});

describe("Meta provider status", () => {
  const saved = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });

  it("reports a rejected access token in the status and clears it after a successful send", async () => {
    Object.assign(process.env, { META_ACCESS_TOKEN: "t", META_PHONE_NUMBER_ID: "1", META_APP_SECRET: "s", META_VERIFY_TOKEN: "v" });
    const provider = new MetaCloudProvider();
    expect(provider.status()).toEqual({ estado: "conectado" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "Error validating access token" } }), { status: 401 })));
    await expect(provider.sendText("5493770000000", "hola")).rejects.toThrow(/401: 190/);
    expect(provider.status()).toMatchObject({ estado: "desconectado" });
    expect(provider.status().problema).toMatch(/token/i);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 })));
    await provider.sendText("5493770000000", "hola");
    expect(provider.status()).toEqual({ estado: "conectado" });
  });

  it("other Graph errors (e.g. recipient not allowed) do not blame the token", async () => {
    Object.assign(process.env, { META_ACCESS_TOKEN: "t", META_PHONE_NUMBER_ID: "1", META_APP_SECRET: "s", META_VERIFY_TOKEN: "v" });
    const provider = new MetaCloudProvider();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 131030, message: "not allowed" } }), { status: 400 })));
    await expect(provider.sendText("5493770000000", "hola")).rejects.toThrow(/131030/);
    expect(provider.status()).toEqual({ estado: "conectado" });
  });
});

describe("Meta webhook is invisible when another provider is active", () => {
  it("returns 404 for the webhook routes", async () => {
    const { AppModule } = await import("../app.module");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER).useValue({ onMessage() {}, sendText: async () => {} })
      .overrideProvider(LLM_PROVIDER).useValue(new EchoLlm())
      .compile();
    const app = mod.createNestApplication({ rawBody: true });
    await app.init();
    try {
      await request(app.getHttpServer()).get("/whatsapp/webhook?hub.mode=subscribe").expect(404);
      await request(app.getHttpServer()).post("/whatsapp/webhook").send({}).expect(404);
    } finally {
      await app.close();
    }
  });
});
