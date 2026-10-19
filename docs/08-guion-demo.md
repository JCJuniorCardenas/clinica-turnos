# Guion de demo para la Clínica CIMA

Guía para presentar el sistema en la clínica: qué decir, qué mostrar, en qué orden y cómo responder las dudas. **Uso interno.** Duración: **8 a 10 minutos** de demo más la conversación.

> Regla de oro: **solo datos ficticios**. Los pacientes, DNI y teléfonos del sistema son inventados. No usar datos reales de nadie.

---

## 1. La idea en una frase

> «Hoy la agenda es una hoja de papel. Lo que les mostramos es **esa misma hoja, pero viva**: se actualiza sola y un asistente por WhatsApp agenda, cambia y cancela turnos las 24 horas, sin que nadie tenga que atender el teléfono.»

**Tres mensajes para repetir durante toda la demo:**

1. **La agenda es una sola y está viva.** Lo que agenda el asistente aparece al instante en la pantalla de recepción.
2. **Nunca se pisan turnos.** Aunque dos personas pidan el mismo horario al mismo tiempo, el sistema deja uno solo.
3. **El asistente no inventa nada.** Solo ofrece los horarios que existen de verdad y siempre pide confirmación.

---

## 2. Palabras clave (para que se les queden)

| Decí esto | Para explicar |
|---|---|
| **Agenda en vivo** | La pantalla se actualiza sola, con aviso y sonido cuando entra un turno. No hay que recargar. |
| **Sin doble reserva** | Dos pacientes no pueden quedar en el mismo horario con el mismo doctor. Lo garantiza el sistema, no la buena voluntad. |
| **Asistente que no inventa** | Consulta la agenda real. Si no hay horario, lo dice y ofrece los más cercanos. |
| **Confirma siempre** | Antes de agendar, cancelar o cambiar un turno, resume y espera el «sí» del paciente. |
| **Pasa a una persona** | Si pide hablar con alguien, si hay una urgencia o si algo falla, deriva a recepción. |
| **Todo queda registrado** | Quién hizo qué y cuándo (turno creado, cancelado, reprogramado), también lo que hace el asistente. |
| **Cada doctor ve su agenda** | Los doctores ven solo sus turnos; recepción ve todo; el administrador configura. |

---

## 3. Antes de salir (checklist, 15 minutos antes)

- [ ] Abrir el panel de la demo y **iniciar sesión** (administrador). Si el sistema fue usado antes: **Simulador WhatsApp → «Reiniciar datos de la demo»**.
- [ ] Pantalla **WhatsApp**: debe decir **Conectado** (punto verde). Si no, escanear el QR con el chip secundario.
- [ ] Probar un mensaje de WhatsApp al número del asistente desde **otro celular** y ver que responde.
- [ ] Celular con **datos móviles** cargados (para usarlo como plan B si falla el wifi).
- [ ] Tener abierta una **segunda ventana/pestaña** con el panel como recepcionista (para mostrar los avisos) y una pestaña con el **Simulador**.
- [ ] Sonido del equipo activado y el botón del panel en «🔔 Sonido activado».
- [ ] Imprimir una vez de prueba (que la impresora o «Guardar como PDF» funcione).
- [ ] **No ensayar de más el mismo día**: la IA gratuita tiene un límite diario de consultas por modelo (el sistema rota modelos, pero conviene no agotarlo antes de la presentación).
- [ ] Cerrar pestañas con claves, `.env` o cuentas personales. Nunca mostrar claves en pantalla.

**Usuarios de la demo:** `admin@demo.test`, `recepcion@demo.test`, `doctor@demo.test` (la contraseña es la que se configuró en el servidor).

---

## 4. Guion paso a paso

### Minuto 0 · Apertura: el problema (sin tocar la computadora)

Preguntas para que la clínica cuente su realidad (anotar las respuestas, sirven para el relevamiento):

- «¿Cómo agendan hoy? ¿Quién atiende el teléfono y el WhatsApp?»
- «¿Qué pasa cuando llaman fuera de horario?»
- «¿Se les ha pisado algún turno alguna vez? ¿Cuántas veces por semana tienen que llamar para recordar o reprogramar?»

Cerrar con: «Lo que van a ver ataca justo eso.»

### Minuto 1 · La agenda en pantalla (panel de recepción)

**Mostrar:** la pantalla de **Agenda** con todos los doctores lado a lado.

**Decir:**
- «Esta es la hoja de papel de ustedes, pero cada columna es un doctor y cada fila una hora.»
- «Verde: turno confirmado. Punteado: horario libre. Si lo cargó el asistente, dice *WhatsApp*.»
- «Cada doctor entra con su usuario y ve solo su agenda.» *(opcional: mostrar con el usuario doctor)*

**Mostrar rápido:** el selector de fecha y el filtro por doctor.

### Minuto 2 · Un paciente saca un turno por WhatsApp

**Qué hacer:** pedirle a alguien de la clínica que escriba desde **su celular** al número del asistente. Mientras tanto, dejar visible la agenda en la pantalla.

