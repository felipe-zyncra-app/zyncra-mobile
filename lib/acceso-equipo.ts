import type { Href } from "expo-router";

// Qué abre una cuenta del equipo con rol "Administrador del negocio" en la
// app del dueño. Mantener en sync con el portal
// (ZyncraSas_v1/src/lib/staff-permissions.ts): mismo criterio de rol y los
// mismos módulos (web_modules) que el dueño le prende en Equipo → Acceso.
//
// Antes la app mandaba a cualquier colaborador a (staff): una agenda de solo
// lectura, sin "Nueva cita", sin editar citas y solo con sus propios clientes.
// La administradora de Imperio Capilar (14-oct) no podía agendar desde el
// celular lo que sí agendaba en el computador.
//
// Sin imports de auth/permissions: los usa lib/auth.tsx (evita el ciclo).

/** Booleano del jsonb como lo compara la RLS: true o el string "true". */
function si(v: unknown): boolean {
  return v === true || v === "true";
}

function objeto(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Rol Administrador del negocio: ve toda la agenda y maneja la caja. Es el
 * mismo criterio del interruptor del portal (full_agenda && manage_pos).
 */
export function esAdministradorDelEquipo(permisos: unknown): boolean {
  const p = objeto(permisos);
  return si(p.full_agenda) && si(p.manage_pos);
}

// Módulos que una cuenta nueva trae encendidos en el portal (DEFAULT_WEB_MODULES).
const MODULOS_POR_DEFECTO = new Set(["/admin", "/admin/calendar", "/admin/inbox", "/admin/reminders"]);

/** web_modules con los valores por defecto del portal para lo que no esté guardado. */
export function modulosWebDe(permisos: unknown): Record<string, boolean> {
  const guardados = objeto(objeto(permisos).web_modules);
  const out: Record<string, boolean> = {};
  for (const m of MODULOS_POR_DEFECTO) out[m] = true;
  for (const [k, v] of Object.entries(guardados)) out[k] = si(v);
  return out;
}

/**
 * Pantallas de (admin) que se abren al equipo y el módulo web que las prende.
 * Lo que no está aquí es del dueño (finanzas, comisiones, facturas, WhatsApp,
 * Hanna, /settings…) o todavía no se revisó para la RLS del equipo.
 * "settings" (la pestaña Ajustes) siempre: para el equipo es Mi perfil.
 */
const MODULO_DE_PANTALLA: Record<string, string | null> = {
  index: "/admin",
  agenda: "/admin/calendar",
  clients: "/admin/clients",
  pos: "/admin/pos",
  "por-cobrar": "/admin/pos",
  "pos-history": "/admin/pos",
  caja: "/admin/caja",
  settings: null,
};

/**
 * ¿La administradora puede abrir esta pantalla de (admin)? `pantalla` es el
 * nombre de la ruta: "index", "agenda"… para las pestañas, "caja",
 * "pos-history"… para las sub-pantallas.
 */
export function pantallaPermitida(pantalla: string, modulos: Record<string, boolean>): boolean {
  if (!(pantalla in MODULO_DE_PANTALLA)) return false;
  const modulo = MODULO_DE_PANTALLA[pantalla];
  return modulo === null || modulos[modulo] === true;
}

/** Pantalla de (admin) en la que está la ruta actual (useSegments), o null si no es de (admin). */
export function pantallaAdminDe(segmentos: string[]): string | null {
  if (segmentos[0] !== "(admin)") return null;
  if (segmentos[1] === "(tabs)") return segmentos[2] ?? "index";
  return segmentos[1] ?? "index";
}

/** Dónde entra la administradora: la agenda, o lo primero que tenga encendido. */
export function inicioAdministradorEquipo(modulos: Record<string, boolean>): Href {
  if (pantallaPermitida("agenda", modulos)) return "/(admin)/(tabs)/agenda" as Href;
  if (pantallaPermitida("index", modulos)) return "/(admin)/(tabs)" as Href;
  if (pantallaPermitida("pos", modulos)) return "/(admin)/(tabs)/pos" as Href;
  if (pantallaPermitida("clients", modulos)) return "/(admin)/(tabs)/clients" as Href;
  return "/(admin)/(tabs)/settings" as Href;
}
