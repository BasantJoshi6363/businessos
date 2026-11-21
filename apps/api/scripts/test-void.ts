import { prisma } from "../src/db";
import { createSale, AppError } from "../src/modules/sales/create-sale";
import { voidSale } from "../src/modules/sales/void-sale";

async function main() {
  const business = await prisma.business.findFirstOrThrow({ where: { name: "Demo Kirana Pasal" } });
  const user = await prisma.user.findFirstOrThrow({ where: { businessId: business.id } });
  const rice = await prisma.product.findFirstOrThrow({ where: { businessId: business.id, sku: "RICE-1" } });
  const ram = await prisma.customer.findFirstOrThrow({ where: { businessId: business.id, name: "Ram Bahadur" } });

  const stock0 = rice.stockQty;
  const bal0 = ram.balance;

  // Credit sale: 2 rice = 220, paid 0 -> stock -2, balance +220
  const sale = await createSale({
    businessId: business.id, userId: user.id, customerId: ram.id,
    items: [{ productId: rice.id, quantity: 2 }],
    paidAmount: 0, paymentMethod: "CASH",
  });
  const afterSale = await prisma.product.findUniqueOrThrow({ where: { id: rice.id } });
  const balAfterSale = (await prisma.customer.findUniqueOrThrow({ where: { id: ram.id } })).balance;
  console.log(`After sale  -> stock ${afterSale.stockQty} (expect ${stock0.minus(2)}), balance ${balAfterSale} (expect ${bal0.plus(220)})`);

  const voided = await voidSale({ businessId: business.id, saleId: sale.id, reason: "test void" });
  console.log("Status:", voided.status);

  const afterVoid = await prisma.product.findUniqueOrThrow({ where: { id: rice.id } });
  const balAfterVoid = (await prisma.customer.findUniqueOrThrow({ where: { id: ram.id } })).balance;
  console.log(`After void  -> stock ${afterVoid.stockQty} (expect ${stock0}), balance ${balAfterVoid} (expect ${bal0})`);

  try {
    await voidSale({ businessId: business.id, saleId: sale.id });
    console.log("ERROR: double void allowed");
  } catch (e) {
    console.log("Double void blocked:", e instanceof AppError ? e.code : e);
  }

  // Tenant isolation: a different business id must not find this sale
  try {
    await voidSale({ businessId: "some-other-business", saleId: sale.id });
    console.log("ERROR: cross-tenant void allowed");
  } catch (e) {
    console.log("Cross-tenant blocked:", e instanceof AppError ? e.code : e);
  }
}

main().finally(() => prisma.$disconnect());
