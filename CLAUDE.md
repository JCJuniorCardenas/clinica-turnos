# Clínica Turnos — Bot de WhatsApp con IA + agenda para clínicas

## 1. Qué es este proyecto

Software para clínicas que reemplaza la agenda en papel. Tiene dos partes:

1. **Bot de WhatsApp con IA** que agenda, cancela y reprograma turnos hablando en lenguaje natural, respetando los doctores y especialidades disponibles.
2. **Panel web** donde doctores y recepcionistas ven y gestionan la agenda, y exportan los turnos a Excel.

**Primer cliente (demo):** Clínica CIMA, Paso de los Libres, Corrientes, Argentina.
Hoy agendan en papel. Los datos reales de la clínica (doctores, especialidades, horarios, duración de turnos) están **pendientes de relevar**. No inventar nada sobre la clínica real.

**Objetivo comercial:** que sea un producto vendible a otras clínicas, no un desarrollo a medida descartable. Por eso es multi-clínica desde el día 1.

## 2. Reglas para Claude Code (leer antes de tocar código)

- Responder y documentar en **español argentino**. Comentarios de código en inglés.
- Nombres del dominio en español (`Clinica`, `Doctor`, `Especialidad`, `Turno`, `Paciente`). El resto del código técnico en inglés.
- **La IA nunca escribe en la base de datos ni inventa horarios.** Solo llama herramientas (tools) que el backend valida y ejecuta (ver sección 5).
- **Todo dato pertenece a una clínica.** Toda tabla de negocio lleva `clinicaId` y toda consulta lo filtra.
- **Fechas en UTC en la base.** Se muestran en `America/Argentina/Buenos_Aires`.
- Nunca commitear secretos. Todo va en variables de entorno (`.env.example` documenta cuáles).
- No agregar dependencias pagas ni servicios con costo sin avisar y justificar.
- No usar datos reales de pacientes en desarrollo ni en la demo. Solo el seed ficticio.
- Antes de una tarea grande: proponer el plan y esperar confirmación. Después de cada fase: correr tests y lint.
- Si algo del alcance no está claro, preguntar. No asumir.

## 3. Alcance

### Entra en la demo (costo cero extra)
- Bot de WhatsApp: consultar especialidades y doctores, sacar, cancelar y reprogramar turnos.
- Derivación a una persona de recepción cuando el bot no puede resolver algo.
- Panel web: login por rol, agenda diaria por doctor (estilo grilla de papel), alta y edición de doctores, especialidades y horarios.
- Exportación de turnos a Excel (`.xlsx`) con filtros por fecha y doctor.
- Seed con datos ficticios para mostrar la demo.

### Queda fuera (versión paga)
Recordatorios automáticos, pagos, historia clínica, obras sociales y coberturas, múltiples sedes, reportes avanzados, API oficial de WhatsApp Business.

## 4. Stack

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm workspaces |
| Backend | NestJS + TypeScript |
| ORM | Prisma |
| Base de datos | PostgreSQL en Railway |
| Panel web | Next.js + Tailwind |
| WhatsApp (demo) | Baileys, detrás de la interfaz `WhatsAppProvider` |
| IA | Proveedor con capa gratuita (Gemini o Groq), detrás de `LlmProvider` |
| Excel | `exceljs` |
| Validación | `class-validator` + `helmet` + rate limiting |
| Auth | JWT + roles, hash con argon2 |
| Hosting | Railway (API, panel y base) |

## 5. Arquitectura

**Monolito modular** en NestJS. Módulos: `auth`, `clinicas`, `doctores`, `especialidades`, `pacientes`, `turnos`, `disponibilidad`, `bot`, `whatsapp`, `exportacion`, `auditoria`.

**Interfaces para poder cambiar piezas sin reescribir:**

```ts
interface WhatsAppProvider {
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  sendText(to: string, text: string): Promise<void>;
}

interface LlmProvider {
  chat(input: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResponse>;
}
```

Implementaciones iniciales: `BaileysProvider` (demo) y un `LlmProvider` con el modelo elegido. A futuro: `MetaCloudProvider` para producción.

