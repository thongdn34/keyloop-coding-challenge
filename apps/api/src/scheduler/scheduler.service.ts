import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  Appointment,
  AppointmentStatus,
  Customer,
  Dealership,
  ServiceBay,
  ServiceType,
  Technician,
  TechnicianSkill,
  Vehicle,
} from "../database/entities";
import {
  logEvent,
  MetricsService,
  withSpan,
} from "../common/observability/observability";

export type BookingInput = {
  dealershipId: number;
  vehicleId: number;
  serviceTypeId: number;
  startAt: string;
};

export type AppointmentView = {
  id: number;
  dealershipId: number;
  customerId: number;
  vehicleId: number;
  serviceTypeId: number;
  technicianId: number;
  serviceBayId: number;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
};

export type AppointmentPage = {
  items: AppointmentView[];
  nextCursor: string | null;
};

export const MAX_WINDOW_MS = 93 * 24 * 60 * 60 * 1000;
export const MAX_PAGE_SIZE = 50;
const isoInstant =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

export function overlaps(a: Date, b: Date, c: Date, d: Date): boolean {
  return a < d && b > c;
}

export function validInstant(value: string): Date {
  if (typeof value !== "string" || !isoInstant.test(value)) {
    throw new BadRequestException(
      "Provide an ISO 8601 time with a timezone offset",
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(
      "Provide an ISO 8601 time with a timezone offset",
    );
  }
  return parsed;
}

export function validStart(value: string): Date {
  const start = validInstant(value);
  if (start.getTime() < Date.now()) {
    throw new BadRequestException("Start must be in the future");
  }
  return start;
}

export function assertWindow(from: Date, to: Date): void {
  if (!(from < to)) {
    throw new BadRequestException("from must be before to");
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    throw new BadRequestException("Date window cannot exceed 93 days");
  }
}

export function encodeCursor(row: {
  startAt: Date | string;
  id: number;
}): string {
  const startAt =
    row.startAt instanceof Date ? row.startAt.toISOString() : row.startAt;
  return Buffer.from(JSON.stringify({ startAt, id: row.id })).toString(
    "base64url",
  );
}

export function decodeCursor(value: string): { startAt: Date; id: number } {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { startAt?: string; id?: number };
    if (
      !parsed.startAt ||
      !Number.isInteger(parsed.id) ||
      (parsed.id ?? 0) < 1
    ) {
      throw new Error("bad cursor");
    }
    return { startAt: validInstant(parsed.startAt), id: parsed.id as number };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("Invalid cursor");
  }
}

function toView(row: Appointment): AppointmentView {
  return {
    id: row.id,
    dealershipId: row.dealershipId,
    customerId: row.customerId,
    vehicleId: row.vehicleId,
    serviceTypeId: row.serviceTypeId,
    technicianId: row.technicianId,
    serviceBayId: row.serviceBayId,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    status: row.status,
  };
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: string; driverError?: { code?: string } };
  return candidate.driverError?.code ?? candidate.code;
}

@Injectable()
export class SchedulerService {
  constructor(
    private readonly db: DataSource,
    private readonly metrics: MetricsService = new MetricsService(),
  ) {}

