import { Global, Injectable, Module } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type Db = Pick<PrismaService, "auditoria">;

export interface AuditEntry {
  clinicaId: string;
  actor: string; // userId or "BOT"
  accion: string;
  entidad: string;
  entidadId: string;
  detalle?: Record<string, unknown>;
}

@Injectable()
export class AuditoriaService {
  constructor(private prisma: PrismaService) {}

  /** Pass a transaction client as `db` to make the audit row part of the same transaction. */
  record(entry: AuditEntry, db: Db = this.prisma) {
    return db.auditoria.create({
      data: { ...entry, detalle: entry.detalle as object | undefined },
    });
  }
}

@Global()
@Module({ providers: [AuditoriaService], exports: [AuditoriaService] })
export class AuditoriaModule {}
