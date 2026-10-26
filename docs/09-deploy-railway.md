# Despliegue en Railway (demo)

Guía para publicar la demo en Railway. Hay **tres piezas** y **un volumen**:

| Pieza | Qué es | Cómo se despliega |
|---|---|---|
| **Postgres** | La base de datos | Plantilla de Railway |
| **api** | El «cerebro» (NestJS) + conexión de WhatsApp | `apps/api/Dockerfile` |
| **web** | El panel (Next.js). Reenvía `/api` a la API | `apps/web/Dockerfile` |
| **Volumen** | Carpeta persistente donde queda la sesión de WhatsApp | Montado en la `api` en `/data` |

> Costo: usa tu plan Hobby de Railway (ya pago). No se agrega ningún servicio nuevo con costo: Gemini usa la capa gratuita.
> Nota: los pasos de abajo se prepararon y probaron en local (panel compilado + API + prueba de punta a punta). El despliegue en sí lo hacés vos desde tu cuenta de Railway.

---

## Paso 1 · Proyecto y base de datos

1. En Railway: **New Project → Deploy PostgreSQL**. Anotá que el servicio se llama `Postgres`.
2. **New → GitHub Repo →** `JCJuniorCardenas/clinica-turnos`. Se crea un servicio. Vas a crear **dos** (uno por pieza); renombralos `api` y `web`.

## Paso 2 · Servicio `api`

En el servicio `api`:

1. **Settings → Config-as-code → Railway Config File:** `/apps/api/railway.json`
   *(Root Directory se deja vacío: el Dockerfile necesita todo el repositorio).*
2. **Settings → Replicas:** `1`. **Siempre una sola**: WhatsApp (Baileys) no admite dos conexiones a la vez.
3. **Volume:** clic derecho sobre el servicio → **Attach Volume** → *Mount path* `/data`.
4. **Variables** (pestaña Variables → Raw Editor):

```
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<generá 48+ caracteres al azar, ver más abajo>
JWT_EXPIRES_IN=8h
COOKIE_SECURE=true
WEB_ORIGIN=https://<la-direccion-publica-del-panel>
SEED_PASSWORD=<contraseña FUERTE para los 3 usuarios de la demo>
SEED_DOCTOR_PASSWORD=<opcional: contraseña distinta solo para doctor@demo.test, mínimo 10 caracteres>
DEMO_MODE=true
BOT_ENABLED=true
WHATSAPP_PROVIDER=meta
META_PHONE_NUMBER_ID=<ID del número de Meta>
META_ACCESS_TOKEN=<token de Meta>
META_APP_SECRET=<clave secreta de la app de Meta>
META_VERIFY_TOKEN=<frase larga que inventás>
GROQ_API_KEY=<tu clave de Groq (console.groq.com)>
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_API_KEY=<tu clave de Google AI Studio (respaldo)>
GEMINI_MODEL=gemini-3-flash-preview,gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.1-flash-lite
GEMINI_TIMEOUT_MS=12000
```

Para generar `JWT_SECRET` en tu computadora:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `WEB_ORIGIN` se completa cuando tengas la dirección del panel (Paso 3). Después de ponerla, el servicio se redespliega solo.
> **La API no necesita dirección pública**: el panel le habla por la red privada de Railway.

Al arrancar, la API: aplica las migraciones, **carga los datos de demo solo si la base está vacía** (nunca borra una base con datos) y se inicia.

## Paso 3 · Servicio `web`

En el servicio `web`:

1. **Settings → Config-as-code → Railway Config File:** `/apps/web/railway.json`
2. **Variables:**

```
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3001
```

3. **Settings → Networking → Generate Domain.** Esa es la dirección pública del panel (la que se abre en el navegador).
4. Volvé a `api` y poné esa dirección en `WEB_ORIGIN`.

## Paso 4 · Primer ingreso y conexión de WhatsApp

1. Abrí la dirección pública del panel e iniciá sesión con `admin@demo.test` y la `SEED_PASSWORD` que elegiste.
2. **Recomendado: API oficial de Meta.** Seguí [docs/10-whatsapp-meta.md](10-whatsapp-meta.md): en Railway poné `WHATSAPP_PROVIDER=meta` y las variables `META_*`, y en Meta registrá el webhook `https://<dirección del panel>/api/whatsapp/webhook`. No hay QR. El menú **WhatsApp** del panel muestra el estado y esa dirección.
3. *Alternativa de prueba (Baileys, no oficial):* con `WHATSAPP_PROVIDER=baileys` el menú **WhatsApp** muestra un QR que se escanea con un chip secundario; la sesión queda en el volumen. Puede provocar el bloqueo del número.
4. Mandá un mensaje al número desde otro celular: el asistente responde.

