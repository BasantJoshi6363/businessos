import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const existing = await prisma.business.findFirst({ where: { name: "Demo Kirana Pasal" } });
  if (existing) {
    console.log("Seed already applied, skipping.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: { name: "Demo Kirana Pasal", phone: "9800000000", address: "Dhangadhi" },
    });

    await tx.user.create({
      data: {
        businessId: business.id,
        name: "Owner",
        email: "owner@demo.local",
        passwordHash: hashPassword("demo12345"),
        role: "OWNER",
      },
    });

    const grocery = await tx.category.create({ data: { businessId: business.id, name: "Grocery" } });
    const drinks = await tx.category.create({ data: { businessId: business.id, name: "Drinks" } });

    const products = [
      { name: "Rice 1kg", sku: "RICE-1", unit: "kg", costPrice: 90, sellPrice: 110, qty: 100, categoryId: grocery.id },
      { name: "Sugar 1kg", sku: "SUGAR-1", unit: "kg", costPrice: 95, sellPrice: 115, qty: 60, categoryId: grocery.id },
      { name: "Cooking Oil 1L", sku: "OIL-1", unit: "pcs", costPrice: 210, sellPrice: 245, qty: 40, categoryId: grocery.id },
      { name: "Coca-Cola 500ml", sku: "COLA-500", unit: "pcs", costPrice: 40, sellPrice: 50, qty: 80, categoryId: drinks.id },
    ];

    for (const p of products) {
      const product = await tx.product.create({
        data: {
          businessId: business.id,
          categoryId: p.categoryId,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          costPrice: p.costPrice,
          sellPrice: p.sellPrice,
          stockQty: p.qty,
          reorderLevel: 10,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          businessId: business.id,
          productId: product.id,
          type: "OPENING",
          quantity: p.qty,
          unitCost: p.costPrice,
          note: "Opening stock",
        },
      });
    }

    await tx.customer.createMany({
      data: [
        { businessId: business.id, name: "Ram Bahadur", phone: "9811111111" },
        { businessId: business.id, name: "Sita Devi", phone: "9822222222" },
      ],
    });

    await tx.supplier.create({
      data: { businessId: business.id, name: "Local Wholesaler", phone: "9833333333" },
    });
  });

  console.log("Seed complete. Login: owner@demo.local / demo12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
