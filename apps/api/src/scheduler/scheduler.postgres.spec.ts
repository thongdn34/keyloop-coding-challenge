import { ConflictException, ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { DataSource } from "typeorm";
import {
  AuthService,
  requireDealership,
  signToken,
} from "../auth/auth.service";
import { dataSourceOptions, runMigrationsOnce } from "../database/data-source";
import { DEMO_PASSWORD } from "../auth/demo-accounts";
import {
  Appointment,
  Dealership,
  ServiceType,
  Vehicle,
} from "../database/entities";
import { MetricsService } from "../common/observability/observability";
import { SchedulerService } from "./scheduler.service";
import { seed } from "../seed/seed";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.CI && !databaseUrl) {
  throw new Error("CI requires DATABASE_URL so booking tests hit PostgreSQL");
}

const suite = databaseUrl ? describe : describe.skip;

suite("postgresql booking", () => {
  let db: DataSource;
  let scheduler: SchedulerService;
  let dealershipId = 0;
  let otherDealershipId = 0;
  let vehicleId = 0;
  let customerId = 0;
  let serviceTypeId = 0;

  beforeAll(async () => {
    db = new DataSource(dataSourceOptions());
    await db.initialize();
    await runMigrationsOnce(db);
    await seed(db, { catalog: true, users: true });
    scheduler = new SchedulerService(db, new MetricsService());
    const dealers = await db
      .getRepository(Dealership)
      .find({ order: { id: "ASC" } });
    const central = dealers.find(
      (item) => item.name === "Central Auto Service",
    );
    const riverside = dealers.find((item) => item.name === "Riverside Motors");
    const vehicle = await db
      .getRepository(Vehicle)
      .findOneByOrFail({ model: "Corolla" });
    const service = await db.getRepository(ServiceType).findOneByOrFail({
      durationMinutes: 60,
    });
    if (!central || !riverside) throw new Error("Seed dealerships are missing");
    dealershipId = central.id;
    otherDealershipId = riverside.id;
    vehicleId = vehicle.id;
    customerId = vehicle.customerId;
    serviceTypeId = service.id;
  }, 30_000);

  afterAll(async () => {
    await db?.destroy();
  });

  // Keep this run clear of appointments left by earlier runs in the same database.
  const runBase =
    Date.now() + (800 + Math.floor(Math.random() * 500_000)) * 3_600_000;

  function startAt(hoursAhead: number) {
    return new Date(runBase + hoursAhead * 3_600_000).toISOString();
  }

  function booking(hoursAhead: number, dealer = dealershipId) {
    return {
      dealershipId: dealer,
      vehicleId,
      serviceTypeId,
      startAt: startAt(hoursAhead),
    };
  }

  it("creates exactly one seed catalog when two runners start together", async () => {
    await Promise.all([
      seed(db, { catalog: true, users: true }),
      seed(db, { catalog: true, users: true }),
    ]);
    expect(await db.getRepository(Dealership).count()).toBe(2);
  });

  it("confirms one of two simultaneous requests when one resource pair remains", async () => {
    const input = booking(80);
    await scheduler.book(input);
    const results = await Promise.allSettled([
      scheduler.book(input),
      scheduler.book(input),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(ConflictException) });
    const rows = await db.getRepository(Appointment).find({
      where: { dealershipId, startAt: new Date(input.startAt) },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.serviceBayId)).size).toBe(2);
    expect(new Set(rows.map((row) => row.technicianId)).size).toBe(2);
  });

  it("allows two simultaneous bookings that do not overlap", async () => {
    const first = booking(100);
    const second = booking(104);
    const results = await Promise.allSettled([
      scheduler.book(first),
      scheduler.book(second),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("rejects a direct overlapping insert and allows an adjacent one", async () => {
    const saved = await scheduler.book(booking(120));
    const start = new Date(saved.startAt);
    const overlap = new Date(start.getTime() + 30 * 60_000);
    await expect(
      db.query(
        `INSERT INTO "appointment"
          ("dealershipId","customerId","vehicleId","serviceTypeId","technicianId","serviceBayId","startAt","endAt","status")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed')`,
        [
          saved.dealershipId,
          customerId,
          vehicleId,
          serviceTypeId,
          saved.technicianId,
          saved.serviceBayId,
          overlap,
          new Date(overlap.getTime() + 60 * 60_000),
        ],
      ),
    ).rejects.toMatchObject({ code: "23P01" });

    const adjacent = await scheduler.book({
      ...booking(0),
      startAt: saved.endAt,
    });
    expect(new Date(adjacent.startAt).toISOString()).toBe(
      new Date(saved.endAt).toISOString(),
    );
  });

  it("returns the original appointment for an idempotency replay", async () => {
    const input = booking(140);
    const key = `retry-${Date.now()}`;
    const first = await scheduler.book(input, key);
    const second = await scheduler.book(input, key);
    expect(second).toEqual(first);
    expect(
      await db.getRepository(Appointment).count({ where: { id: first.id } }),
    ).toBe(1);
    await expect(
      scheduler.book({ ...input, startAt: startAt(160) }, key),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("stops an advisor from booking another dealership", async () => {
    const auth = new AuthService(db);
    const session = await auth.login("central.advisor", DEMO_PASSWORD);
    expect(session.dealershipIds).toEqual([dealershipId]);
    expect(session.dealershipIds).not.toContain(otherDealershipId);
    const tokenUser = {
      sub: "central.advisor",
      role: "advisor" as const,
      dealershipIds: session.dealershipIds,
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    expect(signToken(tokenUser)).toContain(".");
    expect(() => requireDealership(tokenUser, otherDealershipId)).toThrow(
      ForbiddenException,
    );
    const coordinator = await auth.login("coordinator", DEMO_PASSWORD);
    expect(coordinator.dealershipIds).toEqual(
      expect.arrayContaining([dealershipId, otherDealershipId]),
    );
  });
});