## Paso 5 · Verificar que todo funciona

Desde tu computadora, con el repositorio clonado:

```bash
SMOKE_BASE_URL=https://<direccion-del-panel> SMOKE_PASSWORD=<tu SEED_PASSWORD> pnpm demo:smoke
```

Recorre la demo completa (turnos, conflicto, reprogramar, agenda en vivo, Excel, urgencia, asistente con IA, derivación) y termina dejando los datos limpios. Tiene que terminar en **«✔ Todo OK»**.
Para saltear la parte con IA: agregá `SMOKE_BOT=false`.

## Mantenimiento

- **Actualizar:** cada `git push` a `main` redespliega solo. La sesión de WhatsApp se conserva.
- **Dejar la demo limpia:** menú *Simulador WhatsApp → Reiniciar datos de la demo* (como administrador).
- **Cambiar una clave o contraseña:** editá la variable en Railway; el servicio se reinicia.
- **Ver errores:** pestaña *Deployments → View Logs* de cada servicio.

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| El panel dice «No se pudo conectar con el servidor» | `API_INTERNAL_URL` mal escrita, o la `api` no terminó de arrancar. Mirar los logs de `api`. |
| El login anda pero te saca enseguida | `COOKIE_SECURE=true` sin usar `https`, o el panel se abre por otra dirección distinta. Usá siempre la dirección pública del panel. |
| «WhatsApp: Desconectado» | Sesión cerrada desde el celular: en `/data/baileys-auth` hay que borrar la sesión y volver a vincular. |
| El asistente responde «estoy con muchas consultas» | Límite diario del plan gratuito de la IA en todos los modelos listados. Esperar o agregar otro modelo a `GEMINI_MODEL`. |
| La API reinicia en bucle | Falta `JWT_SECRET` (mínimo 32 caracteres) o `DATABASE_URL`. |

## Seguridad (demo)

- Usá **`SEED_PASSWORD` fuerte**: la dirección del panel es pública y el asistente está conectado a un chip real.
- **Cuenta pública para el portfolio:** compartí solamente `doctor@demo.test` con su **propia contraseña**, nunca la de admin ni la de recepción. El rol Doctor es de solo lectura: no puede usar el simulador (no gasta la cuota de la IA), no puede reiniciar los datos y no puede crear, cancelar ni reprogramar turnos; solo ve su propia agenda. Para ponerle esa contraseña a una base que ya existe, ver «Contraseña propia del doctor demo» más abajo.
- `DEMO_MODE=true` habilita el simulador y el botón de reinicio: **solo en la demo**, nunca con datos reales.
- **Nada de datos reales de pacientes.** Antes de eso: consentimiento, privacidad del proveedor de IA, registro de la base (Ley 25.326), backups automáticos y la API oficial de WhatsApp Business.
- Las claves viven **solo** en las variables de Railway. Nunca en el repositorio ni en el chat.

## Contraseña propia del doctor demo

Sirve para publicar la demo en el portfolio sin exponer las cuentas de administrador y recepción. Se hace **una sola vez**, sobre la base de Railway que ya tiene datos (el seed no se vuelve a correr porque no pisa una base con datos).

1. Elegí una contraseña de al menos 10 caracteres, distinta de `SEED_PASSWORD`. No la escribas en el repositorio ni en el chat.
2. En tu computadora, con la CLI de Railway iniciada y vinculada al proyecto (`railway login` y `railway link`), corré en PowerShell:

   ```powershell
   $env:DEMO_DOCTOR_PASSWORD = "<la contraseña elegida>"
   railway run --service api pnpm db:demo-doctor
   Remove-Item Env:DEMO_DOCTOR_PASSWORD
   ```

   Si `railway run` no alcanza la base (usa la dirección interna), usá la `DATABASE_URL` pública de Postgres: copiala desde Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`, definila como `$env:DATABASE_URL` en esa misma ventana y corré `pnpm db:demo-doctor` desde la carpeta del proyecto.
3. Si todo sale bien, el script muestra «Listo: se actualizó la contraseña de doctor@demo.test.» y nunca imprime la clave.
4. Probá entrar al panel online con `doctor@demo.test` y la contraseña nueva; debe aparecer el cartel «Demo: acceso de solo lectura de un doctor».
5. Opcional: agregá `SEED_DOCTOR_PASSWORD` a las variables de Railway para que, si algún día se recrea la base, el doctor ya nazca con su propia clave.
