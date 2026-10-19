import { generateSlots } from "../disponibilidad/slots";
import { addDays, localToUtc, utcToLocal, weekdayOf } from "./time";

const TZ = "America/Argentina/Buenos_Aires";

describe("time helpers", () => {
  it("converts Buenos Aires local time to UTC (UTC-3) and back", () => {
    const utc = localToUtc("2030-03-04", "09:00", TZ);
    expect(utc.toISOString()).toBe("2030-03-04T12:00:00.000Z");
    expect(utcToLocal(utc, TZ)).toEqual({ date: "2030-03-04", time: "09:00" });
  });

  it("keeps the local date across midnight UTC", () => {
    // 23:30 local on the 4th is already the 5th in UTC
    const utc = localToUtc("2030-03-04", "23:30", TZ);
    expect(utc.toISOString()).toBe("2030-03-05T02:30:00.000Z");
    expect(utcToLocal(utc, TZ).date).toBe("2030-03-04");
  });

  it("computes weekday and date arithmetic", () => {
    expect(weekdayOf("2030-03-04")).toBe(1); // Monday
    expect(addDays("2030-02-28", 2)).toBe("2030-03-02");
  });
});

describe("generateSlots", () => {
  const franjas = [{ diaSemana: 1, horaInicio: "09:00", horaFin: "12:00" }];

  it("splits a block into slots by duration", () => {
    const slots = generateSlots(franjas, 60, "2030-03-04", TZ); // Monday
    expect(slots.map((s) => s.inicio.toISOString())).toEqual([
      "2030-03-04T12:00:00.000Z",
      "2030-03-04T13:00:00.000Z",
      "2030-03-04T14:00:00.000Z",
    ]);
  });

  it("does not emit a slot that overflows the block", () => {
    expect(generateSlots(franjas, 45, "2030-03-04", TZ)).toHaveLength(4); // 9:00 9:45 10:30 11:15
  });

  it("returns nothing on days without schedule", () => {
    expect(generateSlots(franjas, 60, "2030-03-05", TZ)).toEqual([]);
  });
});
