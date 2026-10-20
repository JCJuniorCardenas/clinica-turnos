# WhatsApp con la API oficial de Meta

Guía para conectar el asistente a la **WhatsApp Cloud API** de Meta. Es el método recomendado para la demo y el único para producción: **no hay QR, no se vincula ningún celular y no hay riesgo de que bloqueen el número.** (Baileys queda como alternativa solo para pruebas.)

## Cómo funciona

1. Una persona escribe al número del asistente.
2. **Meta llama a una dirección del sistema** (el *webhook*) con el mensaje. Esa llamada viene **firmada** con la clave secreta de tu app: el sistema rechaza todo lo que no tenga una firma válida.
3. El asistente procesa el mensaje y **responde por la Graph API** de Meta usando un token.

Dirección del webhook (la muestra también el menú **WhatsApp** del panel):

```
https://<dirección-del-panel>/api/whatsapp/webhook
```

## Qué datos de Meta se necesitan

| Variable en Railway (servicio `api`) | De dónde sale en Meta | ¿Secreta? |
|---|---|---|
| `WHATSAPP_PROVIDER` | Se escribe `meta` | No |
| `META_PHONE_NUMBER_ID` | WhatsApp → *Configuración de la API* → «ID del número de teléfono» | No |
| `META_ACCESS_TOKEN` | Token de acceso (ver paso 3) | **Sí** |
| `META_APP_SECRET` | Configuración de la app → *Básica* → «Clave secreta de la app» | **Sí** |
| `META_VERIFY_TOKEN` | **Lo inventás vos** (una frase larga y al azar); se pega igual en Meta y en Railway | **Sí** |
| `META_API_VERSION` | Opcional (por defecto `v21.0`) | No |
| `BOT_ENABLED` | `true` | No |

## Paso a paso

### 1. La app de Meta
En **developers.facebook.com → Mis apps**.

> ⚠️ **Un webhook por app.** Si usás la misma app de tu bot anterior (`whatsapp-ai-bot`), al apuntarla a este sistema **ese bot deja de recibir mensajes**. Si el bot anterior sigue en uso, creá otra app (tipo *Empresa*, producto *WhatsApp*); es gratis.

### 2. Número y destinatarios
En **WhatsApp → Configuración de la API**:
- Meta da un **número de prueba** gratuito (mostrado arriba, con su *ID del número de teléfono*).
- En **«Para»** agregá los celulares que van a probar (**hasta 5**) y verificalos con el código que les llega por WhatsApp. Solo esos números pueden hablar con el número de prueba.

### 3. Token de acceso
- El de la pantalla de configuración **dura 24 horas**: sirve para probar hoy, pero vence.
- Para uno estable: **Business Settings → Usuarios → Usuarios del sistema → Agregar** (rol *Administrador*) → **Generar token** con la app elegida y los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Elegí caducidad «Nunca».

### 4. Variables en Railway
En el servicio `api` → **Variables**: cargá las de la tabla de arriba (las tres secretas las pegás vos). Railway redespliega solo.

### 5. Conectar el webhook
En Meta: **WhatsApp → Configuración → Webhook → Editar**:
- **URL de devolución de llamada:** la dirección del webhook de arriba.
- **Token de verificación:** el mismo `META_VERIFY_TOKEN`.
- Tocá **Verificar y guardar**. Si falla, revisá que la `api` esté activa y que el token sea idéntico.
- En **Campos del webhook**, suscribite a **`messages`**.

### 6. Probar
Desde un celular que agregaste en «Para», escribile al **número de prueba de Meta**. El asistente tiene que responder. En el panel, el menú **WhatsApp** debe mostrar **Conectado**.

## Cosas a tener en cuenta

- **Hora de respuesta (24 h):** el asistente solo *responde* a quien le escribió, así que entra en la ventana de 24 horas de Meta. Cualquier mensaje que inicie la clínica (recordatorios) requiere plantillas aprobadas: queda fuera de la demo.
- **Costos:** el número de prueba es gratuito. Para producción, Meta cobra por conversación según su tarifario vigente: **confirmalo en tu panel de Meta**, porque cambia.
- **Producción:** además del número propio de la clínica hace falta verificar el negocio en Meta, y revisar consentimiento y privacidad de datos (Ley 25.326) antes de usar pacientes reales.
- **Seguridad:** el token y la clave secreta solo viven en las variables de Railway. Si alguna se filtra, regenerala en Meta y actualizala.
- **Números argentinos:** Meta entrega los celulares como `549…` pero para responder hay que usar `54…` (sin el 9); el sistema lo corrige solo.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Meta no verifica el webhook | Token de verificación distinto, `WHATSAPP_PROVIDER` distinto de `meta`, o la `api` caída. |
| El menú WhatsApp lista variables faltantes | Falta cargar alguna `META_*` en Railway. |
| Escribís y no responde | El celular no está en la lista «Para», no se suscribió al campo `messages`, `BOT_ENABLED` no es `true`, o el token venció (24 h). |
| En los logs: `Graph API 400: 131030` | El destinatario no está en la lista de destinatarios de prueba. |
| En los logs: `Graph API 401` / `190` | Token vencido o inválido: generá otro. |
| «Firma inválida» (401 en el webhook) | `META_APP_SECRET` equivocada: copiala de nuevo de la configuración *Básica* de la app. |
