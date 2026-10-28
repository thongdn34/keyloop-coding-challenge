import { DataSource, EntityManager } from "typeorm";
import { hashPassword } from "../auth/auth.service";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "../auth/demo-accounts";
import {
  AppUser,
  Customer,
  Dealership,
  ServiceBay,
  ServiceType,
  Technician,
  TechnicianSkill,
  Vehicle,
} from "../database/entities";
import { logEvent } from "../common/observability/observability";

const SEED_LOCK = 424242;

async function insertCatalog(manager: EntityManager) {
  const d = await manager.getRepository(Dealership).save([
    { name: "Central Auto Service", city: "Ho Chi Minh City" },
    { name: "Riverside Motors", city: "Ho Chi Minh City" },
  ]);
  const c = await manager
    .getRepository(Customer)
    .save({ name: "Demo Customer", email: "demo@example.com" });
  await manager.getRepository(Vehicle).save([
    {
      customerId: c.id,
      make: "Toyota",
      model: "Corolla",
      registration: "59A-12345",
    },
    {
      customerId: c.id,
      make: "Honda",
      model: "Civic",
      registration: "59A-67890",
    },
  ]);
  const s = await manager.getRepository(ServiceType).save([
    { name: "Oil & filter change", durationMinutes: 60 },
    { name: "Brake inspection", durationMinutes: 90 },
    { name: "Major service", durationMinutes: 120 },
  ]);
  for (const dealer of d) {
    await manager.getRepository(ServiceBay).save([
      { dealershipId: dealer.id, name: "Bay 1", active: true },
      { dealershipId: dealer.id, name: "Bay 2", active: true },
    ]);
    const t = await manager.getRepository(Technician).save([
      { dealershipId: dealer.id, name: "Alex Tran", active: true },
      { dealershipId: dealer.id, name: "Sam Nguyen", active: true },
    ]);
    for (const technician of t) {
      for (const item of s) {
        await manager.getRepository(TechnicianSkill).save({
          technicianId: technician.id,
          serviceTypeId: item.id,
        });
      }
    }
  }
}

async function ensureUsers(manager: EntityManager) {
  for (const account of DEMO_ACCOUNTS) {
    const existing = await manager
      .getRepository(AppUser)
      .findOneBy({ username: account.username });
    if (existing) continue;
    let dealershipId: number | null = null;
    if (account.dealershipName) {
      const dealer = await manager
        .getRepository(Dealership)
        .findOneBy({ name: account.dealershipName });
      if (!dealer) continue;
      dealershipId = dealer.id;
    }
    await manager.getRepository(AppUser).save({
      username: account.username,
      passwordHash: hashPassword(DEMO_PASSWORD),
      role: account.role,
      dealershipId,
    });
  }
}

export async function seed(
  db: DataSource,
  options: { catalog: boolean; users: boolean },
) {
  if (!options.catalog && !options.users) return;
  await db.transaction(async (manager) => {
    await manager.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    if (
      options.catalog &&
      (await manager.getRepository(Dealership).count()) === 0
    ) {
      await insertCatalog(manager);
      logEvent("info", "catalog_seeded", {});
    }
    if (options.users) {
      await ensureUsers(manager);
      logEvent("info", "demo_users_ensured", {});
    }
  });
}
