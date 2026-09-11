import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { AppError } from "./security.js";
import { authRoutes } from "./auth.js";
import { workspaceRoutes } from "./workspace.js";
import { whatsappRoutes } from "./whatsapp.js";
import type { WhatsAppGateway } from "./whatsapp-manager.js";
export async function buildApp(
  logging = false,
  whatsappGateway: WhatsAppGateway | null = null,
) {
  const app = Fastify({
    logger: logging
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.body",
            "res.headers.set-cookie",
          ],
          serializers: {
            req(req) {
              return {
                method: req.method,
                url: req.url?.split("?")[0],
                hostname: req.hostname,
              };
            },
          },
        }
      : false,
    bodyLimit: 64 * 1024,
    requestTimeout: 15000,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(helmet);
  const origins = (process.env.APP_URL ?? "http://127.0.0.1:5173").split(",");
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-caju-request"],
  });
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      if (req.headers["x-caju-request"] !== "1")
        throw new AppError(
          403,
          "A solicitação não pôde ser validada. Recarregue a página.",
          "CSRF",
        );
      if (req.headers.origin && !origins.includes(req.headers.origin))
        throw new AppError(403, "Origem não autorizada.", "CSRF");
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ message: error.message, code: error.code, requestId: req.id });
    if (error instanceof ZodError)
      return reply.code(400).send({
        message: "Confira os campos informados.",
        fields: error.issues.map((x) => ({
          path: x.path.join("."),
          message: x.message,
        })),
        requestId: req.id,
      });
    const e = error as { code?: string; statusCode?: number };
    if (e.code === "23505")
      return reply.code(409).send({
        message:
          "Já existe um registro com esses dados. Confira os itens cadastrados.",
        requestId: req.id,
      });
    if (e.code === "23503" || e.code === "42501")
      return reply.code(400).send({
        message:
          "Um dos itens selecionados não está disponível para sua empresa.",
        requestId: req.id,
      });
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({
        message:
          "Não foi possível ler a solicitação. Confira os dados e tente novamente.",
        requestId: req.id,
      });
    req.log.error(
      {
        operation: req.routeOptions.url,
        requestId: req.id,
        errorCode: e.code,
        tenantId: req.user?.tenantId,
      },
      "Falha na operação",
    );
    return reply.code(500).send({
      message:
        "Não foi possível concluir agora. Tente novamente. Se continuar, informe o código ao suporte.",
      requestId: req.id,
    });
  });
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { status: "ok", service: "caju-api" };
  });
  await authRoutes(app);
  await workspaceRoutes(app);
  await whatsappRoutes(app, whatsappGateway);
  return app;
}
