# Glosario

Palabras técnicas que aparecen en el proyecto, explicadas simple. Se va ampliando con cada fase.

## Estructura del proyecto

- **Repositorio (repo)**: la carpeta del proyecto guardada en GitHub, con todo su historial de cambios.
- **Commit**: una "foto" guardada del proyecto en un momento, con un mensaje que dice qué cambió. Permite volver atrás.
- **Push**: subir los commits de tu computadora a GitHub.
- **Monorepo**: un solo repositorio que contiene varias partes (acá, la API y el panel web).
- **pnpm**: la herramienta que instala las librerías que usa el proyecto.
- **Dependencia / librería**: código hecho por otros que reutilizamos (por ejemplo, para encriptar contraseñas).
- **`.env`**: archivo con configuraciones secretas (claves, direcciones de la base). Nunca se sube a GitHub. `.env.example` es la versión de ejemplo, sin secretos.
- **Docker**: programa que corre la base de datos en una "cajita" aislada en tu PC, sin instalarla a mano.

## Las dos partes del sistema

- **API (backend)**: el "cerebro" que no se ve. Recibe pedidos ("dame los turnos de hoy", "sacá este turno"), aplica las reglas y guarda en la base. Hecho con NestJS.
- **Panel web (frontend)**: las pantallas que ven recepción y los doctores en el navegador. Hecho con Next.js y Tailwind.
- **Endpoint**: una "dirección" de la API para una acción concreta, por ejemplo `POST /turnos` crea un turno.
- **GET / POST / PATCH / DELETE**: los tipos de pedido. GET = leer, POST = crear, PATCH = modificar, DELETE = borrar.
- **Código de respuesta (HTTP)**: número con que la API contesta. 200 = bien, 201 = creado, 400 = datos mal enviados, 401 = no iniciaste sesión, 403 = no tenés permiso, 404 = no existe, 409 = conflicto (ej. horario ya tomado), 422 = no cumple una regla del negocio, 429 = demasiados intentos.

## Base de datos

- **PostgreSQL (Postgres)**: el programa de base de datos donde se guardan clínicas, doctores, turnos, etc.
- **Tabla**: como una planilla de la base (por ejemplo, la tabla `Turno`).
- **Prisma**: la herramienta que conecta la API con la base y define cómo son las tablas (`schema.prisma`).
- **Migración**: un cambio versionado en la estructura de la base (crear una tabla, agregar una columna). Quedan guardadas para poder repetirlas en otra computadora o en el servidor.
- **Seed**: datos ficticios que se cargan para probar y para la demo.
- **Índice único parcial**: una regla de la base que impide dos turnos activos del mismo doctor a la misma hora, pero deja volver a reservar si el turno fue cancelado. Es la garantía final contra la doble reserva.
- **Transacción**: un grupo de pasos que se guardan todos juntos o ninguno (por ejemplo, reprogramar un turno nunca deja al paciente sin turno a medias).
- **`clinicaId`**: la etiqueta que indica a qué clínica pertenece cada dato. Toda consulta la usa para que una clínica nunca vea los datos de otra.
- **UTC**: hora universal. La base guarda todo en UTC y el panel lo muestra en hora de Argentina (UTC-3).

## Seguridad

- **Login / sesión**: iniciar sesión con email y contraseña.
- **JWT**: un "pase" firmado que la API entrega al iniciar sesión y que prueba quién sos y qué rol tenés.
- **Cookie `httpOnly`**: donde se guarda ese pase en el navegador. Los programas de la página no pueden leerla, lo que la hace más segura.
- **Rol**: el tipo de usuario. ADMIN gestiona la clínica, RECEPCION ve todas las agendas, DOCTOR ve solo la suya.
- **Hash / argon2**: las contraseñas no se guardan, se guarda una versión irreversible. Argon2 es el método.
- **Rate limiting (límite de pedidos)**: bloquea a quien intenta demasiadas veces seguidas (por ejemplo, adivinar contraseñas).
- **Guard**: el "portero" de un endpoint: revisa si estás logueado y si tu rol puede entrar.

## Turnos

