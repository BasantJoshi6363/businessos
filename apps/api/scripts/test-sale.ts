import { prisma } from "../src/db";
import { createSale, AppError } from "../src/modules/sales/create-sale";

async function main() {
  const business = await prisma.business.findFirstOrThrow({ where: { name: "Demo Kirana Pasal" } });
  const user = await prisma.user.findFirstOrThrow({ where: { businessId: business.id } });
  const rice = await prisma.product.findFirstOrThrow({ where: { businessId: business.id, sku: "RICE-1" } });
  const cola = await prisma.product.findFirstOrThrow({ where: { businessId: business.id, sku: "COLA-500" } });
  const ram = await prisma.customer.findFirstOrThrow({ where: { businessId: business.id, name: "Ram Bahadur" } });

  // 1) Full cash sale: 2 rice + 3 cola = 220 + 150 = 370
  const s1 = await createSale({
    businessId: business.id, userId: user.id,
    items: [{ productId: rice.id, quantity: 2 }, { productId: cola.id, quantity: 3 }],
    paidAmount: 370, paymentMethod: "CASH",
  });
  console.log("Cash sale #", s1.invoiceNo, "total", s1.total.toString());

  // 2) Credit sale: 5 rice = 550, paid 200, due 350
  const s2 = await createSale({
    businessId: business.id, userId: user.id, customerId: ram.id,
    items: [{ productId: rice.id, quantity: 5 }],
    paidAmount: 200, paymentMethod: "CASH",
  });
  console.log("Credit sale #", s2.invoiceNo, "total", s2.total.toString());

  // 3) Oversell must fail
  try {
    await createSale({
      businessId: business.id, userId: user.id,
      customerId: ram.id,
      items: [{ productId: rice.id, quantity: 9999 }],
      paidAmount: 0, paymentMethod: "CASH",
    });
    console.log("ERROR: oversell was allowed");
  } catch (e) {
    console.log("Oversell blocked:", e instanceof AppError ? e.code : e);
  }

  const r = await prisma.product.findUniqueOrThrow({ where: { id: rice.id } });
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: ram.id } });
  console.log("Rice stock (expect 93):", r.stockQty.toString());
  console.log("Ram balance (expect 350):", c.balance.toString());
}

main().finally(() => prisma.$disconnect());
