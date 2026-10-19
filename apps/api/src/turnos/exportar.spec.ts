import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { createApp, loginAs, nextWeekday } from "../test-utils";
import { safeCell } from "./exportar";

describe("safeCell", () => {
  it("neutralizes spreadsheet formulas", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+54911")).toBe("'+54911");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("María")).toBe("María");
  });
});

async function readSheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("Turnos")!;
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    rows.push({
      fecha: String(row.getCell(1).value),
      hora: String(row.getCell(2).value),
      doctor: String(row.getCell(3).value),
      paciente: String(row.getCell(4).value),
      telefono: String(row.getCell(5).value),
      estado: String(row.getCell(7).value),
    });
  });
  return { header: String(ws.getRow(1).getCell(1).value), rows };
}

describe("exportación a Excel (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recepcion: Awaited<ReturnType<typeof loginAs>>;
  let doctor: Awaited<ReturnType<typeof loginAs>>;
  let romeroId: string;
  let pacienteId: string;
  let fecha: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    recepcion = await loginAs(app, "recepcion@demo.test");
    doctor = await loginAs(app, "doctor@demo.test"); // Dra. Benítez
    romeroId = (await recepcion.get("/doctores")).body.find((d: { nombre: string }) => d.nombre.includes("Romero")).id;
    fecha = nextWeekday(3); // Dr. Romero works Wednesdays
    const p = await recepcion.post("/pacientes").send({ nombre: "=HYPERLINK(\"http://x\")", telefono: "+5400000000555" }).expect(201);
    pacienteId = p.body.id;
    const slots = (await recepcion.get(`/disponibilidad?doctorId=${romeroId}&desde=${fecha}&hasta=${fecha}`)).body.slots;
    await recepcion.post("/turnos").send({ doctorId: romeroId, pacienteId, inicio: slots[0].inicio }).expect(201);
  });

  afterAll(async () => {
    const turnos = await prisma.turno.findMany({ where: { pacienteId }, select: { id: true } });
    const ids = turnos.map((t) => t.id);
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
    await prisma.paciente.delete({ where: { id: pacienteId } });
    await app.close();
  });

  const bin = (res: request.Response) => Buffer.from(res.body);
  const download = (agent: typeof recepcion, qs: string) =>
    agent.get(`/turnos/exportar?${qs}`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });

  it("downloads a valid .xlsx with the day's appointments and formula-safe cells", async () => {
    const res = await download(recepcion, `desde=${fecha}&hasta=${fecha}`).expect(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain(`turnos_${fecha}.xlsx`);

    const { header, rows } = await readSheet(bin(res));
    expect(header).toBe("Fecha");
    const mine = rows.filter((r) => r.doctor.includes("Romero"));
    expect(mine).toHaveLength(1);
    expect(mine[0].paciente.startsWith("'=")).toBe(true);
    expect(mine[0].estado).toBe("Confirmado");
  });

  it("filters by doctor", async () => {
    const other = (await recepcion.get("/doctores")).body.find((d: { id: string }) => d.id !== romeroId).id;
    const { rows } = await readSheet(bin(await download(recepcion, `desde=${fecha}&hasta=${fecha}&doctorId=${other}`).expect(200)));
    expect(rows.some((r) => r.doctor.includes("Romero"))).toBe(false);
  });

  it("a DOCTOR only exports their own appointments", async () => {
    const res = await download(doctor, `desde=${fecha}&hasta=${fecha}&doctorId=${romeroId}`).expect(200);
    const { rows } = await readSheet(bin(res));
    expect(rows.every((r) => r.doctor.includes("Benítez"))).toBe(true);
  });

  it("validates input and requires login", async () => {
    await recepcion.get("/turnos/exportar?desde=ayer").expect(400);
    await recepcion.get("/turnos/exportar?desde=2030-01-10&hasta=2030-01-01").expect(422);
    await request(app.getHttpServer()).get("/turnos/exportar").expect(401);
  });
});
