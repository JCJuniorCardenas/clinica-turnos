// Runtime proxy: the browser only talks to the panel's own address (/api/...), and the panel forwards to the API.
// This keeps the session cookie same-site in production (panel and API live on different Railway addresses).
// It streams responses, so the live agenda (Server-Sent Events) passes through untouched.

export const dynamic = "force-dynamic";

const upstream = () => process.env.API_INTERNAL_URL ?? "http://localhost:3001";

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${upstream()}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;

  const headers = new Headers(req.headers);
  for (const h of ["host", "connection", "content-length", "accept-encoding"]) headers.delete(h);
  // Forward a single client IP so the API's rate limiting is per person and not per proxy. Take the LAST entry:
  // it is the one appended by the platform's edge; earlier entries can be forged by the client.
  const client = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  if (client) headers.set("x-forwarded-for", client);

  const init: RequestInit & { duplex?: "half" } = { method: req.method, headers, redirect: "manual", signal: req.signal };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    return Response.json({ message: "No se pudo conectar con el servidor." }, { status: 502 });
  }

  const out = new Headers(res.headers);
  for (const h of ["content-encoding", "content-length", "transfer-encoding", "connection"]) out.delete(h);
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
