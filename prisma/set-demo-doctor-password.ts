import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client";

// Changes ONLY the password of doctor@demo.test in an existing database.
// Usage: DEMO_DOCTOR_PASSWORD=<new password> pnpm db:demo-doctor
// The password is read from the environment and is never printed.
const EMAIL = "doctor@demo.test";
const MIN_LENGTH = 10;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const password = process.env.DEMO_DOCTOR_PASSWORD ?? "";
  if (password.length < MIN_LENGTH) {
    throw new Error(`DEMO_DOCTOR_PASSWORD es obligatoria y debe tener al menos ${MIN_LENGTH} caracteres.`);
  }
  const usuario = await prisma.usuario.findUnique({ where: { email: EMAIL }, select: { id: true, rol: true } });
  if (!usuario) throw new Error(`No existe el usuario ${EMAIL} en esta base.`);
  if (usuario.rol !== "DOCTOR") throw new Error(`El usuario ${EMAIL} no tiene rol DOCTOR; no se modifica.`);

  await prisma.usuario.update({ where: { id: usuario.id }, data: { passwordHash: await argon2.hash(password) } });
  console.log(`Listo: se actualizó la contraseña de ${EMAIL}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Error inesperado.");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
