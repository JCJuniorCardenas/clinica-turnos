import { Controller, Get, Injectable, Query, Res, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString, Matches } from "class-validator";
import ExcelJS from "exceljs";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { DATE_RE, utcToLocal } from "../common/time";
import { DisponibilidadService } from "../disponibilidad/disponibilidad.module";
import { TurnosService } from "./turnos.service";

class ExportQuery {
  @IsOptional() @Matches(DATE_RE) desde?: string;
  @IsOptional() @Matches(DATE_RE) hasta?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsIn(["true", "false"]) incluirCancelados?: string;
}

const ESTADO: Record<string, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
  ATENDIDO: "Atendido",
  AUSENTE: "Ausente",
};

/** Spreadsheet apps run text starting with = + - @ as a formula; prefix it so patient-typed data stays plain text. */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

@Injectable()
export class ExportarService {
  constructor(
    private turnos: TurnosService,
    private disp: DisponibilidadService,
  ) {}

  async xlsx(u: AuthUser, q: ExportQuery): Promise<{ buffer: Buffer; filename: string }> {
    const tz = await this.disp.getTimezone(u.clinicaId);
    const rows = await this.turnos.list(u, q);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Turnos");
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Hora", key: "hora", width: 8 },
      { header: "Doctor", key: "doctor", width: 28 },
      { header: "Paciente", key: "paciente", width: 28 },
      { header: "Teléfono", key: "telefono", width: 18 },
      { header: "DNI", key: "dni", width: 12 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Origen", key: "origen", width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    for (const t of rows) {
      const { date, time } = utcToLocal(t.inicio, tz);
      const [y, m, d] = date.split("-");
      ws.addRow({
        fecha: `${d}/${m}/${y}`,
        hora: time,
        doctor: safeCell(t.doctor.nombre),
        paciente: safeCell(t.paciente.nombre),
        telefono: safeCell(t.paciente.telefono),
        dni: t.paciente.dni ?? "",
        estado: ESTADO[t.estado] ?? t.estado,
        origen: t.origen === "BOT" ? "WhatsApp" : "Panel",
      });
    }

    const desde = q.desde ?? utcToLocal(new Date(), tz).date;
    const hasta = q.hasta ?? desde;
    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `turnos_${desde}${hasta !== desde ? `_a_${hasta}` : ""}.xlsx`,
    };
  }
}

@Controller("turnos")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportarController {
  constructor(private service: ExportarService) {}

  @Get("exportar")
  async exportar(@CurrentUser() u: AuthUser, @Query() q: ExportQuery, @Res() res: Response) {
    const { buffer, filename } = await this.service.xlsx(u, q);
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }
}
