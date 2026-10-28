import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { DataSource } from "typeorm";
import { authSecret } from "../config/runtime.config";
import { DEMO_PASSWORD } from "./demo-accounts";
import { AppUser, Dealership } from "../database/entities";
import { logEvent } from "../common/observability/observability";

export type AuthUser = {
  sub: string;
  role: "advisor" | "coordinator";
  dealershipIds: number[];
  exp: number;
};

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const DUMMY_HASH = hashPassword(DEMO_PASSWORD);

export function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", authSecret()).update(body).digest("base64url");
}

export function signToken(user: AuthUser): string {
  const body = encode(JSON.stringify(user));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): AuthUser {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    throw new UnauthorizedException("Sign in required");
  }
  const expected = sign(body);
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new UnauthorizedException("Sign in required");
  }
  let parsed: AuthUser;
  try {
    parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as AuthUser;
  } catch {
    throw new UnauthorizedException("Sign in required");
  }
  if (
    !parsed ||
    typeof parsed.sub !== "string" ||
    (parsed.role !== "advisor" && parsed.role !== "coordinator") ||
    !Array.isArray(parsed.dealershipIds) ||
    !parsed.dealershipIds.every((id) => Number.isInteger(id) && id > 0) ||
    typeof parsed.exp !== "number" ||
    parsed.exp < Math.floor(Date.now() / 1000)
  ) {
    throw new UnauthorizedException("Sign in required");
  }
  return parsed;
}

export function requireDealership(user: AuthUser, dealershipId: number): void {
  if (!user.dealershipIds.includes(dealershipId)) {
    logEvent("warn", "dealership_access_denied", {
      role: user.role,
      dealershipId,
    });
    throw new ForbiddenException("You cannot access this dealership");
  }
}

export function scopedDealerships(
  user: AuthUser,
  dealershipId?: number,
): number[] {
  if (dealershipId != null) {
    requireDealership(user, dealershipId);
    return [dealershipId];
  }
  return user.dealershipIds;
}

@Injectable()
export class AuthService {
  constructor(private readonly db: DataSource) {}

  authenticate(header?: string): AuthUser {
    const match = /^Bearer\s+(\S+)$/.exec(header ?? "");
    if (!match) throw new UnauthorizedException("Sign in required");
    return verifyToken(match[1]);
  }

  async login(username: string, password: string) {
    const user = await this.db.getRepository(AppUser).findOneBy({ username });
    const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      logEvent("warn", "login_failed", {});
      throw new UnauthorizedException("Those credentials were not accepted");
    }

    const dealershipIds =
      user.role === "coordinator"
        ? (
            await this.db.getRepository(Dealership).find({
              select: { id: true },
              order: { id: "ASC" },
            })
          ).map((dealership) => dealership.id)
        : [user.dealershipId as number];
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const authUser: AuthUser = {
      sub: user.username,
      role: user.role,
      dealershipIds,
      exp,
    };
    logEvent("info", "login_succeeded", { role: user.role });
    return {
      token: signToken(authUser),
      username: user.username,
      role: user.role,
      dealershipIds,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }
}
