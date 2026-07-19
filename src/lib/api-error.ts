import type { FastifyReply } from "fastify";

/**
 * Public API error shape — safe for clients. Never put stack traces,
 * SQL, or internal paths in `message`.
 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
) {
  const body: ApiErrorBody = { error: { code, message } };
  return reply.code(status).send(body);
}
