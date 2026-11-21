import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "./db.js";
import { verifyToken } from "./auth.js";
import { AppError } from "./modules/sales/create-sale.js";

export type Auth = { userId: string; businessId: string; role: Role };
export const getAuth = (res: Response) => res.locals.auth as Auth;

// The token only carries the user id. Business and role are re-read from the
// database on every request, so deactivating a user or changing a role takes effect immediately.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHORIZED", "Login required");

  let userId: string;
  try {
    userId = await verifyToken(header.slice(7));
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, businessId: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new AppError("UNAUTHORIZED", "Account disabled");

  res.locals.auth = { userId: user.id, businessId: user.businessId, role: user.role } satisfies Auth;
  next();
}

export function requireRole(...roles: Role[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(getAuth(res).role)) {
      throw new AppError("FORBIDDEN", "You don't have permission to do this");
    }
    next();
  };
}

function statusFor(code: string) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "TOO_MANY_ATTEMPTS") return 429;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code === "ALREADY_VOIDED" || code === "INSUFFICIENT_STOCK") return 409;
  return 400;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(statusFor(err.code)).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Invalid input", details: err.issues },
    });
  }
  if ((err as { type?: string })?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Invalid JSON body" } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
