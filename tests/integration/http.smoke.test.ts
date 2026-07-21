import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("HTTP smoke (requires DATABASE_URL)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { default: Fastify } = await import("fastify");
    const { analyticsRoutes } = await import("../../src/routes/analytics.js");
    app = Fastify({ logger: false });
    await app.register(analyticsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("ingests analytics events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      payload: {
        name: "landing_view",
        guestSessionToken: "test-guest-token-xxxxxxxx",
        path: "/",
        props: { source: "integration" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it("rejects invalid analytics payloads", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/analytics/events",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