**Frases sugeridas para el «paciente»** (no hace falta que sean exactas; el asistente entiende lenguaje natural):

1. `Hola, quiero un turno con pediatría`
2. `Con la Dra. Ibarra` *(o la que ofrezca)*
3. `El martes a la mañana`
4. `El de las 10` *(el horario que ofrezca)*
5. `Es para mi hijo, Juan Pérez, DNI 40123456`
6. `Sí` *(cuando pida confirmar)*

**Decir mientras tanto:**
- «Hablan como hablarían con una recepcionista. No hay que apretar números ni aprender nada.»
- «Fijense: **los horarios que ofrece son los reales** de la doctora. No los inventa.»
- «Pregunta *para quién* es el turno, porque un mismo teléfono puede ser de una mamá con varios hijos.»
- «**Antes de agendar pide confirmación.** El sistema no le permite agendar sin el sí del paciente.»

### Minuto 4 · Aparece solo en la agenda

**Mostrar:** la pantalla de recepción: el turno aparece **sin tocar nada**, con un cartel abajo («Nuevo turno: …») y un sonido.

**Decir:** «La recepcionista se entera en el momento. No tiene que estar refrescando ni mirando una planilla.»

### Minuto 5 · Reprogramar desde el celular

**«Paciente»:** `Necesito cambiar mi turno` → elige el nuevo horario → `Sí`.

**Mostrar:** en la agenda, el turno se movió y el horario anterior quedó **libre**.

**Decir:** «El cambio es de un solo paso: si el nuevo horario falla, el turno original no se pierde.»

### Minuto 6 · Que no se pisen los turnos

Hay dos formas de mostrarlo; elegir una:

- **En vivo con dos pantallas (recomendado):** en la computadora, abrir un horario libre y empezar a cargar un turno (sin confirmar). Desde el celular, agendar **ese mismo horario**. Luego confirmar en la computadora: aparece **«Ese horario ya fue tomado»** con alternativas cercanas.
- **Explicando:** «Si dos personas piden el mismo horario en el mismo segundo, el sistema deja pasar a una y a la otra le ofrece otros horarios.»

**Decir:** «Esto lo probamos con pedidos simultáneos: de doce intentos al mismo horario, entra uno solo.»

### Minuto 7 · Cuando hay que pasar a una persona

**«Paciente»:** `Quiero hablar con una persona`. Luego, en otro chat: `Me duele el pecho` *(urgencia)*.

**Mostrar:** el menú **Chats derivados** con el contador rojo. La urgencia aparece marcada.

**Decir:**
- «Si el paciente quiere hablar con alguien, o si algo falla, el asistente **se corre** y avisa a recepción.»
- «**No da consejos médicos ni diagnósticos.** Ante una urgencia responde con un texto fijo de la clínica (llamar a emergencias) y avisa a recepción.»
- «Mientras el chat está con una persona, el asistente no contesta ese número. Cuando recepción termina, toca *Resuelto*.»

### Minuto 8 · Papel y planilla

**Mostrar:**
- Botón **Imprimir** en la agenda: sale la hoja del día (por doctor o de todos), igual a la de papel. También sirve «Guardar como PDF».
- Pantalla **Exportar**: planilla de Excel con filtros por fecha y doctor.

**Decir:** «Si quieren seguir imprimiendo la hoja para el consultorio, se puede. La planilla abre con Excel, Google Sheets o LibreOffice.»

### Minuto 9 · Cierre

- «Esto es lo que funciona hoy en la demo. Lo que viene en la versión completa depende de lo que **ustedes necesiten**.»
- Mencionar posibilidades **sin precios**: recordatorios automáticos a los pacientes, más sedes, reportes, cobertura de obras sociales, número oficial de WhatsApp Business.
- Pasar a las preguntas de la sección 6.

---

## 5. Cómo explicar el flujo (versión no técnica)

> «Piensen en una recepcionista nueva a la que le damos **una lista corta de cosas que puede hacer**: ver qué doctores hay, mirar la agenda, agendar, cancelar, cambiar un turno, ver los turnos de ese teléfono y pasar el chat a una persona. **No puede hacer nada más.** Cada vez que quiere hacer una de esas cosas, el sistema le revisa el pedido: ¿el horario existe? ¿es de ese paciente? ¿está libre? La inteligencia artificial solo **entiende lo que escribe el paciente**; quien decide y guarda es el sistema.»

Mapa del flujo para contar con las manos:

1. **Paciente escribe** por WhatsApp.
2. **El asistente entiende** qué quiere (sacar, cambiar, cancelar, consultar o hablar con alguien).
3. **Pregunta lo que falta** (especialidad, doctor, día, para quién).
4. **Consulta la agenda real** y ofrece 3 a 5 horarios.
5. **Resume y pide el «sí».**
6. **El sistema agenda** (y recién ahí queda en la agenda).
7. **Recepción lo ve al instante.**
8. Si algo no se puede resolver: **pasa a una persona.**

