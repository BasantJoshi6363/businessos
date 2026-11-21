import { Prisma, PaymentMethod } from "@prisma/client";
import { prisma } from "../../db.js";

export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type CreateSaleInput = {
  businessId: string; // always from the logged-in user's token, never from the request body
  userId: string;
  customerId?: string | null;
  items: { productId: string; quantity: number | string }[];
  discount?: number | string;
  paidAmount: number | string;
  paymentMethod: PaymentMethod;
  note?: string;
};

const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

export async function createSale(input: CreateSaleInput) {
  if (input.items.length === 0) throw new AppError("EMPTY_CART", "Add at least one item");

  // Merge duplicate lines and sort by productId (consistent lock order avoids deadlocks)
  const merged = new Map<string, Prisma.Decimal>();
  for (const it of input.items) {
    const qty = D(it.quantity);
    if (qty.lte(0)) throw new AppError("BAD_QTY", "Quantity must be greater than 0");
    merged.set(it.productId, (merged.get(it.productId) ?? D(0)).plus(qty));
  }
  const lines = [...merged.entries()].sort(([a], [b]) => a.localeCompare(b));

  return prisma.$transaction(
    async (tx) => {
      // Serialize invoice numbering per business
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${input.businessId} FOR UPDATE`;

      const products = await tx.product.findMany({
        where: {
          businessId: input.businessId, // tenant isolation
          id: { in: lines.map(([id]) => id) },
          isActive: true,
        },
      });
      if (products.length !== lines.length) {
        throw new AppError("PRODUCT_NOT_FOUND", "One or more products not found");
      }
      const byId = new Map(products.map((p) => [p.id, p]));

      // Price comes from the database, never from the client
      let subtotal = D(0);
      const itemRows = lines.map(([productId, qty]) => {
        const p = byId.get(productId)!;
        const lineTotal = p.sellPrice.mul(qty);
        subtotal = subtotal.plus(lineTotal);
        return {
          businessId: input.businessId,
          productId,
          quantity: qty,
          unitPrice: p.sellPrice,
          unitCost: p.costPrice,
          lineTotal,
        };
      });

      const discount = D(input.discount ?? 0);
      if (discount.lt(0) || discount.gt(subtotal)) {
        throw new AppError("BAD_DISCOUNT", "Invalid discount");
      }
      const total = subtotal.minus(discount);
      const paid = D(input.paidAmount);
      if (paid.lt(0) || paid.gt(total)) {
        throw new AppError("BAD_PAID", "Paid amount must be between 0 and the total");
      }
      const due = total.minus(paid);

      if (due.gt(0)) {
        if (!input.customerId) {
          throw new AppError("CUSTOMER_REQUIRED", "Select a customer for a credit sale");
        }
      }
      if (input.customerId) {
        const c = await tx.customer.findFirst({
          where: { id: input.customerId, businessId: input.businessId },
          select: { id: true },
        });
        if (!c) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found");
      }

      // Next invoice number for this business
      const last = await tx.sale.aggregate({
        where: { businessId: input.businessId },
        _max: { invoiceNo: true },
      });
      const invoiceNo = (last._max.invoiceNo ?? 0) + 1;

      const sale = await tx.sale.create({
        data: {
          businessId: input.businessId,
          invoiceNo,
          customerId: input.customerId ?? null,
          createdById: input.userId,
          subtotal,
          discount,
          total,
          paidAmount: paid,
          paymentMethod: input.paymentMethod,
          note: input.note,
          items: { create: itemRows },
        },
        include: { items: true },
      });

      // Atomic stock decrement. The condition stops stock from going negative
      // even if two sales happen at the same moment.
      for (const row of itemRows) {
        const res = await tx.product.updateMany({
          where: {
            id: row.productId,
            businessId: input.businessId,
            stockQty: { gte: row.quantity },
          },
          data: { stockQty: { decrement: row.quantity } },
        });
        if (res.count === 0) {
          const name = byId.get(row.productId)!.name;
          throw new AppError("INSUFFICIENT_STOCK", `Not enough stock for ${name}`);
        }
        await tx.inventoryMovement.create({
          data: {
            businessId: input.businessId,
            productId: row.productId,
            type: "SALE",
            quantity: row.quantity.neg(),
            unitCost: row.unitCost,
            referenceType: "SALE",
            referenceId: sale.id,
          },
        });
      }

      // Customer dues
      if (due.gt(0) && input.customerId) {
        await tx.customerLedgerEntry.create({
          data: {
            businessId: input.businessId,
            customerId: input.customerId,
            type: "SALE_ON_CREDIT",
            amount: due,
            saleId: sale.id,
            note: `Invoice #${invoiceNo}`,
          },
        });
        await tx.customer.update({
          where: { id: input.customerId },
          data: { balance: { increment: due } },
        });
      }

      return sale;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 }
  );
}
