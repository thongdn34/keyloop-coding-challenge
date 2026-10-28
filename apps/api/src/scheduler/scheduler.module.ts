import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SchedulerController } from "./scheduler.controller";
import { SchedulerService } from "./scheduler.service";

@Module({
  imports: [AuthModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
