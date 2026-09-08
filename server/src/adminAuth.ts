import { randomBytes, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";

let adminPassword: string;

export function initAdminPassword(): string {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv && fromEnv.length > 0) {
    adminPassword = fromEnv;
  } else {
    adminPassword = randomBytes(4).toString("hex");
    console.log(`Nenhuma ADMIN_PASSWORD definida. Senha gerada para esta sessão: ${adminPassword}`);
    console.log("Defina a variável de ambiente ADMIN_PASSWORD para fixar uma senha permanente.");
  }
  return adminPassword;
}

export function checkPassword(candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(adminPassword);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("X-Admin-Password");
  if (!checkPassword(header)) {
    res.status(401).json({ error: "Senha de administrador inválida" });
    return;
  }
  next();
}
