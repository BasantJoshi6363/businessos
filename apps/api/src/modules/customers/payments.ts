import { Prisma, PaymentMethod } from "@prisma/client";
import { prisma } from "../../db.js";
import { AppError } from "../sales/create-sale.js";

export async function receivePayment(input: {
  businessId: string; // from the logged-in user's token
  customerId: string;
  amount: number | string;
  method: PaymentMethod;
  note?: string;
}) {
  const amount = new Prisma.Decimal(input.amount);
  if (amount.lte(0)) throw new AppError("BAD_AMOUNT", "Amount must be greater than 0");

  return prisma.$transaction(async (tx) => {
    // Atomic: only decrements if the customer actually owes at least this much
    const res = await tx.customer.updateMany({
      where: {
        id: input.customerId,
        businessId: input.businessId, // tenant isolation
        balance: { gte: amount },
      },
      data: { balance: { decrement: amount } },
    });

    if (res.count === 0) {
      const exists = await tx.customer.findFirst({
        where: { id: input.customerId, businessId: input.businessId },
        select: { id: true },
      });
      if (!exists) throw new AppError("CUSTOMER_NOT_FOUND", "Customer not found");
      throw new AppError("OVERPAYMENT", "Payment is more than the amount owed");
    }

    await tx.customerLedgerEntry.create({
      data: {
        businessId: input.businessId,
        customerId: input.customerId,
        type: "PAYMENT_RECEIVED",
        amount: amount.neg(),
        note: [input.method, input.note].filter(Boolean).join(" - "),
      },
    });

    return tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
  });
}
