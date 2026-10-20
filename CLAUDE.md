# Clínica Turnos — Bot de WhatsApp con IA + agenda para clínicas

## 1. Qué es este proyecto

Software para clínicas que reemplaza la agenda en papel. Tiene dos partes:

1. **Bot de WhatsApp con IA** que agenda, cancela y reprograma turnos hablando en lenguaje natural, respetando los doctores y especialidades disponibles.
2. **Panel web** donde doctores y recepcionistas ven y gestionan la agenda en vivo (se actualiza solo cuando entra, se cancela o se reprograma un turno), la imprimen y la exportan.

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
- Agenda en vivo en el panel: actualización automática por Server-Sent Events y aviso visible/sonoro de turno nuevo (el doctor solo ve avisos de sus turnos), con consulta periódica como respaldo.
- Agenda imprimible del día por doctor (imita la hoja de papel; se imprime o guarda como PDF desde el navegador, sin librerías).
- Exportación de turnos a Excel (`.xlsx`) con filtros por fecha y doctor, como opción secundaria (se abre gratis en Google Sheets o LibreOffice).
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
| WhatsApp | API oficial de Meta (Cloud API) detrás de la interfaz `WhatsAppProvider`; Baileys queda como alternativa no oficial para pruebas |
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

Implementaciones: `MetaCloudProvider` (API oficial, recomendada para la demo y producción), `BaileysProvider` (no oficial, solo pruebas) y `ConsoleWhatsApp` (terminal), más un `LlmProvider` con el modelo elegido. Guía de Meta en `docs/10-whatsapp-meta.md`.

**Herramientas que puede llamar el modelo** (el backend valida cada una):

```
listar_especialidades()
listar_doctores(especialidadId)
buscar_disponibilidad(doctorId, desde, hasta, franja?)
identificar_paciente(dni)
crear_turno(doctorId, fechaHora, paciente)
listar_turnos_paciente()
cancelar_turno(turnoId)
reprogramar_turno(turnoId, nuevaFechaHora)
derivar_a_recepcion(motivo, urgencia?)
```

Las fechas que maneja el bot son hora local de la clínica (`YYYY-MM-DDTHH:mm`). Crear, cancelar y reprogramar exigen una **vuelta de confirmación**: la primera llamada solo anuncia la acción y la ejecución ocurre cuando llega la misma llamada después de un nuevo mensaje del paciente. Todo acceso a pacientes y turnos se filtra por el teléfono del chat.

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
- Baileys es no oficial: **solo para pruebas**, con un chip secundario (puede provocar el bloqueo del número). Para la demo y producción usar la API oficial de Meta.

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
│   ├── 06-modulos-opcionales.md  # ya escrito, uso interno: no exponer precios en el panel ni en el bot
│   ├── 07-glosario.md            # términos técnicos explicados simple (se amplía en cada fase)
│   ├── 08-guion-demo.md          # guion para presentar la demo en la clínica (uso interno)
│   ├── 09-deploy-railway.md      # guía paso a paso para publicar la demo en Railway
│   └── 10-whatsapp-meta.md       # conectar el asistente a la API oficial de WhatsApp (Meta)
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
Agenda diaria por doctor en vivo (SSE + aviso de turno nuevo), vista de recepción, agenda imprimible y, en último lugar, exportación a Excel. Crear, cancelar y reprogramar turnos emiten un evento interno (desde la Fase 2) que alimenta el aviso en vivo.
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
- Qué usan para leer planillas (PC, celular, Google, Excel) y si les alcanza con la agenda imprimible; formato exacto de la planilla si piden Excel.
- Si quieren que el bot avise por WhatsApp a recepción o al doctor cuando entra un turno (queda fuera de la demo; se acerca a las notificaciones de la versión paga).

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
pnpm --filter api bot:console   # chatear con el asistente desde la terminal (necesita GEMINI_API_KEY)
pnpm demo:smoke             # prueba de punta a punta de toda la demo (local o desplegada)
```

Contraseña de los usuarios demo: variable `SEED_PASSWORD` del `.env`.