**Herramientas que puede llamar el modelo** (el backend valida cada una):

```
listar_especialidades()
listar_doctores(especialidadId)
buscar_disponibilidad(doctorId, desde, hasta)
crear_turno(doctorId, fechaHora, paciente)
cancelar_turno(turnoId)
reprogramar_turno(turnoId, nuevaFechaHora)
derivar_a_recepcion(motivo)
```

El modelo interpreta la intención y extrae datos. El backend calcula disponibilidad y guarda. Nunca al revés.

## 6. Modelo de datos (borrador inicial)

```prisma
model Clinica {
  id        String   @id @default(cuid())
  nombre    String
  timezone  String   @default("America/Argentina/Buenos_Aires")
  creadoEn  DateTime @default(now())
}

model Especialidad {
  id        String @id @default(cuid())
  clinicaId String
  nombre    String
  @@unique([clinicaId, nombre])
}

model Doctor {
  id               String  @id @default(cuid())
  clinicaId        String
  nombre           String
  especialidadId   String
  duracionTurnoMin Int     @default(60)
  activo           Boolean @default(true)
}

model HorarioDoctor {
  id         String @id @default(cuid())
  clinicaId  String
  doctorId   String
  diaSemana  Int    // 0 = domingo ... 6 = sábado
  horaInicio String // "09:00"
  horaFin    String // "13:00"
}

model Paciente {
  id        String  @id @default(cuid())
  clinicaId String
  nombre    String
  telefono  String   // un mismo teléfono puede tener varios pacientes (hijos, familiares)
  dni       String?
  @@unique([clinicaId, dni])
  @@index([clinicaId, telefono])
}

model Turno {
  id         String      @id @default(cuid())
  clinicaId  String
  doctorId   String
  pacienteId String
  inicio     DateTime    // UTC
  fin        DateTime    // UTC
  estado     EstadoTurno @default(CONFIRMADO)
  origen     String      // "BOT" | "PANEL"
  creadoEn   DateTime    @default(now())
}

enum EstadoTurno { PENDIENTE CONFIRMADO CANCELADO ATENDIDO AUSENTE }

model Usuario {
  id           String @id @default(cuid())
  clinicaId    String
  email        String @unique
  passwordHash String
  rol          Rol
  doctorId     String? // si el rol es DOCTOR
}

enum Rol { ADMIN DOCTOR RECEPCION }

model Conversacion {
  id        String   @id @default(cuid())
  clinicaId String
  telefono  String
  estado    Json     // contexto del bot
  updatedAt DateTime @updatedAt
  @@unique([clinicaId, telefono])
}

model Auditoria {
  id        String   @id @default(cuid())
  clinicaId String
  actor     String   // userId o "BOT"
  accion    String
  entidad   String
  entidadId String
  detalle   Json?
  creadoEn  DateTime @default(now())
}
```

**Restricción anti doble reserva** (migración SQL manual, Prisma no la genera):

```sql
CREATE UNIQUE INDEX turno_doctor_inicio_activo
ON "Turno" ("doctorId", "inicio")
WHERE "estado" <> 'CANCELADO';
```

Es un índice único **parcial**: impide dos turnos activos del mismo doctor a la misma hora, pero permite volver a reservar un horario cuyo turno fue cancelado.

## 7. Reglas de negocio

- Duración por defecto: 60 minutos, configurable por doctor.
- Los horarios ofrecidos salen de `HorarioDoctor` menos los turnos activos existentes.
- Si dos pacientes piden el mismo horario a la vez, uno gana y el otro recibe alternativas (lo resuelve el índice único, no el código).
- Un turno no puede crearse en el pasado.
- Cancelar y reprogramar quedan registrados en `Auditoria`.
- El bot **no da consejo médico ni diagnósticos**. Si el paciente describe síntomas graves o una urgencia, responde que llame a emergencias o a la clínica y deriva a recepción.
- El bot pregunta para quién es el turno. Pide nombre y DNI solo si esa persona no está registrada. Un teléfono puede tener varios pacientes asociados.
- El flujo conversacional completo está en `docs/04-flujo-bot.md`. Seguirlo.

