import type { FastifyInstance } from "fastify";
import { and, eq, like } from "drizzle-orm";
import { db } from "../db/client.js";
import { passages } from "../db/schema.js";

export async function passagesRoutes(app: FastifyInstance) {
  app.get("/passages", async () => {
    const rows = await db
      .select({
        id: passages.id,
        text: passages.text,
        difficulty: passages.difficulty,
        source: passages.source,
      })
      .from(passages)
      .where(
        and(eq(passages.source, "official"), like(passages.id, "official-%")),
      );

    return { passages: rows };
  });

  app.get<{ Params: { id: string } }>("/passages/:id", async (req, reply) => {
    const [row] = await db
      .select()
      .from(passages)
      .where(eq(passages.id, req.params.id))
      .limit(1);
    if (!row) {
      return reply.code(404).send({ error: "Passage not found" });
    }
    return { passage: row };
  });
}
