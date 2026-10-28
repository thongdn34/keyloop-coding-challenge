import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "../auth/auth.guard";
import { AuthUser, scopedDealerships } from "../auth/auth.service";
import { requestValidation } from "../common/validation.pipe";
import { AppointmentQueryDto } from "./dto/appointment-query.dto";
import { BookingDto } from "./dto/booking.dto";
import { SchedulerService, validInstant } from "./scheduler.service";

type AuthedRequest = Request & { user: AuthUser };

@Controller("api")
export class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get("catalog")
  @UseGuards(AuthGuard)
  catalog(@Req() request: AuthedRequest) {
    return this.scheduler.catalog(request.user.dealershipIds);
  }

  @Get("appointments")
  @UseGuards(AuthGuard)
  appointments(
    @Req() request: AuthedRequest,
    @Query(requestValidation) query: AppointmentQueryDto,
  ) {
    return this.scheduler.appointments({
      dealershipIds: scopedDealerships(request.user, query.dealershipId),
      from: validInstant(query.from),
      to: validInstant(query.to),
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Post("availability")
  @UseGuards(AuthGuard)
  availability(
    @Req() request: AuthedRequest,
    @Body(requestValidation) booking: BookingDto,
  ) {
    scopedDealerships(request.user, booking.dealershipId);
    return this.scheduler.availability(booking);
  }

  @Post("appointments")
  @UseGuards(AuthGuard)
  book(
    @Req() request: AuthedRequest,
    @Body(requestValidation) booking: BookingDto,
    @Headers("idempotency-key") idempotencyKey?: string | string[],
  ) {
    scopedDealerships(request.user, booking.dealershipId);
    const key = Array.isArray(idempotencyKey)
      ? idempotencyKey[0]
      : idempotencyKey;
    return this.scheduler.book(booking, key);
  }
}
