import { buildLlm } from "../bot.module";
import { LlmProvider, LlmRateLimitError, LlmUnavailableError } from "../types";
import type { ChatMessage } from "../types";
import { FallbackLlm } from "./fallback.provider";
import { toGeminiContents } from "./gemini.provider";
import { GroqProvider, toOpenAiMessages } from "./groq.provider";

const input = { system: "sys", messages: [{ role: "user" as const, text: "hola" }], tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }] };
const completion = (message: object) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });

describe("toOpenAiMessages", () => {
  it("maps a full tool exchange to the OpenAI format and drops provider-specific raw data", () => {
    const history: ChatMessage[] = [
      { role: "user", text: "turno" },
      { role: "assistant", text: "busco", toolCalls: [{ id: "c1", name: "listar_doctores", args: { especialidadId: "e1" }, raw: { thoughtSignature: "x" } }] },
      { role: "tool", toolCallId: "c1", name: "listar_doctores", result: { doctores: [] } },
      { role: "assistant", text: "no hay" },
    ];
    expect(toOpenAiMessages("sistema", history)).toEqual([
      { role: "system", content: "sistema" },
      { role: "user", content: "turno" },
      { role: "assistant", content: "busco", tool_calls: [{ id: "c1", type: "function", function: { name: "listar_doctores", arguments: '{"especialidadId":"e1"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"doctores":[]}' },
      { role: "assistant", content: "no hay" },
    ]);
  });
});

describe("GroqProvider (fetch mocked)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });
  const make = (env: Record<string, string> = {}) => {
    Object.assign(process.env, { GROQ_API_KEY: "clave-falsa", GROQ_MODEL: "m1", ...env });
    return new GroqProvider();
  };

  it("returns text, sends tools and the bearer key", async () => {
    const fetchMock = vi.fn(async () => completion({ content: "  ¡Hola!  " }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await make().chat(input);
    expect(res).toEqual({ text: "¡Hola!", toolCalls: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer clave-falsa");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "m1", tool_choice: "auto" });
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "t", description: "d", parameters: { type: "object", properties: {} } } });
  });

  it("parses tool calls and tolerates malformed JSON arguments", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion({
      content: null,
      tool_calls: [
        { id: "a", type: "function", function: { name: "buscar", arguments: '{"x":1}' } },
        { id: "b", type: "function", function: { name: "roto", arguments: "{no es json" } },
      ],
    })));
    const res = await make().chat(input);
    expect(res.text).toBeUndefined();
    expect(res.toolCalls.map((c) => [c.id, c.name, c.args])).toEqual([["a", "buscar", { x: 1 }], ["b", "roto", {}]]);
  });

  it("recoverable failures become LlmUnavailableError (so the next provider can answer)", async () => {
    const cases: [Response | (() => never), string][] = [
      [new Response("{}", { status: 429, headers: { "retry-after": "120" } }), "cupo"],
      [new Response(JSON.stringify({ error: { code: "tool_use_failed" } }), { status: 400 }), "tool_use_failed"],
      [new Response("x", { status: 503 }), "error 503"],
    ];
    for (const [response, reason] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => (response as Response).clone()));
      await expect(make().chat(input)).rejects.toMatchObject({ name: "LlmUnavailableError", reason });
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("t", "TimeoutError"); }));
    await expect(make().chat(input)).rejects.toMatchObject({ reason: "timeout" });
  });

  it("an unexpected API error (e.g. bad key) is a hard error, not silently swallowed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 })));
    await expect(make().chat(input)).rejects.toThrow(/Groq error 401/);
  });

  it("tries the next model of the list, and a resting model is skipped on the following call", async () => {
    const urlsModels: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const model = JSON.parse(init.body as string).model;
      urlsModels.push(model);
      return model === "m1" ? new Response("{}", { status: 429, headers: { "retry-after": "100" } }) : completion({ content: "ok" });
    }));
    const groq = make({ GROQ_MODEL: "m1,m2" });
    expect((await groq.chat(input)).text).toBe("ok");
    expect(urlsModels).toEqual(["m1", "m2"]);
    urlsModels.length = 0;
    await groq.chat(input);
    expect(urlsModels).toEqual(["m2"]);
  });
});

