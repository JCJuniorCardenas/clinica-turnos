// Lists the patient sees (specialties, doctors) are written by the system, not by the model: a small or overloaded
// model sometimes names only one of two pediatricians. These helpers build the full list and repair a reply that
// left someone out.

/** A block of items that must be shown complete (all specialties, or all doctors of one specialty). */
export interface Grupo {
  /** Heading used when the block has to be appended ("Profesionales de Pediatría"). */
  titulo: string;
  /** Specialty name: when the reply mentions it, the whole group must be shown. */
  nombre?: string;
  /** Text that must appear in the reply for each item (a doctor's surname, a specialty's name). */
  claves: string[];
  /** Numbered list ready to send. */
  texto: string;
  /** Always enforce (the person asked exactly for this list); otherwise only when the reply talks about this group. */
  siempre?: boolean;
}

/** Last list returned by a tool during the current message. */
export interface Listado {
  grupos: Grupo[];
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Surname of a display name ("Dra. Valeria Acosta" -> "Acosta"). */
export const apellido = (nombre: string) => nombre.trim().split(/\s+/).pop() ?? nombre;

export function numerada(lineas: string[]): string {
  return lineas.map((l, i) => `${i + 1}) ${l}`).join("\n");
}

/** Items of the group that the reply does not mention. */
export function faltantes(reply: string, grupo: Grupo): string[] {
  const r = normalize(reply);
  return grupo.claves.filter((c) => !r.includes(normalize(c)));
}

function enJuego(reply: string, grupo: Grupo): boolean {
  if (grupo.siempre) return true;
  const r = normalize(reply);
  return (!!grupo.nombre && r.includes(normalize(grupo.nombre))) || grupo.claves.some((c) => r.includes(normalize(c)));
}

/**
 * If the reply talks about a list but left items out, that complete block is appended so nobody is hidden.
 * A reply that already names everyone (or does not talk about the list) is returned untouched.
 */
export function completarLista(reply: string, listado: Listado | undefined): string {
  if (!listado) return reply;
  const incompletos = listado.grupos.filter((g) => g.claves.length > 0 && enJuego(reply, g) && faltantes(reply, g).length > 0);
  if (incompletos.length === 0) return reply;
  return [reply.trim(), ...incompletos.map((g) => `${g.titulo}:\n${g.texto}`)].join("\n\n");
}
