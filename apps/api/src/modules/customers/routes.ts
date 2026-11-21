import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { getAuth } from "../../middleware.js";
import { AppError } from "../sales/create-sale.js";
import { receivePayment } from "./payments.js";

export const customersRouter = Router();

const money = z.union([z.number().positive().max(1e9), z.string().regex(/^\d{1,11}(\.\d{1,2})?$/)]);
const phone = z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, "Invalid phone number");

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phone.optional(),
  address: z.string().trim().max(200).optional(),
});
const updateBody = createBody.partial();

// Create
customersRouter.post("/customers", async (req, res) => {
  const { businessId } = getAuth(res);
  const data = createBody.parse(req.body);
  const customer = await prisma.customer.create({ data: { ...data, businessId } });
  res.status(201).json(customer);
});

// List / search (also returns total dues across the shop)
const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  hasDues: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

customersRouter.get("/customers", async (req, res) => {
  const { businessId } = getAuth(res);
  const { search, hasDues, limit } = listQuery.parse(req.query);

  const where = {
    businessId,
    isActive: true,
    ...(hasDues === "true" && { balance: { gt: 0 } }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search } },
      ],
    }),
  };

  const [items, totals] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, take: limit }),
    prisma.customer.aggregate({
      where: { businessId, isActive: true, balance: { gt: 0 } },
      _sum: { balance: true },
    }),
  ]);
  res.json({ items, totalDues: totals._sum.balance ?? "0" });
});

// One customer
customersRouter.get("/customers/:id", async (req, res) => {
  const { businessId } = getAuth(res);
  const customer = await prisma.customer.findFirst({
    where: { id: String(req.params.id), businessId },
  });
  if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found");
  res.json(customer);
});

// Update basic info (balance can only change through sales and payments)
customersRouter.patch("/customers/:id", async (req, res) => {
  const { businessId } = getAuth(res);
  const data = updateBody.parse(req.body);
  const result = await prisma.customer.updateMany({
    where: { id: String(req.params.id), businessId },
    data,
  });
  if (result.count === 0) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found");
  res.json(await prisma.customer.findFirstOrThrow({ where: { id: String(req.params.id), businessId } }));
});

// Ledger statement, newest first, cursor pagination
const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

customersRouter.get("/customers/:id/ledger", async (req, res) => {
  const { businessId } = getAuth(res);
  const { limit, cursor } = ledgerQuery.parse(req.query);
  const customerId = String(req.params.id);

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { id: true, name: true, balance: true },
  });
  if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found");

  const rows = await prisma.customerLedgerEntry.findMany({
    where: { businessId, customerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  res.json({ customer, items, nextCursor: hasMore ? items[items.length - 1]!.id : null });
});

// Record a payment received from the customer
const paymentBody = z.object({
  amount: money,
  method: z.enum(["CASH", "ESEWA", "KHALTI", "BANK"]).default("CASH"),
  note: z.string().max(300).optional(),
});

customersRouter.post("/customers/:id/payments", async (req, res) => {
  const { businessId } = getAuth(res);
  const body = paymentBody.parse(req.body);
  const customer = await receivePayment({ businessId, customerId: String(req.params.id), ...body });
  res.status(201).json(customer);
});
