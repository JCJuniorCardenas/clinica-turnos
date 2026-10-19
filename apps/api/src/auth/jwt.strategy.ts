import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import type { Request } from "express";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthUser } from "../common/roles";

const fromCookie = (req: Request): string | null => req?.cookies?.["access_token"] ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([fromCookie]),
      secretOrKey: process.env.JWT_SECRET!,
      ignoreExpiration: false,
    });
  }

  validate(payload: { sub: string; clinicaId: string; rol: AuthUser["rol"]; doctorId?: string }): AuthUser {
    if (!payload?.sub || !payload.clinicaId) throw new UnauthorizedException();
    return {
      userId: payload.sub,
      clinicaId: payload.clinicaId,
      rol: payload.rol,
      doctorId: payload.doctorId ?? null,
    };
  }
}
