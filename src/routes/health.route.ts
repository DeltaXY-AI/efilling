import { Router } from "express";

const SERVICE_NAME = "efilling-whatsapp";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
  });
});
