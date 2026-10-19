# Módulos opcionales (versión paga)

Documento interno para la presentación en la clínica. Va en `docs/06-modulos-opcionales.md`.

- Precios de terceros: relevados el 19/10/2026. Verificarlos de nuevo antes de cotizar.
- Horas: **estimaciones mías, no mediciones**. Reemplazalas por tus horas reales.
- Todo se cotiza en USD y se convierte a pesos el día de la venta.

## 1. Cómo se cobra

- **Pago único por módulo** = horas × tu tarifa. Referencia de freelance full stack en Argentina: USD 20 a 40 por hora (Coderhouse). Abajo se usa USD 20/h, el piso de ese rango. Ajustalo.
- **Abono mensual** = costos de terceros (hosting, mensajes, IA) + horas de soporte.
- La demo sigue siendo gratis. Los módulos se agregan por etapas, a medida que la clínica los necesite.

## 2. Catálogo

| # | Módulo | Qué resuelve | Horas (est.) | Pago único (USD 20/h) |
|---|---|---|---|---|
| 1 | API oficial de WhatsApp | Número estable y sin riesgo de bloqueo; base de los recordatorios | 12 a 20 | 240 a 400 |
| 2 | Recordatorios automáticos | Aviso 24 h antes con confirmar o cancelar; libera el horario si cancelan | 15 a 25 | 300 a 500 |
| 3 | Obras sociales y cobertura (registro) | Cobertura del paciente, qué obras sociales atiende cada doctor, visible en agenda y Excel | 20 a 30 | 400 a 600 |
| 4 | Obras sociales (validación automática) | Verificar afiliados en línea con cada financiadora | A cotizar tras relevar | A cotizar |
| 5 | Múltiples sedes | Agenda, doctores y reportes por sede | 15 a 25 | 300 a 500 |
| 6 | Pagos y señas (Mercado Pago) | Cobrar seña al reservar para reducir ausencias | 20 a 30 | 400 a 600 |
| 7 | Reportes y estadísticas | Ausentismo, ocupación por doctor, turnos por especialidad | 15 a 30 | 300 a 600 |
| 8 | Lista de espera automática | Ofrecer por WhatsApp los turnos que se liberan | 10 a 20 | 200 a 400 |
| 9 | Historia clínica electrónica | Registro clínico digital por paciente | 80 a 150 | 1.600 a 3.000, más revisión legal |

## 3. Notas por módulo

**1 y 2. WhatsApp oficial y recordatorios**
- Desde el 1/7/2025 Meta cobra por mensaje. Los mensajes de texto dentro de la ventana de 24 h son gratis, y las plantillas de utilidad enviadas dentro de esa ventana también.
- Un recordatorio se envía casi siempre fuera de la ventana, así que se cobra como plantilla de utilidad. Referencia para Argentina: unos USD 0,0085 por mensaje (fuente secundaria, confirmar en la tarifa de Meta).
- Ejemplo con datos hipotéticos (10 doctores, 8 turnos por día, 22 días): 1.760 turnos al mes, unos USD 15 por mes por cada recordatorio. Usar el volumen real de la clínica.
- Desde el 1/4/2026 Meta permite facturar en pesos argentinos.

**3 y 4. Obras sociales**
- El nivel 1 (registro) es de bajo riesgo y lo podemos hacer ya.
- No encontré una API pública unificada para validar afiliados. Cada obra social o prepaga tiene su propio sistema, y el nivel 2 depende de lo que acepte cada una. No prometerlo en la presentación sin relevar primero con qué obras sociales trabaja la clínica.

**5. Múltiples sedes**
- El modelo ya tiene `clinicaId`. Falta agregar la entidad `Sede` y colgar de ella doctores, horarios y turnos.

**6. Pagos y señas**
- Las comisiones las cobra Mercado Pago a la clínica, no a vos. No verifiqué la tarifa vigente.

**9. Historia clínica electrónica (el módulo más delicado)**
- La Ley 26.529 permite el soporte digital si se garantiza integridad, autenticidad, inalterabilidad, perdurabilidad y recuperabilidad.
- La Ley 27.706 (2023) y su reglamentación (Decreto 393/2023) crean el programa federal de historias clínicas electrónicas y definen la HCE como documento digital con marca temporal, refrendado con la firma digital del responsable. También aplica la Ley 25.326 de datos personales.
- Implica registros inmutables, auditoría de accesos, cifrado y firma digital. Recomendación: ofrecerlo como etapa posterior, con asesoramiento legal, y no prometer fecha ni precio cerrado en la presentación.

## 4. Abono mensual (ejemplo armado por mí)

| Concepto | Valor |
|---|---|
| Railway | Hobby USD 5 (incluye USD 5 de uso) o Pro USD 20 (incluye USD 20 de uso), más consumo medido |
| IA | Según proveedor y consumo. No verificado. La demo usa capa gratuita |
| Mensajes de WhatsApp | Al costo, ver nota 1 y 2 |
| Soporte | 2 h × USD 20 = USD 40 |
| **Abono base de ejemplo** | **USD 60 a 65 por mes** (infraestructura USD 20 a 25 más soporte), más mensajes e IA al costo |

No cobrar por debajo de los costos reales de terceros aunque estés empezando: el hosting, la IA y los mensajes los pagás vos si no los trasladás.

## 5. Competencia (para saber con qué te van a comparar)

- **XIAgenda**: agente de IA por WhatsApp para consultorios en Argentina, con recordatorios, lista de espera, señas por Mercado Pago y varios profesionales. No encontré su precio público.
- **MedicAI**: agenda, historia clínica con IA, recordatorios y facturación ARCA. Precio inicial de USD 19 (Capterra). No pude confirmar si es por profesional o por clínica.
- **AgendaPro**: desde unos USD 19 por mes en el plan básico, según una reseña. Mismo dato sin confirmar sobre la unidad.
- **IDUNA (Titaves, Jujuy)**: agenda, historia clínica, telemedicina y obras sociales por franja horaria, con mínimo de 6 meses de contrato. No publica precios.

**Tu diferencial real**: atención local y presencial, adaptación a cómo trabaja CIMA, y datos de la clínica exportables a Excel.

## 6. Pendientes antes de cotizar

- Volumen real de turnos por mes.
- Obras sociales con las que trabaja la clínica.
- Si hay más de una sede o planes de abrir otra.
- Si quieren cobrar seña.
- Tu tarifa horaria definitiva.

## Fuentes

- Meta, precios de WhatsApp Business Platform (actualizado 30/3/2026): developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Railway, planes: docs.railway.com/pricing/plans
- Ley 27.706 y Decreto 393/2023: argentina.gob.ar y boletinoficial.gob.ar
- Tarifas freelance: coderhouse.com/co/sueldos/sueldo-desarrollador-full-stack-argentina-2025
