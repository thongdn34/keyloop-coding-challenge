import { ValidationPipe } from "@nestjs/common";

export const requestValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
