# Clínica Turnos

Agenda para clínicas con **asistente de WhatsApp con IA** y un **panel web en vivo**. Reemplaza la hoja de papel: los pacientes sacan, cambian y cancelan turnos hablando normal por WhatsApp, y recepción y doctores ven cada cambio en la agenda en el mismo instante.

> Producto multi-clínica desde el diseño. La demo corre con datos 100 % ficticios.

<!-- Capturas: guardarlas en docs/assets/ y descomentar.
![Agenda en vivo](docs/assets/agenda.png)
![Simulador de WhatsApp](docs/assets/simulador.png)
-->

## Qué hace

- **Asistente de WhatsApp**: consulta especialidades y doctores, agenda, cancela y reprograma turnos en lenguaje natural. Si no puede resolver algo (o detecta una urgencia), deriva a una persona de recepción.
- **Agenda en vivo**: grilla diaria por doctor que se actualiza sola cuando entra, se cancela o se reprograma un turno (Server-Sent Events). El turno nuevo brilla y suena un aviso; el doctor solo ve los suyos.
- **Panel de recepción**: crear turnos desde la grilla, marcar atendido o ausente, reprogramar, chats derivados, gestión de doctores, especialidades y horarios.
- **Imprimible y exportable**: la agenda del día se imprime con formato de hoja de papel; los turnos se exportan a Excel (`.xlsx`).
- **Simulador de WhatsApp** dentro del panel para presentar o probar sin celular.
- **Interfaz moderna**: modo claro y oscuro automático, adaptable a celular, microanimaciones y estados de carga (rediseño visual).

## Decisiones de diseño que importan

- **La IA nunca escribe en la base de datos ni inventa horarios.** Solo llama herramientas (`buscar_disponibilidad`, `crear_turno`, `cancelar_turno`…) que el backend valida y ejecuta. El modelo interpreta la intención; el sistema calcula y guarda.
- **Confirmación ejecutada por el sistema.** Crear, cancelar y reprogramar exigen una vuelta de confirmación; cuando el paciente dice «sí», es el propio backend quien ejecuta la acción. Hay guardas contra respuestas de la IA que afirmen un éxito que no ocurrió.
- **Cero doble reserva garantizada por la base**, no por el código: índice único parcial en PostgreSQL (`doctorId` + `inicio` mientras el turno no esté cancelado). Probado con tests de concurrencia.
- **Aislamiento por clínica**: toda tabla de negocio lleva `clinicaId` y toda consulta lo filtra (con tests de aislamiento).
- **Proveedores intercambiables** detrás de interfaces: WhatsApp (`MetaCloudProvider` oficial, `BaileysProvider` para pruebas, consola) e IA (`GroqProvider` principal + `GeminiProvider` de respaldo encadenados con `FallbackLlm`).
- **Fechas en UTC** en la base y hora de Argentina (`America/Argentina/Buenos_Aires`) en pantalla.

## Arquitectura

```
WhatsApp (API oficial de Meta) ──webhook firmado──▶ API NestJS ──▶ PostgreSQL
                                                     │   ▲
                              herramientas validadas │   │ eventos (SSE)
                                                     ▼   │
                                  IA: Groq ─fallback─▶ Gemini        Panel Next.js
```

Monolito modular en NestJS (`auth`, `clinicas`, `doctores`, `especialidades`, `pacientes`, `turnos`, `disponibilidad`, `bot`, `whatsapp`, `exportacion`, `auditoria`) y panel en Next.js que reenvía `/api/*` a la API para que la cookie de sesión sea del mismo sitio.

## Stack

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm workspaces |
| API | NestJS + TypeScript |
| Base de datos | PostgreSQL + Prisma |
| Panel | Next.js + React + Tailwind CSS |
| IA | Groq (principal) y Gemini (respaldo) |
| WhatsApp | API oficial de Meta (Cloud API) |
| Auth y seguridad | JWT en cookie httpOnly, roles, argon2, helmet, rate limiting, validación de entradas |
| Tests | vitest + supertest |
| Hosting | Railway |

## Probarlo en local

Requiere Node, pnpm y Docker.

```bash
pnpm install
cp .env.example .env        # completar JWT_SECRET (ver comentario en el archivo)
pnpm db:up                  # PostgreSQL en Docker
pnpm db:migrate             # migraciones (incluye el índice único parcial)
pnpm db:seed                # datos ficticios; usuarios admin@/recepcion@/doctor@demo.test
pnpm dev                    # API en :3001 y panel en :3000
```

Otros comandos: `pnpm test`, `pnpm lint`, `pnpm demo:smoke` (recorre toda la demo de punta a punta) y `pnpm --filter api bot:console` (chatear con el asistente desde la terminal).

## Documentación

Está en [`docs/`](docs): flujo de la conversación del bot, guía de despliegue en Railway, conexión con la API oficial de WhatsApp y un glosario de términos técnicos explicados simple.

## Privacidad

La demo usa solamente datos ficticios. Antes de operar con datos reales de pacientes hay que cumplir la Ley 25.326 de protección de datos personales (consentimiento, proveedor de IA con términos adecuados y registro de la base).
