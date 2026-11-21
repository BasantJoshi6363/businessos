import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { AppError } from "./create-sale.js";

export async function voidSale(input: {
  businessId: string; // from the logged-in user's token
  saleId: string;
  reason?: string;
}) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: input.saleId, businessId: input.businessId },
        include: { items: true },
      });
      if (!sale) throw new AppError("SALE_NOT_FOUND", "Sale not found");

      // Atomic status flip: only one concurrent void can win
      const flipped = await tx.sale.updateMany({
        where: { id: sale.id, businessId: input.businessId, status: "COMPLETED" },
        data: { status: "VOIDED", voidedAt: new Date() },
      });
      if (flipped.count === 0) throw new AppError("ALREADY_VOIDED", "Sale is already voided");

      // Put stock back
      for (const item of sale.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { increment: item.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            businessId: input.businessId,
            productId: item.productId,
            type: "RETURN_IN",
            quantity: item.quantity, // positive = stock in
            unitCost: item.unitCost,
            referenceType: "SALE_VOID",
            referenceId: sale.id,
            note: input.reason ?? `Void invoice #${sale.invoiceNo}`,
          },
        });
      }

      // Cancel the unpaid part (dues) with a reversing ledger entry
      const due = sale.total.minus(sale.paidAmount);
      if (due.gt(0) && sale.customerId) {
        await tx.customerLedgerEntry.create({
          data: {
            businessId: input.businessId,
            customerId: sale.customerId,
            type: "RETURN",
            amount: due.neg(),
            saleId: sale.id,
            note: `Void invoice #${sale.invoiceNo}`,
          },
        });
        await tx.customer.update({
          where: { id: sale.customerId },
          data: { balance: { decrement: due } },
        });
      }

      return tx.sale.findUniqueOrThrow({ where: { id: sale.id } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 }
  );
}
