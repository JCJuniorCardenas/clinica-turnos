# Puesta en marcha de una clínica nueva (por ejemplo, MEK)

Guía para instalar el sistema para un cliente real, con **su propia base, su propio Railway y su propio número de WhatsApp**. Alcance: **solo turnos y el asistente de WhatsApp**. No se cargan obras sociales ni datos de salud.

> No uses la instalación de la demo para un cliente: tiene datos ficticios y un botón que borra todo.

## Antes de empezar: lo que necesitás del cliente
- Nombre de la clínica.
- Email y teléfono de la persona que va a administrar (será el usuario administrador).
- Lista de especialidades, doctores, días y horarios de atención, y **duración real de cada turno**.
- Un **número de WhatsApp dedicado** al asistente (no puede estar activo en la app común de WhatsApp) y quién será el titular de la cuenta de Meta. **Meta le factura a la clínica**, no a vos.
- Acuerdo por escrito sobre privacidad de datos personales (Ley 25.326): ver el apartado final.

## Paso 1 · Proyecto nuevo en Railway
1. **New Project → Deploy PostgreSQL** (una base **nueva y vacía**, solo para esta clínica).
2. Agregá los servicios `api` y `web` desde el repositorio, igual que en `docs/09-deploy-railway.md` (pasos 1 a 4), con un volumen en `/data` para la `api`.
3. Variables de la `api`, además de las de la guía de la demo:

```
DEMO_MODE=false
SKIP_SEED=true
BOT_ENABLED=true
WHATSAPP_PROVIDER=meta
BOT_CLINICA_ID=
```

   - `DEMO_MODE=false` **es obligatorio**: apaga el simulador y el botón «Reiniciar datos de la demo», que borra todo.
   - `SKIP_SEED=true` **es obligatorio en el primer despliegue**: sin esto, al arrancar la base vacía se cargaría la «Clínica Demo» con usuarios ficticios.
   - `SEED_PASSWORD` no hace falta: no se usa.
   - `BOT_CLINICA_ID` se deja vacío: en una base con una sola clínica, el asistente atiende a esa.
4. Esperá a que `api` y `web` pasen a «Active».

## Paso 2 · Crear la clínica y su administrador
Desde tu computadora, en la carpeta del proyecto, con la dirección **pública** de la base de este proyecto (Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`). En PowerShell:

```powershell
$env:DATABASE_URL = "<DATABASE_PUBLIC_URL de la base de la clínica>"
$env:CLINICA_NOMBRE = "MEK"
$env:ADMIN_EMAIL = "<email real del dueño o administrador>"
$env:ADMIN_PASSWORD = "<contraseña fuerte, mínimo 10 caracteres>"
pnpm db:crear-clinica
Remove-Item Env:DATABASE_URL, Env:ADMIN_PASSWORD
```

- El script crea la clínica **vacía** y un único usuario administrador. No imprime la contraseña.
- Se niega a correr si la base tiene la «Clínica Demo» o si el email es de la demo.
- Entregá el email y la contraseña por un canal privado, y pedile al cliente que **no la comparta**.

## Paso 3 · Cargar los datos de la clínica
Entrando al panel con el administrador, en **Gestión**:
1. Cargá las **especialidades**.
2. Cargá los **doctores** con su especialidad y la **duración de cada turno**.
3. Cargá los **horarios** de cada doctor (días y franjas).

Sin horarios, el asistente no ofrece turnos.

## Paso 4 · Conectar el WhatsApp de la clínica
Seguí `docs/10-whatsapp-meta.md` con el número de la clínica y su cuenta de Meta: variables `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` (permanente), `META_APP_SECRET` y el webhook hacia `https://<panel>/api/whatsapp/webhook`. Usá `BOT_ALLOWED_PHONES` solo mientras prueban.

## Paso 5 · Prueba antes de entregar
1. Entrá como administrador y mirá la agenda de un día en que atienda algún doctor.
2. Desde un celular, escribile al número de la clínica: pedí un turno, mirá que aparezca en la agenda, cancelalo y reprogramalo.
3. Probá «quiero hablar con una persona» y confirmá que aparece en **Chats derivados**.
4. Borrá los turnos de prueba (cancelándolos desde la agenda).

## Cuando haya más personas usando el sistema
Hoy el administrador es un solo usuario compartido. Cuando la clínica sume recepcionistas o doctores con acceso propio, hay que crear usuarios separados (roles Recepción y Doctor). Todavía no existe una pantalla para eso: se hace por base de datos.

## Privacidad (Ley 25.326)
Aunque no se carguen datos de salud, el sistema guarda **nombre, teléfono y DNI** de los pacientes, y saber con qué especialista tiene turno puede insinuar algo de su salud. Antes de usarlo con pacientes reales:
- Que el primer mensaje del asistente avise para qué se usan los datos.
- Dejarlo escrito en el contrato (quién es responsable de los datos y qué pasa si se termina el servicio).
- Registrar la base de datos ante la autoridad correspondiente.
- Confirmar los términos de privacidad del proveedor de IA y activar los backups de la base.

## Lista rápida
- [ ] Base nueva y vacía, solo de esta clínica
- [ ] `DEMO_MODE=false` y `SKIP_SEED=true`
- [ ] Clínica y administrador creados con `pnpm db:crear-clinica`
- [ ] Especialidades, doctores y horarios cargados
- [ ] Número de WhatsApp de la clínica conectado, token permanente
- [ ] Prueba de punta a punta hecha y turnos de prueba cancelados
- [ ] Contraseña entregada por un canal privado
- [ ] Acuerdo de privacidad firmado
