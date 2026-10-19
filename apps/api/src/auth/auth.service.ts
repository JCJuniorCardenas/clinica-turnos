import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";

// Hash used for unknown emails so they cost the same time as a wrong password.
const DUMMY_HASH = argon2.hash("dummy-password-for-timing");

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.usuario.findUnique({ where: { email: email.toLowerCase() } });
    const hash = user?.passwordHash ?? (await DUMMY_HASH);
    const ok = await argon2.verify(hash, password).catch(() => false);
    if (!user || !ok) throw new UnauthorizedException("Credenciales inválidas");

    const token = await this.jwt.signAsync({
      sub: user.id,
      clinicaId: user.clinicaId,
      rol: user.rol,
      doctorId: user.doctorId ?? undefined,
    });
    return { token, user: { id: user.id, email: user.email, rol: user.rol } };
  }

  async me(userId: string, clinicaId: string) {
    const user = await this.prisma.usuario.findFirst({
      where: { id: userId, clinicaId },
      include: { clinica: { select: { nombre: true } } },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      rol: user.rol,
      doctorId: user.doctorId,
      clinica: { id: user.clinicaId, nombre: user.clinica.nombre },
    };
  }
}
