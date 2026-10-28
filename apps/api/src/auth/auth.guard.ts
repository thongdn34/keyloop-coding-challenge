import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthService, AuthUser } from "./auth.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      header: (name: string) => string | undefined;
      user?: AuthUser;
    }>();
    request.user = this.auth.authenticate(request.header("authorization"));
    return true;
  }
}
