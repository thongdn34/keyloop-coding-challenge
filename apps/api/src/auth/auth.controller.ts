import { Body, Controller, Post } from "@nestjs/common";
import { requestValidation } from "../common/validation.pipe";
import { AuthService } from "./auth.service";
import { SessionDto } from "./dto/session.dto";

@Controller("api")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("session")
  session(@Body(requestValidation) body: SessionDto) {
    return this.auth.login(body.username, body.password);
  }
}