- **Slot**: un horario posible para un turno (por ejemplo, 09:00 a 10:00 con la Dra. Benítez).
- **Disponibilidad**: los slots libres de un doctor: sus horarios de atención menos los turnos ya tomados y menos el pasado.
- **Auditoría**: registro de quién hizo qué y cuándo (crear, cancelar, reprogramar).
- **Evento interno**: un aviso que el sistema se manda a sí mismo cuando pasa algo ("se creó un turno"), para que otras partes reaccionen.

## Pruebas

- **Test**: un programa que comprueba solo que el sistema funciona como debe.
- **Test de concurrencia**: simula varias personas pidiendo el mismo horario a la vez para comprobar que solo una lo consigue.
- **Test de aislamiento**: comprueba que una clínica no puede ver ni tocar datos de otra.
- **Lint / typecheck**: revisión automática del código que detecta errores antes de ejecutarlo.

## Panel web y agenda en vivo (Fase 3)

- **Agenda en vivo**: la grilla se actualiza sola cuando alguien (el bot, otra recepcionista) crea, cancela o reprograma un turno, sin tener que recargar la página.
- **Server-Sent Events (SSE) / stream**: una conexión que el navegador deja abierta con la API; cuando pasa algo, la API "empuja" un aviso por ahí. Es más simple y barato que otras alternativas (WebSockets). Si la conexión se corta, el navegador se reconecta solo.
- **Latido (heartbeat)**: un mensaje vacío que se manda cada 25 segundos para que ningún intermediario cierre la conexión por inactividad.
- **Aviso (toast)**: el cartelito oscuro que aparece abajo a la derecha ("Nuevo turno: 20 oct 09:00 con Dra. Ibarra"). No avisa de lo que hiciste vos mismo.
- **Grilla**: la tabla de la agenda: una fila por hora y una columna por doctor, como la hoja de papel.
- **Modal (ventana emergente)**: la ventanita que se abre encima de la agenda para sacar o gestionar un turno.
- **Componente**: una pieza reutilizable de pantalla (por ejemplo, el modal). El panel se arma combinando componentes.
- **Ruta**: la dirección de una pantalla del panel (`/login`, `/`). Las del grupo `(panel)` exigen haber iniciado sesión.
- **Respaldo (polling)**: aunque falle la conexión en vivo, la agenda se vuelve a consultar cada 30 segundos para no quedar desactualizada.
- **Caché (`.next`)**: carpeta temporal que genera el panel mientras se desarrolla; se puede borrar sin perder nada.

## Impresión, gestión y Excel (Fase 3, entrega B)

- **Agenda imprimible**: el botón «Imprimir» de la Agenda arma una hoja A4 horizontal con el nombre de la clínica, la fecha y la grilla; los botones y menús no salen en el papel. Desde la ventana de impresión del navegador también se puede guardar como PDF.
- **Estilos de impresión (`@media print`)**: reglas de diseño que solo se aplican al imprimir.
- **Filtro por doctor**: el selector de la Agenda permite ver (e imprimir) la hoja de un solo doctor.
- **Franja horaria**: un bloque de atención de un doctor (ej.: lunes de 09:00 a 12:00). El sistema genera los turnos dentro de cada franja y no deja cargar dos que se superpongan.
- **Activar / desactivar doctor**: un doctor desactivado deja de aparecer en la agenda y de ofrecer turnos, pero no se borra, así se conserva su historial.
- **`.xlsx`**: el formato de planilla de Excel. También lo abren gratis Google Sheets y LibreOffice.
- **Fórmula neutralizada**: si un dato empieza con `=`, `+`, `-` o `@`, las planillas podrían ejecutarlo como una fórmula (un truco usado para atacar). Al exportar se le antepone un apóstrofe para que se vea como texto.
- **CORS**: regla del navegador que decide qué páginas pueden hablar con la API. Solo se permite el panel (`http://localhost:3000` en desarrollo).
- **Seed con turnos de ejemplo**: al cargar los datos ficticios también se crean turnos para los próximos 4 días (algunos «WhatsApp», otros «Panel») para que la agenda no se vea vacía en la demo. Se ve mejor un día hábil de mañana.

## Bot de WhatsApp (Fase 4)

