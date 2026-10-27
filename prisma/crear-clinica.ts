import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Rol } from "../apps/api/src/generated/prisma/client";

// Creates a NEW, EMPTY clinic with a single ADMIN user. For a real client: no demo data, no demo users.
// Usage (values come from the environment; the password is never printed):
//   CLINICA_NOMBRE="MEK" ADMIN_EMAIL="duenio@mek.com" ADMIN_PASSWORD="<min 10 chars>" pnpm db:crear-clinica
const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const nombre = (process.env.CLINICA_NOMBRE ?? "").trim();
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (nombre.length < 2) throw new Error("CLINICA_NOMBRE es obligatoria (mínimo 2 caracteres).");
  if (!EMAIL_RE.test(email)) throw new Error("ADMIN_EMAIL es obligatoria y debe ser un email válido.");
  if (password.length < MIN_PASSWORD) throw new Error(`ADMIN_PASSWORD es obligatoria y debe tener al menos ${MIN_PASSWORD} caracteres.`);
  if (/@demo\.test$/i.test(email)) throw new Error("Ese email es de la demo; usá el email real del cliente.");

  // Refuse to mix a real client with demo data or to create duplicates.
  if ((await prisma.clinica.count({ where: { nombre: "Clínica Demo" } })) > 0) {
    throw new Error("Esta base ya tiene la «Clínica Demo». Para un cliente real usá una base nueva y vacía.");
  }
  if (await prisma.clinica.findFirst({ where: { nombre } })) throw new Error(`Ya existe una clínica llamada «${nombre}».`);
  if (await prisma.usuario.findUnique({ where: { email } })) throw new Error("Ya existe un usuario con ese email.");

  const passwordHash = await argon2.hash(password);
  const clinica = await prisma.clinica.create({
    data: { nombre, usuarios: { create: { email, passwordHash, rol: Rol.ADMIN } } },
  });

  console.log(`Listo: clínica «${nombre}» creada (id ${clinica.id}) con el administrador ${email}.`);
  console.log("Siguiente paso: entrar al panel y cargar especialidades, doctores y horarios en «Gestión».");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Error inesperado.");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