describe("FallbackLlm", () => {
  const ok = (text: string): LlmProvider => ({ chat: vi.fn(async () => ({ text, toolCalls: [] })) });
  const failing = (e: Error): LlmProvider => ({ chat: vi.fn(async () => { throw e; }) });

  it("uses the first provider when it works", async () => {
    const a = ok("A");
    const b = ok("B");
    const llm = new FallbackLlm([{ name: "a", provider: a }, { name: "b", provider: b }]);
    expect((await llm.chat(input)).text).toBe("A");
    expect(b.chat).not.toHaveBeenCalled();
  });

  it("falls back to the next provider on soft failures and lets the failed one rest", async () => {
    const a = failing(new LlmUnavailableError("timeout", 60));
    const b = ok("B");
    const llm = new FallbackLlm([{ name: "a", provider: a }, { name: "b", provider: b }]);
    expect((await llm.chat(input)).text).toBe("B");
    expect((await llm.chat(input)).text).toBe("B");
    expect(a.chat).toHaveBeenCalledTimes(1); // resting: not asked again right away
  });

  it("also falls back on a hard error of the first provider", async () => {
    const llm = new FallbackLlm([{ name: "a", provider: failing(new Error("boom")) }, { name: "b", provider: ok("B") }]);
    expect((await llm.chat(input)).text).toBe("B");
  });

  it("when everything fails softly it raises the friendly 'busy' error; a hard error is surfaced", async () => {
    const soft = new FallbackLlm([
      { name: "a", provider: failing(new LlmUnavailableError("cupo", 60)) },
      { name: "b", provider: failing(new LlmRateLimitError()) },
    ]);
    await expect(soft.chat(input)).rejects.toBeInstanceOf(LlmRateLimitError);

    const hard = new FallbackLlm([
      { name: "a", provider: failing(new Error("clave inválida")) },
      { name: "b", provider: failing(new LlmRateLimitError()) },
    ]);
    await expect(hard.chat(input)).rejects.toThrow("clave inválida");
  });

  it("still tries everyone when all providers are resting", async () => {
    const a = failing(new LlmUnavailableError("x", 60));
    const llm = new FallbackLlm([{ name: "a", provider: a }]);
    await expect(llm.chat(input)).rejects.toBeInstanceOf(LlmRateLimitError);
    await expect(llm.chat(input)).rejects.toBeInstanceOf(LlmRateLimitError);
    expect(a.chat).toHaveBeenCalledTimes(2);
  });
});

describe("history is portable between providers", () => {
  it("Gemini accepts tool calls that came from Groq (no signature) by bypassing the check", () => {
    const contents = toGeminiContents([
      { role: "user", text: "hola" },
      { role: "assistant", toolCalls: [{ id: "g1", name: "listar_especialidades", args: {} }] },
    ]);
    expect(contents[1].parts[0]).toMatchObject({ functionCall: { name: "listar_especialidades" }, thoughtSignature: "skip_thought_signature_validator" });
  });
});

describe("buildLlm", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("defaults to Gemini only without a Groq key, and to a Groq-first chain with one", () => {
    delete process.env.LLM_PROVIDER;
    delete process.env.GROQ_API_KEY;
    expect(buildLlm()).not.toBeInstanceOf(FallbackLlm);
    process.env.GROQ_API_KEY = "k";
    expect(buildLlm()).toBeInstanceOf(FallbackLlm);
  });
  it("honours LLM_PROVIDER and rejects unknown names", () => {
    process.env.LLM_PROVIDER = "groq";
    expect(buildLlm()).toBeInstanceOf(GroqProvider);
    process.env.LLM_PROVIDER = "groq,gemini";
    expect(buildLlm()).toBeInstanceOf(FallbackLlm);
    process.env.LLM_PROVIDER = "otro";
    expect(() => buildLlm()).toThrow(/desconocido/);
  });
});
