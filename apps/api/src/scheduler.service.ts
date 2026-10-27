import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  Appointment,
  Customer,
  Dealership,
  ServiceBay,
  ServiceType,
  Technician,
  TechnicianSkill,
  Vehicle,
} from "./entities";

export type BookingInput = {
  dealershipId: number;
  vehicleId: number;
  serviceTypeId: number;
  startAt: string;
};

export function overlaps(a: Date, b: Date, c: Date, d: Date): boolean {
  return a < d && b > c;
}

export function validStart(value: string): Date {
  const isoInstant =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

  if (typeof value !== "string" || !isoInstant.test(value)) {
    throw new BadRequestException(
      "Provide an ISO 8601 time with a timezone offset",
    );
  }

  const start = new Date(value);
  if (!Number.isFinite(start.getTime()) || start.getTime() < Date.now()) {
    throw new BadRequestException("Start must be in the future");
  }

  return start;
}

@Injectable()
export class SchedulerService {
  constructor(private readonly db: DataSource) {}

  async catalog() {
    const manager = this.db.manager;
    return {
      dealerships: await manager.find(Dealership),
      customers: await manager.find(Customer),
      vehicles: await manager.find(Vehicle),
      services: await manager.find(ServiceType),
    };
  }

  async appointments(dealershipId?: number) {
    return this.db.getRepository(Appointment).find({
      where: dealershipId ? { dealershipId } : {},
      order: { startAt: "ASC" },
    });
  }

  private async context(manager: EntityManager, input: BookingInput) {
    if (
      ![input.dealershipId, input.vehicleId, input.serviceTypeId].every(
        (id) => Number.isInteger(id) && id > 0,
      )
    ) {
      throw new BadRequestException("Invalid identifiers");
    }

    const [dealership, vehicle, service] = await Promise.all([
      manager.findOneBy(Dealership, { id: input.dealershipId }),
      manager.findOneBy(Vehicle, { id: input.vehicleId }),
      manager.findOneBy(ServiceType, { id: input.serviceTypeId }),
    ]);
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
    const bays = await manager.find(ServiceBay, {
      where: { dealershipId: input.dealershipId, active: true },
      order: { id: "ASC" },
    });
    const technicians = await manager
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
      .orderBy("technician.id", "ASC")
      .getMany();
    const booked = await manager
      .createQueryBuilder(Appointment, "appointment")
      .where(
        "appointment.dealershipId = :dealer AND appointment.status = :status " +
          "AND appointment.startAt < :end AND appointment.endAt > :start",
        {
          dealer: input.dealershipId,
          status: "confirmed",
          start,
          end,
        },
      )
      .getMany();

    // Stable first-fit assignment is an explicit product rule for this demo.
    return {
      bay: bays.find(
        (bay) =>
          !booked.some((appointment) => appointment.serviceBayId === bay.id),
      ),
      technician: technicians.find(
        (technician) =>
          !booked.some(
            (appointment) => appointment.technicianId === technician.id,
          ),
      ),
    };
  }

  async availability(input: BookingInput) {
    const start = validStart(input.startAt);
    const { service } = await this.context(this.db.manager, input);
    const end = new Date(start.getTime() + service.durationMinutes * 60_000);
    const { bay, technician } = await this.resources(
      this.db.manager,
      input,
      start,
      end,
    );

    return {
      available: Boolean(bay && technician),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      durationMinutes: service.durationMinutes,
      serviceBay: bay ?? null,
      technician: technician ?? null,
    };
  }

  async book(input: BookingInput) {
    const start = validStart(input.startAt);

    return this.db.transaction("READ COMMITTED", async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        input.dealershipId,
      ]);
      const { vehicle, service } = await this.context(manager, input);
      const end = new Date(start.getTime() + service.durationMinutes * 60_000);
      const { bay, technician } = await this.resources(
        manager,
        input,
        start,
        end,
      );

      if (!bay || !technician) {
        throw new ConflictException(
          "Technician or service bay unavailable for entire appointment",
        );
      }

      return manager.save(
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
    });
  }
}
