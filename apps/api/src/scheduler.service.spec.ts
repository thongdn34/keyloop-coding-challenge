import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";
import { DataSource, EntityManager } from "typeorm";
import {
  Appointment,
  Dealership,
  ServiceBay,
  ServiceType,
  Technician,
  Vehicle,
} from "./entities";
import { overlaps, SchedulerService, validStart } from "./scheduler.service";

describe("booking overlap", () => {
  const date = (hour: number) =>
    new Date(`2026-11-01T${String(hour).padStart(2, "0")}:00:00Z`);

  it("detects overlap", () => {
    expect(overlaps(date(10), date(12), date(11), date(13))).toBe(true);
  });

  it("permits adjacent slots", () => {
    expect(overlaps(date(10), date(11), date(11), date(12))).toBe(false);
  });
});

describe("start validation", () => {
  it("accepts the millisecond UTC value emitted by Date.toISOString()", () => {
    const value = "2099-11-01T10:00:00.000Z";
    expect(validStart(value).toISOString()).toBe(value);
  });

  it("accepts an explicit timezone offset", () => {
    expect(validStart("2099-11-01T17:00:00+07:00").toISOString()).toBe(
      "2099-11-01T10:00:00.000Z",
    );
  });

  it("rejects a local time without an offset", () => {
    expect(() => validStart("2099-11-01T10:00")).toThrow(BadRequestException);
  });
});

function concurrencyTestDatabase() {
  const appointments: Appointment[] = [];
  const dealership = { id: 1 } as Dealership;
  const vehicle = { id: 1, customerId: 1 } as Vehicle;
  const service = { id: 1, durationMinutes: 60 } as ServiceType;
  const bay = { id: 1, dealershipId: 1, active: true } as ServiceBay;
  const technician = {
    id: 1,
    dealershipId: 1,
    active: true,
  } as Technician;

  const queryBuilder = (entity: unknown) => {
    const builder = {
      innerJoin: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      getMany: jest.fn(async () =>
        entity === Technician ? [technician] : [...appointments],
      ),
    };
    builder.innerJoin.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    builder.orderBy.mockReturnValue(builder);
    return builder;
  };

  const manager = {
    query: jest.fn(async () => [{ pg_advisory_xact_lock: null }]),
    findOneBy: jest.fn(async (entity: unknown) => {
      if (entity === Dealership) return dealership;
      if (entity === Vehicle) return vehicle;
      if (entity === ServiceType) return service;
      return null;
    }),
    find: jest.fn(async (entity: unknown) =>
      entity === ServiceBay ? [bay] : [],
    ),
    createQueryBuilder: jest.fn(queryBuilder),
    create: jest.fn((_entity: unknown, value: Appointment) => value),
    save: jest.fn(async (_entity: unknown, value: Appointment) => {
      const saved = { ...value, id: appointments.length + 1 } as Appointment;
      appointments.push(saved);
      return saved;
    }),
  } as unknown as EntityManager;

  let previous = Promise.resolve();
  const transaction = jest.fn(
    async (
      _isolation: string,
      run: (transactionManager: EntityManager) => Promise<Appointment>,
    ) => {
      let release = () => {};
      const turn = new Promise<void>((resolve) => {
        release = () => resolve();
      });
      const waitFor = previous;
      previous = turn;
      await waitFor;
      try {
        return await run(manager);
      } finally {
        release();
      }
    },
  );

  return {
    appointments,
    dataSource: { transaction } as unknown as DataSource,
  };
}

describe("concurrent booking", () => {
  it("allows only one of two simultaneous requests for one resource pair", async () => {
    const { appointments, dataSource } = concurrencyTestDatabase();
    const scheduler = new SchedulerService(dataSource);
    const input = {
      dealershipId: 1,
      vehicleId: 1,
      serviceTypeId: 1,
      startAt: new Date(Date.now() + 3_600_000).toISOString(),
    };

    const results = await Promise.allSettled([
      scheduler.book(input),
      scheduler.book(input),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.any(ConflictException),
    });
    expect(appointments).toHaveLength(1);
  });
});
