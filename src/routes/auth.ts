import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../auth/index.js";
import { env } from "../env.js";

function buildRequest(req: FastifyRequest): Request {
  // Use the public (proxied) origin so Better Auth cookie/URL checks match the browser.
  const url = new URL(req.url, env.appUrl);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let body: string | undefined;
  if (hasBody) {
    body =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});
  }

  return new Request(url.toString(), {
    method: req.method,
    headers,
    body,
  });
}

async function forwardAuth(req: FastifyRequest, reply: FastifyReply) {
  const response = await auth.handler(buildRequest(req));
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    reply.header(key, value);
  });
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }
  const text = await response.text();
  return reply.send(text.length ? text : null);
}

export async function authRoutes(app: FastifyInstance) {
  app.all("/api/auth/*", forwardAuth);
  app.all("/api/auth", forwardAuth);
}
