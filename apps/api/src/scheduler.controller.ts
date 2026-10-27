import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  ServiceUnavailableException,
  ValidationPipe,
} from "@nestjs/common";
import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, Min } from "class-validator";
import { DataSource } from "typeorm";
import { MetricsService } from "./observability";
import { SchedulerService } from "./scheduler.service";

const validationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

class BookingDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dealershipId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  vehicleId!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceTypeId!: number;

  @IsDateString({ strict: true })
  startAt!: string;
}

class AppointmentQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dealershipId?: number;
}

@Controller("api")
export class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly db: DataSource,
    private readonly metrics: MetricsService,
  ) {}

  @Get("health")
  async health() {
    try {
      await this.db.query("SELECT 1");
      return { status: "ok", database: "ok" };
    } catch {
      throw new ServiceUnavailableException("Database is unavailable");
    }
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsReport(): string {
    return this.metrics.render();
  }

  @Get("catalog")
  catalog() {
    return this.scheduler.catalog();
  }

  @Get("appointments")
  appointments(@Query(validationPipe) query: AppointmentQueryDto) {
    return this.scheduler.appointments(query.dealershipId);
  }

  @Post("availability")
  availability(@Body(validationPipe) booking: BookingDto) {
    return this.scheduler.availability(booking);
  }

  @Post("appointments")
  book(@Body(validationPipe) booking: BookingDto) {
    return this.scheduler.book(booking);
  }
}
