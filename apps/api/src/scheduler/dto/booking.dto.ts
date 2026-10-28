import { Type } from "class-transformer";
import { IsDateString, IsInt, Min } from "class-validator";

export class BookingDto {
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
