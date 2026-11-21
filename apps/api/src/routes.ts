import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { DUMMY_HASH, signToken, verifyPassword } from "./auth.js";
import { getAuth, requireAuth, requireRole } from "./middleware.js";
import { AppError, createSale } from "./modules/sales/create-sale.js";
import { voidSale } from "./modules/sales/void-sale.js";
import { customersRouter } from "./modules/customers/routes.js";

export const router = Router();

// ---------- Auth ----------
const loginBody = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) });

// Simple in-memory brute-force guard: 5 failures per 15 minutes per ip+email
const failures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

router.post("/auth/login", async (req, res) => {
  const { email, password } = loginBody.parse(req.body);
  const key = `${req.ip}|${email}`;
  const now = Date.now();
  const rec = failures.get(key);
  if (rec && rec.resetAt > now && rec.count >= MAX_FAILS) {
    throw new AppError("TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again later.");
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { business: true } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok || !user.isActive) {
    const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + WINDOW_MS };
    cur.count += 1;
    failures.set(key, cur);
    throw new AppError("UNAUTHORIZED", "Wrong email or password");
  }

  failures.delete(key);
  res.json({
    token: await signToken(user.id),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    business: { id: user.business.id, name: user.business.name },
  });
});

// Everything below needs a valid login
router.use(requireAuth);
router.use(customersRouter);

// ---------- Products ----------
const productsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get("/products", async (req, res) => {
  const { businessId } = getAuth(res);
  const { search, limit } = productsQuery.parse(req.query);
  const items = await prisma.product.findMany({
    where: {
      businessId,
      isActive: true,
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search } },
        ],
      }),
    },
    orderBy: { name: "asc" },
    take: limit,
  });
  res.json({ items });
});

// ---------- Sales ----------
const qty = z.union([z.number().positive().max(1_000_000), z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)]);
const money = z.union([z.number().min(0).max(1e9), z.string().regex(/^\d{1,11}(\.\d{1,2})?$/)]);

const createSaleBody = z.object({
  customerId: z.string().min(1).nullish(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: qty })).min(1).max(200),
  discount: money.optional(),
  paidAmount: money,
  paymentMethod: z.enum(["CASH", "ESEWA", "KHALTI", "BANK", "CREDIT"]),
  note: z.string().max(500).optional(),
});

router.post("/sales", async (req, res) => {
  const { businessId, userId } = getAuth(res);
  const body = createSaleBody.parse(req.body);
  const sale = await createSale({ ...body, businessId, userId });
  res.status(201).json(sale);
});

router.get("/sales", async (_req, res) => {
  const { businessId } = getAuth(res);
  const items = await prisma.sale.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { customer: { select: { id: true, name: true } } },
  });
  res.json({ items });
});

router.post("/sales/:id/void", requireRole("OWNER", "MANAGER"), async (req, res) => {
  const { businessId } = getAuth(res);
  const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
  const sale = await voidSale({ businessId, saleId: String(req.params.id), reason });
  res.json(sale);
});
