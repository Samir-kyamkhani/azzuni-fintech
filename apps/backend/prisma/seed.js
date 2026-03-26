import { PrismaClient } from "@prisma/client";
import { CryptoService } from "../src/utils/cryptoService.js";

const prisma = new PrismaClient();

async function main() {
  console.log("🚀 Starting minimal seed...");

  console.log("\n👥 Creating roles...");

  const roles = [
    {
      name: "AZZUNIQUE",
      level: 0,
      type: "business",
      description: "Platform Owner",
    },
    {
      name: "RESELLER",
      level: 1,
      type: "business",
      description: "Reseller",
    },
    {
      name: "WHITELABEL",
      level: 2,
      type: "business",
      description: "WHITELABEL Partner",
    },
    {
      name: "STATE HEAD",
      level: 3,
      type: "business",
      description: "State Head",
    },
    {
      name: "MASTER DISTRIBUTOR",
      level: 4,
      type: "business",
      description: "Master Distributor",
    },
    {
      name: "DISTRIBUTOR",
      level: 5,
      type: "business",
      description: "Distributor",
    },
    {
      name: "RETAILER",
      level: 6,
      type: "business",
      description: "Retailer",
    },
    {
      name: "HR",
      level: 7,
      type: "employee",
      description: "Human Resources",
    },
  ];

  const createdRoles = {};

  for (const role of roles) {
    const created = await prisma.role.upsert({
      where: { name: role.name }, // ✅ FIXED (was level before)
      update: {
        level: role.level,
        type: role.type,
        description: role.description,
      },
      create: {
        name: role.name,
        level: role.level,
        type: role.type,
        description: role.description,
        createdBy: null,
      },
    });

    createdRoles[role.level] = created;
    console.log(`✅ Role created: ${created.name} (${created.type})`);
  }

  console.log("\n👑 Creating AZZUNIQUE user...");

  const password = CryptoService.encrypt("Admin@123");
  const pin = CryptoService.encrypt("1234");

  const azzuniqueUser = await prisma.user.upsert({
    where: { email: "owner@gmail.com" },
    update: {},
    create: {
      username: "azzunique",
      firstName: "Azzunique",
      lastName: "Owner",
      profileImage: "",
      email: "owner@gmail.com",
      phoneNumber: "9999999991",
      password: password,
      transactionPin: pin,
      roleId: createdRoles[0].id, // ✅ AZZUNIQUE
      hierarchyLevel: 0,
      hierarchyPath: "0",
      status: "ACTIVE",
      isKycVerified: true,
    },
  });

  console.log(`✅ AZZUNIQUE user created: ${azzuniqueUser.username}`);

  // ✅ Set createdBy for top role
  await prisma.role.update({
    where: { id: createdRoles[0].id },
    data: {
      createdBy: azzuniqueUser.id,
    },
  });

  const businessUsers = [azzuniqueUser];

  console.log("\n💳 Creating wallets...");

  for (const user of businessUsers) {
    // COMMISSION
    await prisma.wallet.upsert({
      where: {
        userId_walletType: {
          userId: user.id,
          walletType: "COMMISSION",
        },
      },
      update: {},
      create: {
        userId: user.id,
        walletType: "COMMISSION",
        balance: BigInt(0),
        holdBalance: BigInt(0),
        currency: "INR",
        isActive: true,
        version: 1,
      },
    });

    // GST
    await prisma.wallet.upsert({
      where: {
        userId_walletType: {
          userId: user.id,
          walletType: "GST",
        },
      },
      update: {},
      create: {
        userId: user.id,
        walletType: "GST",
        balance: BigInt(0),
        holdBalance: BigInt(0),
        currency: "INR",
        isActive: true,
        version: 1,
      },
    });

    // TDS
    await prisma.wallet.upsert({
      where: {
        userId_walletType: {
          userId: user.id,
          walletType: "TDS",
        },
      },
      update: {},
      create: {
        userId: user.id,
        walletType: "TDS",
        balance: BigInt(0),
        holdBalance: BigInt(0),
        currency: "INR",
        isActive: true,
        version: 1,
      },
    });

    console.log(`💳 Wallets created for ${user.username}`);
  }

  console.log("\n🎉 Seeding completed successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Seeding failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