  async catalog(dealershipIds: number[]) {
    if (dealershipIds.length === 0) {
      return { dealerships: [], customers: [], vehicles: [], services: [] };
    }
    const manager = this.db.manager;
    const [dealerships, customers, vehicles, services] = await Promise.all([
      manager
        .createQueryBuilder(Dealership, "dealership")
        .where("dealership.id IN (:...ids)", { ids: dealershipIds })
        .orderBy("dealership.id", "ASC")
        .getMany(),
      manager.find(Customer, {
        select: { id: true, name: true },
        order: { id: "ASC" },
      }),
      manager.find(Vehicle, { order: { id: "ASC" } }),
      manager.find(ServiceType, { order: { id: "ASC" } }),
    ]);
    return {
      dealerships,
      customers: customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
      })),
      vehicles,
      services,
    };
  }

  async appointments(input: {
    dealershipIds: number[];
    from: Date;
    to: Date;
    limit?: number;
    cursor?: string;
  }): Promise<AppointmentPage> {
    assertWindow(input.from, input.to);
    if (input.dealershipIds.length === 0) {
      return { items: [], nextCursor: null };
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_PAGE_SIZE);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const rows = await this.db
      .getRepository(Appointment)
      .createQueryBuilder("appointment")
      .where("appointment.dealershipId IN (:...ids)", {
        ids: input.dealershipIds,
      })
      .andWhere("appointment.endAt > :from AND appointment.startAt < :to", {
        from: input.from,
        to: input.to,
      })
      .andWhere(
        cursor
          ? "(appointment.startAt, appointment.id) > (:cursorStart, :cursorId)"
          : "TRUE",
        cursor ? { cursorStart: cursor.startAt, cursorId: cursor.id } : {},
      )
      .orderBy("appointment.startAt", "ASC")
      .addOrderBy("appointment.id", "ASC")
      .take(limit + 1)
      .getMany();
    const page = rows.slice(0, limit).map(toView);
    const last = rows.length > limit ? page[page.length - 1] : undefined;
    return {
      items: page,
      nextCursor: last ? encodeCursor(last) : null,
    };
  }

  private async context(manager: EntityManager, input: BookingInput) {
    if (
      ![input.dealershipId, input.vehicleId, input.serviceTypeId].every(
        (id) => Number.isInteger(id) && id > 0,
      )
    ) {
      throw new BadRequestException("Invalid identifiers");
    }

    // One transaction uses one connection, so these reads stay sequential.
    const dealership = await manager.findOneBy(Dealership, {
      id: input.dealershipId,
    });
    const vehicle = await manager.findOneBy(Vehicle, { id: input.vehicleId });
    const service = await manager.findOneBy(ServiceType, {
      id: input.serviceTypeId,
    });
    if (!dealership || !vehicle || !service) {
      throw new NotFoundException(
        "Unknown dealership, vehicle, or service type",
      );
    }

    return { vehicle, service };
  }

  private async resources(
    manager: EntityManager,
    input: BookingInput,
    start: Date,
    end: Date,
  ) {
    const overlap = `
      AND booked.status = 'confirmed'
      AND booked."startAt" < :end
      AND booked."endAt" > :start
    `;
    const bay = await manager
      .createQueryBuilder(ServiceBay, "bay")
      .where("bay.dealershipId = :dealer AND bay.active = true", {
        dealer: input.dealershipId,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "appointment" booked
          WHERE booked."serviceBayId" = bay.id
          ${overlap}
        )`,
        { start, end },
      )
      .orderBy("bay.id", "ASC")
      .limit(1)
      .getOne();
    const technician = await manager
      .createQueryBuilder(Technician, "technician")
      .innerJoin(
        TechnicianSkill,
        "skill",
        "skill.technicianId = technician.id AND skill.serviceTypeId = :service",
        { service: input.serviceTypeId },
      )
      .where("technician.dealershipId = :dealer AND technician.active = true", {
        dealer: input.dealershipId,
      })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM "appointment" booked
          WHERE booked."technicianId" = technician.id
          ${overlap}
        )`,
        { start, end },
      )
      .orderBy("technician.id", "ASC")
      .limit(1)
      .getOne();
    return { bay, technician };
  }

  async availability(input: BookingInput) {
    const start = validStart(input.startAt);
    const { service } = await this.context(this.db.manager, input);
    const end = new Date(start.getTime() + service.durationMinutes * 60_000);
    const { bay, technician } = await withSpan("db.allocate", () =>
      this.resources(this.db.manager, input, start, end),
    );
    const available = Boolean(bay && technician);
    logEvent("info", "availability_checked", {
      dealershipId: input.dealershipId,
      available,
    });
    return {
      available,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: service.durationMinutes,
      serviceBay: bay ?? null,
      technician: technician ?? null,
    };
  }

  async book(
    input: BookingInput,
    idempotencyKey?: string,
  ): Promise<AppointmentView> {
    const start = validStart(input.startAt);
    const key = idempotencyKey?.trim() || undefined;
    if (key && !idempotencyKeyPattern.test(key)) {
      throw new BadRequestException(
        "Idempotency key must be 8 to 128 characters and use letters, numbers, or . _ : -",
      );
    }
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          dealershipId: input.dealershipId,
          vehicleId: input.vehicleId,
          serviceTypeId: input.serviceTypeId,
          startAt: input.startAt,
        }),
      )
      .digest("hex");

    try {
      return await withSpan("booking.confirm", () =>
        this.db.transaction("READ COMMITTED", async (manager) => {
          const lockStarted = process.hrtime.bigint();
          await manager.query("SELECT pg_advisory_xact_lock($1)", [
            input.dealershipId,
          ]);
          this.metrics.recordLockWait(
            Number(process.hrtime.bigint() - lockStarted) / 1_000_000_000,
          );

          if (key) {
            await manager.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
              [key],
            );
            const existing: Array<{
              requestHash: string;
              response: AppointmentView | string;
            }> = await manager.query(
              `SELECT "requestHash", "response" FROM "idempotency_record" WHERE "key" = $1`,
              [key],
            );
            const replay = existing[0];
            if (replay) {
              if (replay.requestHash !== requestHash) {
                throw new ConflictException(
                  "Idempotency key was already used for a different request",
                );
              }
              this.metrics.recordBooking("replay");
              logEvent("info", "booking_replayed", {
                dealershipId: input.dealershipId,
              });
              return typeof replay.response === "string"
                ? (JSON.parse(replay.response) as AppointmentView)
                : replay.response;
            }
          }

          const { vehicle, service } = await this.context(manager, input);
          const end = new Date(
            start.getTime() + service.durationMinutes * 60_000,
          );
          const { bay, technician } = await withSpan("db.allocate", () =>
            this.resources(manager, input, start, end),
          );
          if (!bay || !technician) {
            throw new ConflictException(
              "Technician or service bay unavailable for entire appointment",
            );
          }

          const saved = await manager.save(
            Appointment,
            manager.create(Appointment, {
              dealershipId: input.dealershipId,
              customerId: vehicle.customerId,
              vehicleId: vehicle.id,
              serviceTypeId: input.serviceTypeId,
              technicianId: technician.id,
              serviceBayId: bay.id,
              startAt: start,
              endAt: end,
              status: "confirmed",
            }),
          );
          const view = toView(saved);
          if (key) {
            await manager.query(
              `INSERT INTO "idempotency_record" ("key", "requestHash", "response")
               VALUES ($1, $2, $3::jsonb)`,
              [key, requestHash, JSON.stringify(view)],
            );
          }
          this.metrics.recordBooking("confirmed");
          logEvent("info", "booking_confirmed", {
            dealershipId: input.dealershipId,
            appointmentId: view.id,
          });
          return view;
        }),
      );
    } catch (error) {
      if (errorCode(error) === "23P01") {
        this.metrics.recordBooking("conflict");
        logEvent("info", "booking_conflict", {
          dealershipId: input.dealershipId,
          reason: "exclusion",
        });
        throw new ConflictException(
          "Technician or service bay unavailable for entire appointment",
        );
      }
      if (errorCode(error) === "57014") {
        logEvent("error", "database_timeout", {
          dealershipId: input.dealershipId,
        });
        throw new ServiceUnavailableException("The database timed out");
      }
      if (error instanceof ConflictException) {
        this.metrics.recordBooking("conflict");
        logEvent("info", "booking_conflict", {
          dealershipId: input.dealershipId,
        });
      }
      throw error;
    }
  }
}