## 8. Seguridad (mínimo no negociable)

- JWT con roles. Un doctor ve únicamente su agenda; recepción ve todas; admin gestiona la clínica.
- Validar todo input. Rate limiting en la API y en el bot (por teléfono).
- Aislamiento por `clinicaId` en cada consulta (probar con tests).
- Secretos solo en variables de entorno de Railway.
- Backups automáticos de la base antes de cargar datos reales.
- Datos de salud: en producción aplica la Ley 25.326 de protección de datos personales. Antes de usar datos reales, revisar consentimiento del paciente, proveedor de IA con términos de privacidad adecuados y registro de la base ante la autoridad correspondiente.
- Baileys es no oficial: **solo para demo**, con un chip secundario. Para producción usar la API oficial de Meta.

## 9. Estructura del repositorio

```
clinica-turnos/
├── CLAUDE.md
├── docs/
│   ├── 01-alcance.md             # a generar en Fase 1 a partir de este archivo
│   ├── 02-arquitectura.md        # a generar en Fase 1 a partir de este archivo
│   ├── 03-modelo-datos.md        # a generar en Fase 1 a partir de este archivo
│   ├── 04-flujo-bot.md           # ya escrito: diseño de la conversación
│   ├── 05-roadmap.md             # a generar en Fase 1 a partir de este archivo
│   └── 06-modulos-opcionales.md  # ya escrito, uso interno: no exponer precios en el panel ni en el bot
├── apps/
│   ├── api/        # NestJS
│   └── web/        # Next.js
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts     # datos ficticios
├── .env.example
└── pnpm-workspace.yaml
```

## 10. Fases y criterios de aceptación

**Fase 1 — Fundaciones**
Monorepo, Prisma, migraciones, seed ficticio (5 a 10 doctores), auth con roles.
*Listo cuando:* `pnpm dev` levanta API y panel, y se puede loguear con cada rol.

**Fase 2 — Núcleo de turnos**
CRUD de doctores, especialidades y horarios; cálculo de disponibilidad; creación, cancelación y reprogramación de turnos; índice único parcial.
*Listo cuando:* tests de concurrencia demuestran que no hay doble reserva y tests de aislamiento demuestran que una clínica no ve datos de otra.

**Fase 3 — Panel web**
Agenda diaria por doctor, vista de recepción, exportación a Excel.
*Listo cuando:* recepción puede reemplazar el papel durante un día de prueba simulado.

**Fase 4 — Bot**
`WhatsAppProvider`, `LlmProvider`, tools, estado de conversación, derivación a recepción.
*Listo cuando:* desde un celular se puede sacar, cancelar y reprogramar un turno, y aparece en el panel.

**Fase 5 — Pulido de demo**
Guion de demostración, manejo de errores del bot, deploy final en Railway, volumen persistente para la sesión de Baileys.
*Listo cuando:* la demo completa corre de punta a punta sin intervención manual.

## 11. Pendientes a definir con el cliente

- Cantidad real de doctores y especialidades.
- Duración real de los turnos (hoy se asume 60 min).
- Cómo es hoy la agenda en papel (para imitar la grilla).
- Número de WhatsApp que se usaría en producción.
- Si atienden por obras sociales y cómo lo manejan.
- Formato exacto de la planilla de Excel que necesitan.

## 12. Comandos

```bash
pnpm install
cp .env.example .env        # completar JWT_SECRET (ver comentario en el archivo)
pnpm db:up                  # PostgreSQL en Docker, puerto 5435
pnpm db:migrate             # migraciones (incluye el índice único parcial)
pnpm db:seed                # datos ficticios; usuarios admin@/recepcion@/doctor@demo.test
pnpm dev                    # API en :3001 y panel en :3000
pnpm test                   # tests (requieren la base con el seed)
pnpm lint
```

Contraseña de los usuarios demo: variable `SEED_PASSWORD` del `.env`.