---

## 6. Preguntas para hacerle a la clínica (relevamiento)

Anotar las respuestas: completan los pendientes del proyecto.

1. ¿Cuántos **doctores** y **especialidades** tienen? ¿Quién atiende qué días y en qué horarios?
2. ¿Cuánto dura un **turno** (hoy asumimos 60 minutos)? ¿Varía por doctor o por especialidad?
3. ¿Cómo es la **hoja de papel** hoy? (pedir una foto o copia para imitar la grilla)
4. ¿Con qué **número de WhatsApp** querrían atender? ¿Hoy lo usan para turnos?
5. ¿Atienden por **obras sociales**? ¿Cómo lo manejan al sacar el turno?
6. ¿Qué usan en recepción para **leer planillas** (PC, celular, Google, Excel)? ¿Les alcanza con imprimir la agenda?
7. ¿Cómo manejan los **feriados** y días sin atención?
8. Pacientes de la **frontera**: ¿necesitan que el asistente también hable **portugués**?
9. ¿Quieren que el asistente **avise por WhatsApp al doctor o a recepción** cuando entra un turno nuevo (hoy avisa en pantalla)?
10. ¿Quién sería la persona de recepción que lo usaría todos los días? ¿Y quién administra a los doctores?
11. ¿Qué **mensaje** quieren para urgencias y para cuando se deriva a recepción?

---

## 7. Preguntas difíciles y cómo responderlas

**«¿Y si la inteligencia artificial se equivoca?»**
No puede agendar algo imposible: el sistema valida cada acción (que el horario exista, que esté libre, que el paciente sea del teléfono). Además pide confirmación antes de agendar, y si duda o falla, **pasa a una persona**. Todo queda registrado.

**«¿Y si se cae internet o WhatsApp?»**
La recepción sigue trabajando desde el panel con la agenda completa. Y hoy ya trabajan sin sistema, así que el peor caso es volver a como están ahora.

**«¿Qué pasa con los datos de los pacientes?»**
En la demo son datos inventados. Para usarlo con pacientes reales, antes se revisa lo que exige la **Ley 25.326 de protección de datos personales**: consentimiento del paciente, condiciones de privacidad del proveedor de inteligencia artificial y registro de la base. Eso se hace en conjunto antes de empezar. *(No afirmar que «ya cumple la ley»: es un paso pendiente.)*

**«¿WhatsApp puede bloquear el número?»**
La demo usa un método no oficial, solo para mostrar. En la versión real se usa la **API oficial de WhatsApp Business (Meta)**, pensada para empresas y sin ese riesgo.

**«¿Cuánto sale?»**
«Depende de qué módulos necesiten. Primero queremos entender cómo trabajan y qué les ahorraría más tiempo, y después les pasamos una propuesta.» *(No dar cifras ni mostrar el documento interno de módulos opcionales.)*

**«¿Entiende audios?»**
Hoy solo texto; si mandan un audio, responde que por ahora entiende texto y ofrece el menú. La transcripción de audios es una mejora futura.

**«¿Se puede usar para historia clínica u obras sociales?»**
No: queda fuera de esta versión. Se puede evaluar más adelante.

**«¿Y si el paciente escribe cualquier cosa?»**
Explica amablemente qué puede hacer. Si insiste en otro tema o intenta engañarlo, no se sale de sus reglas.

---

## 8. Si algo falla durante la demo (plan B)

| Problema | Qué hacer |
|---|---|
| WhatsApp no responde | Usar el **Simulador WhatsApp** del panel: es la misma lógica. Decir «lo mismo, desde la computadora» y seguir. |
| El asistente dice «estoy con muchas consultas» | Es el límite del plan gratuito de la IA. Esperar un minuto, o seguir mostrando agenda, impresión y Excel. |
| Sin internet | Compartir datos desde el celular. |
| Los datos quedaron desordenados | **Simulador WhatsApp → «Reiniciar datos de la demo»** (no cierra la sesión). |
| El horario que ofrece ya pasó o no hay lugar | Cambiar de día con las flechas de la agenda; los turnos de ejemplo cubren los próximos 4 días. |

---

## 9. Qué NO decir ni mostrar

- **Precios, planes ni el documento `06-modulos-opcionales.md`** (es interno).
- **Datos reales** de pacientes, ni números personales.
- **Promesas de fechas** de entrega ni de funciones que no están hechas (recordatorios, obras sociales, pagos).
- Afirmaciones **médicas o legales** («cumple la ley», «reemplaza al médico»). Es un asistente de **turnos**.
- Pantallas con **claves, `.env` o la cuenta de Railway**.

---

## 10. Después de la demo

1. Agradecer y **llevarse el relevamiento** (sección 6).
2. Proponer una **prueba piloto** con datos reales de **un** doctor, una vez resueltos el consentimiento y la privacidad.
3. Enviar un resumen corto de lo acordado y los próximos pasos.
