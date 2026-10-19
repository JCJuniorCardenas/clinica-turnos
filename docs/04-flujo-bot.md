# Flujo del bot de WhatsApp

Diseño de la conversación. Complementa la sección 5 y la sección 7 de `CLAUDE.md`.

## 1. Principios

- Mensajes cortos, tono cordial y en español argentino (voseo). Un solo pedido por mensaje.
- Cuando conviene, ofrecer opciones numeradas para reducir errores de interpretación.
- **Nunca inventar horarios, doctores o especialidades.** Todo sale de las tools del backend.
- **Sin consejo médico.** Ante síntomas o urgencias se responde con un texto fijo (no generado) y se deriva.
- El paciente puede salir en cualquier momento escribiendo "menú" o "cancelar".
- La IA interpreta lo que dice el paciente. El backend decide qué se puede hacer.

## 2. Intenciones

| Intención | Ejemplo | Acción |
|---|---|---|
| `sacar_turno` | "Quiero turno con el pediatra" | Flujo de la sección 4 |
| `cancelar_turno` | "Necesito cancelar el del martes" | Flujo de la sección 5 |
| `reprogramar_turno` | "Quiero cambiar mi turno" | Flujo de la sección 5 |
| `consultar_mis_turnos` | "¿Qué turnos tengo?" | `listar_turnos_paciente` |
| `consultar_info` | "¿Qué especialidades tienen?" | Responder desde datos de la clínica |
| `hablar_con_recepcion` | "Quiero hablar con una persona" | `derivar_a_recepcion` |
| `urgencia` | Síntomas graves, "me duele el pecho" | Texto fijo y derivación inmediata |
| `fuera_de_alcance` | Cualquier otra cosa | Explicar qué puede hacer el bot |

## 3. Estados de la conversación

El estado se guarda en `Conversacion.estado` por teléfono, así el bot no pierde el hilo.

```
MENU
 ├─ sacar turno ──> ELIGIENDO_ESPECIALIDAD ──> ELIGIENDO_DOCTOR ──> ELIGIENDO_HORARIO
 │                                                                        │
 │                                           DATOS_PACIENTE <─────────────┘
 │                                                │
 │                                           CONFIRMANDO ──> FINALIZADO
 ├─ cancelar ───> ELIGIENDO_TURNO ──> CONFIRMANDO_CANCELACION ──> FINALIZADO
 ├─ reprogramar > ELIGIENDO_TURNO ──> ELIGIENDO_HORARIO ──> CONFIRMANDO ──> FINALIZADO
 └─ persona ────> DERIVADO_A_HUMANO
```

- La sesión vence tras un período de inactividad (valor inicial sugerido: 30 minutos, configurable). Al volver, el bot retoma o reinicia el menú.
- En `DERIVADO_A_HUMANO` el bot deja de responder y avisa a recepción en el panel.

## 4. Flujo "sacar turno"

1. El bot saluda y pregunta qué necesita.
2. Si el paciente ya dijo la especialidad o el doctor, se saltean esos pasos.
3. Pregunta la especialidad (`listar_especialidades`) y luego el doctor (`listar_doctores`). Si hay un solo doctor, lo propone directamente.
4. Pregunta preferencia de día o franja y llama a `buscar_disponibilidad`.
5. Ofrece **3 a 5 horarios**. Si no hay en la fecha pedida, ofrece los 3 próximos disponibles.
6. Pregunta **para quién es el turno** y pide nombre completo y DNI si esa persona no está registrada.
7. Resume (doctor, especialidad, día, hora, paciente) y pide confirmación explícita.
8. `crear_turno`. Si el horario se ocupó mientras tanto, se disculpa y ofrece alternativas (lo detecta el índice único, no el modelo).
9. Envía la confirmación con todos los datos.

Ejemplo:

```
Paciente: Hola, quiero un turno con pediatría
Bot:      Hola. Tenemos estos pediatras: 1) Dra. Ejemplo A, 2) Dr. Ejemplo B. ¿Con cuál querés?
Paciente: 1
Bot:      ¿Qué día te queda bien?
Paciente: el jueves a la tarde
Bot:      Jueves 14:00, 15:00 o 16:00. ¿Cuál preferís?
Paciente: 15
Bot:      ¿Para quién es el turno? Necesito nombre completo y DNI.
Paciente: Para mi hijo, Juan Pérez, DNI 00.000.000
Bot:      Confirmo: Pediatría con la Dra. Ejemplo A, jueves a las 15:00, paciente Juan Pérez. ¿Lo agendo?
Paciente: sí
Bot:      Listo, quedó agendado.
```

## 5. Flujos "cancelar" y "reprogramar"

- Se muestran **solo los turnos futuros de los pacientes asociados a ese teléfono**, nunca de otros.
- Cancelar: el paciente elige cuál, confirma y se llama a `cancelar_turno`. El horario vuelve a quedar libre.
- Reprogramar: se elige el turno y un nuevo horario. Es **una sola operación atómica**: si falla la creación del nuevo, el turno original se mantiene.

## 6. Reglas de seguridad y privacidad

- El bot nunca revela datos de otros pacientes ni listados de turnos ajenos.
- Un teléfono puede estar asociado a varios pacientes (hijos, familiares). Por eso el turno siempre se asocia a un paciente identificado por DNI, no solo por teléfono.
- Rate limiting por teléfono para evitar abuso (valor inicial sugerido: 20 mensajes por minuto, configurable).
- Todo turno creado, cancelado o reprogramado por el bot queda en `Auditoria` con `actor = "BOT"`.
- Mensajes que no sean texto (audio, imagen): el bot responde que por ahora solo entiende texto y ofrece el menú. Transcripción de audios queda como mejora futura.

## 7. Lineamientos para el prompt del sistema

- Rol: asistente de turnos de la clínica. Responde solo sobre turnos e información básica de la clínica.
- Debe usar siempre las tools para disponibilidad, creación y cancelación. Si una tool falla, lo dice con honestidad y deriva.
- No da diagnósticos ni recomendaciones médicas. Ante urgencias usa el texto fijo definido por la clínica.
- Pide confirmación explícita antes de crear, cancelar o reprogramar.
- Nunca menciona que es un modelo de lenguaje salvo que le pregunten directamente, y entonces lo dice con claridad.
- El prompt y los textos fijos (urgencia, derivación) se guardan en configuración por clínica, no en el código.

## 8. Casos borde a probar

- El paciente cambia de tema a mitad del flujo.
- Dos mensajes seguidos muy rápidos.
- Horario elegido que se ocupa antes de confirmar.
- Turno pedido en el pasado, en feriado o fuera del horario del doctor.
- DNI mal escrito o con puntos y espacios (normalizar).
- Paciente que escribe en otro idioma. Definir con la clínica si se responde en español o también en portugués.
- Usuario que intenta que el bot ignore sus reglas o revele su configuración.

## 9. Guion de demo (5 minutos)

1. Desde un celular, el "paciente" escribe y saca un turno de Pediatría.
2. En el panel, recepción ve aparecer el turno en la agenda del doctor.
3. El paciente reprograma desde WhatsApp y el cambio se ve en el panel.
4. Otro paciente intenta el mismo horario y el bot le ofrece alternativas.
5. Recepción exporta los turnos del día a Excel.

Usar solo datos ficticios.
