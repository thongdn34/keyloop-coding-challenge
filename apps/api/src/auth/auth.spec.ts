import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "@jest/globals";
import {
  hashPassword,
  requireDealership,
  signToken,
  verifyPassword,
  verifyToken,
  type AuthUser,
} from "./auth.service";

const user: AuthUser = {
  sub: "central.advisor",
  role: "advisor",
  dealershipIds: [1],
  exp: Math.floor(Date.now() / 1000) + 600,
};

describe("demo authentication", () => {
  it("round-trips a signed token", () => {
    expect(verifyToken(signToken(user))).toMatchObject(user);
  });

  it("rejects a tampered token", () => {
    const [body] = signToken(user).split(".");
    expect(() => verifyToken(`${body}.not-a-valid-signature`)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects an expired token", () => {
    const token = signToken({
      ...user,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    expect(() => verifyToken(token)).toThrow(UnauthorizedException);
  });

  it("keeps an advisor inside their dealership", () => {
    expect(() => requireDealership(user, 1)).not.toThrow();
    expect(() => requireDealership(user, 2)).toThrow(ForbiddenException);
  });

  it("verifies a password hash", () => {
    const stored = hashPassword("scheduler-demo");
    expect(verifyPassword("scheduler-demo", stored)).toBe(true);
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });
});
