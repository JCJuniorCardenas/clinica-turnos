-- Prevents two active appointments for the same doctor at the same time.
-- Partial index: cancelled appointments free the slot again.
CREATE UNIQUE INDEX turno_doctor_inicio_activo
ON "Turno" ("doctorId", "inicio")
WHERE "estado" <> 'CANCELADO';