- **Bot / asistente**: el programa que atiende por WhatsApp. Entiende lo que escribe el paciente y le contesta, pero no decide nada solo: lo que puede hacer lo define el sistema.
- **IA / LLM (modelo de lenguaje)**: la inteligencia artificial que interpreta los mensajes y redacta las respuestas. Acá usamos Gemini (capa gratuita). Se puede cambiar por otra (Groq, etc.) sin tocar el resto.
- **Herramienta (tool)**: una acción permitida que la IA puede pedirle al sistema: listar doctores, buscar horarios, crear un turno... La IA nunca escribe en la base de datos ni inventa horarios: solo pide la herramienta y el sistema valida y ejecuta.
- **Vuelta de confirmación**: antes de crear, cancelar o reprogramar, el sistema obliga a preguntarle al paciente y esperar su "sí". Aunque la IA quisiera saltearse ese paso, el sistema no la deja.
- **Prompt del sistema**: las instrucciones fijas que se le dan a la IA (tono, reglas, qué no puede hacer). Cada clínica puede agregar las suyas en `configBot`.
- **Derivación a recepción**: cuando el bot no puede resolver algo (o hay una urgencia), pasa el chat a una persona. Aparece en «Chats derivados» y el bot deja de contestar ese número hasta que recepción toca «Resuelto».
- **Texto fijo**: mensajes escritos de antemano (urgencia, derivación, error) que se envían tal cual, sin que la IA los redacte.
- **Baileys**: librería no oficial que conecta un número de WhatsApp como "dispositivo vinculado" (igual que WhatsApp Web). Sirve para la demo con un chip secundario; para producción hay que usar la API oficial de Meta.
- **QR de vinculación**: el código que se escanea desde WhatsApp para conectar el número al sistema la primera vez.
- **Sesión de WhatsApp (`.baileys-auth`)**: carpeta donde queda guardada la conexión. Es como una llave: no se sube a GitHub ni se comparte.
- **Proveedor falso (fake)**: versiones simuladas de WhatsApp y de la IA que se usan en los tests, para probar todo sin internet, sin gastar cuota y con resultados siempre iguales.
- **Límite por teléfono**: si un mismo número manda más de 20 mensajes por minuto, el bot deja de contestarle por un rato (evita abusos).
- **Chat de consola**: modo para conversar con el bot desde la terminal, sin celular (`pnpm --filter api bot:console`).
- **Cupo / límite del plan gratuito (error 429)**: Google deja hacer una cantidad limitada de consultas por minuto gratis. Si se pasa, el bot espera lo que Google indica y, si igual no alcanza, le pide al paciente que reintente en un minuto, sin derivarlo a recepción. Un plan pago o más de una clave eliminan esa limitación.

## Demo y despliegue (Fase 5)

- **Despliegue (deploy)**: publicar el sistema en un servidor de Internet para que funcione sin tu computadora. Usamos Railway.
- **Railway**: la plataforma donde queda alojado el sistema (API, panel y base de datos).
- **Servicio**: cada pieza que corre por separado en Railway (la API, el panel, la base de datos).
- **Docker / imagen**: una "caja" con el programa y todo lo que necesita para correr igual en cualquier computadora o servidor.
- **Volumen**: una carpeta del servidor que **no se borra** al reiniciar. Ahí se guarda la sesión de WhatsApp.
- **Variables de entorno**: configuraciones y claves que se cargan en el servidor sin escribirlas en el código.
- **Proxy**: el panel recibe los pedidos del navegador y se los pasa a la API. Así el navegador habla con una sola dirección y la sesión (cookie) funciona bien.
- **Red privada**: conexión interna entre los servicios de Railway; la API no queda expuesta a Internet.
- **Health check (`/health`)**: dirección que Railway consulta para saber si la API está viva.
- **Modo demo (`DEMO_MODE`)**: activa herramientas solo para presentaciones: el Simulador de WhatsApp y el botón «Reiniciar datos de la demo».
- **Simulador de WhatsApp**: pantalla del panel para conversar con el asistente sin celular; usa la misma lógica que el WhatsApp real. Sirve de plan B.
- **Prueba de punta a punta (smoke test)**: un programa que recorre toda la demo solo (turnos, bot, avisos, Excel) y avisa si algo falla (`pnpm demo:smoke`).
- **Rotación de modelos**: el plan gratuito de Gemini limita las consultas por día y por modelo; si uno se agota, el sistema pasa al siguiente de la lista sin cortar la conversación.
- **Mensaje duplicado**: WhatsApp a veces entrega dos veces el mismo mensaje; el asistente lo detecta y responde una sola vez.
