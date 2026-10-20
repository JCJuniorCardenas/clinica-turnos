import { LlmRateLimitError } from "../types";
import { GeminiProvider } from "./gemini.provider";

const okResponse = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }), { status: 200 });
const input = { system: "s", messages: [{ role: "user" as const, text: "hola" }], tools: [] };

describe("GeminiProvider (fetch mocked)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
  });

  const make = (env: Record<string, string>) => {
    Object.assign(process.env, { GEMINI_API_KEY: "clave-falsa", ...env });
    return new GeminiProvider();
  };
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

  it("asks for low thinking and enough output tokens by default", async () => {
    const fetchMock = vi.fn(async () => okResponse("hola"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await make({ GEMINI_MODEL: "m1" }).chat(input);
    expect(res.text).toBe("hola");
    expect(bodyOf(fetchMock, 0).generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 2048 });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "x-goog-api-key": "clave-falsa" });
  });

  it("a model that times out is skipped and the next one answers; the slow one is not retried right away", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/m1:")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return okResponse("respuesta del segundo modelo");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = make({ GEMINI_MODEL: "m1,m2" });

    expect((await provider.chat(input)).text).toBe("respuesta del segundo modelo");
    expect(calls.map((u) => u.match(/models\/([^:]+):/)![1])).toEqual(["m1", "m2"]);

    calls.length = 0;
    await provider.chat(input); // m1 is resting: goes straight to m2
    expect(calls.map((u) => u.match(/models\/([^:]+):/)![1])).toEqual(["m2"]);
  });

  it("when every model is unavailable it raises the soft 'busy' error instead of a hard failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    await expect(make({ GEMINI_MODEL: "m1,m2" }).chat(input)).rejects.toBeInstanceOf(LlmRateLimitError);
  });

  it("a model that rejects the thinking setting is retried once without it, and remembered", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.generationConfig.thinkingConfig) {
        return new Response(JSON.stringify({ error: { message: "Thinking level is not supported for this model" } }), { status: 400 });
      }
      return okResponse("ok sin thinking");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = make({ GEMINI_MODEL: "m1" });

    expect((await provider.chat(input)).text).toBe("ok sin thinking");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await provider.chat(input);
    expect(fetchMock).toHaveBeenCalledTimes(3); // remembered: no failed attempt this time
  });

  it("GEMINI_THINKING_LEVEL=none sends no thinking setting at all", async () => {
    const fetchMock = vi.fn(async () => okResponse("x"));
    vi.stubGlobal("fetch", fetchMock);
    await make({ GEMINI_MODEL: "m1", GEMINI_THINKING_LEVEL: "none" }).chat(input);
    expect(bodyOf(fetchMock, 0).generationConfig.thinkingConfig).toBeUndefined();
  });
});
