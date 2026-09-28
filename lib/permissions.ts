import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// Permisos de una cuenta staff, guardados en professionals.permissions (jsonb).
// Mantener en sync con el portal (ZyncraSas_v1/src/lib/staff-permissions.ts).
//
// · contact / amounts / clients_tab: qué VE en la app. null/ausente = visible
//   (comportamiento histórico), igual que parseMobilePermissions del portal.
// · full_agenda / manage_pos: qué PUEDE hacer. null/ausente = no. Los hace
//   cumplir la RLS, no la UI: la app solo los usa para no ofrecer lo que la
//   base va a negar.
export type StaffPermissions = {
  contact: boolean;      // teléfono/correo de clientes y botones de llamada/WhatsApp
  amounts: boolean;      // precios de servicios y totales gastados
  clients_tab: boolean;  // pestaña de Clientes completa
  /** true = ve y edita TODAS las citas del negocio (recepción/encargado).
   *  false = solo las suyas (barbero). */
  full_agenda: boolean;
  /** true = puede registrar ventas del POS y movimientos de caja. */
  manage_pos: boolean;
};

export const DEFAULT_PERMISSIONS: StaffPermissions = {
  contact: true, amounts: true, clients_tab: true,
  full_agenda: false, manage_pos: false,
};

/**
 * Lo que se usa MIENTRAS carga o si la consulta falla. Antes era "todo
 * visible": un barbero sin permiso de contacto veía los teléfonos hasta que
 * llegaba la respuesta, o para siempre si fallaba (ARQ-12).
 */
export const RESTRICTIVE_PERMISSIONS: StaffPermissions = {
  contact: false, amounts: false, clients_tab: false,
  full_agenda: false, manage_pos: false,
};

/** El dueño: ve toda la agenda y maneja la caja. Solo para el rol admin. */
const PERMISOS_DUENO: StaffPermissions = {
  contact: true, amounts: true, clients_tab: true,
  full_agenda: true, manage_pos: true,
};

/**
 * Lee un booleano del jsonb. La base compara con
 * COALESCE(permissions->>'full_agenda', 'false') = 'true', así que el string
 * "true" cuenta igual que true; se acepta también "false". Cualquier otra
 * cosa (null, ausente, basura) toma el valor por defecto.
 */
function leerBool(v: unknown, porDefecto: boolean): boolean {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return porDefecto;
}

/**
 * Permisos desde professionals.permissions. CONSERVA las claves que no son
 * de la app (web_modules del panel web): Ajustes → Equipo guarda este objeto
 * entero y, si se perdieran, al editar un profesional en el móvil se le
 * borraría el acceso a los módulos del portal.
 */
export function parsePermissions(raw: unknown): StaffPermissions {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    ...r,
    contact: leerBool(r.contact, DEFAULT_PERMISSIONS.contact),
    amounts: leerBool(r.amounts, DEFAULT_PERMISSIONS.amounts),
    clients_tab: leerBool(r.clients_tab, DEFAULT_PERMISSIONS.clients_tab),
    full_agenda: leerBool(r.full_agenda, DEFAULT_PERMISSIONS.full_agenda),
    manage_pos: leerBool(r.manage_pos, DEFAULT_PERMISSIONS.manage_pos),
  };
}

// Una sola copia compartida por todas las pantallas (antes cada una leía por
// su lado, una sola vez, y los cambios del dueño no llegaban hasta reiniciar).
type Cache = { userId: string; perms: StaffPermissions; at: number };
let cache: Cache | null = null;
let ultimoError = false;
let enCurso: Promise<void> | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach(fn => fn());
const FRESCURA_MS = 30_000;

async function cargar(userId: string, professionalId: string | null) {
  let q = supabase.from("professionals").select("permissions").eq("user_id", userId);
  q = professionalId ? q.eq("id", professionalId) : q.eq("is_active", true);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1);
  if (error || !data || data.length === 0) {
    ultimoError = true;
    // Se conserva el último valor bueno de esta cuenta; si no hay, queda el restrictivo.
    if (cache && cache.userId !== userId) cache = null;
  } else {
    ultimoError = false;
    cache = { userId, perms: parsePermissions(data[0].permissions), at: Date.now() };
  }
  avisar();
}

function asegurar(userId: string, professionalId: string | null, forzar = false) {
  const fresca = cache && cache.userId === userId && Date.now() - cache.at < FRESCURA_MS;
  if (!forzar && fresca) return;
  if (enCurso) return;
  enCurso = cargar(userId, professionalId).finally(() => { enCurso = null; });
}

/** Permisos + si todavía cargan o falló la lectura. */
export function useStaffPermissionsEstado(): { perms: StaffPermissions; cargando: boolean; error: boolean } {
  const { user, role, professionalId } = useAuth();
  const userId = user?.id ?? null;
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick(x => x + 1);
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
  }, []);

  useEffect(() => {
    if (!userId || role !== "staff") return;
    asegurar(userId, professionalId);
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") asegurar(userId, professionalId);
    });
    return () => sub.remove();
  }, [userId, role, professionalId]);

  // El dueño ve y puede todo: los permisos son solo para el staff.
  if (role === "admin") return { perms: PERMISOS_DUENO, cargando: false, error: false };
  const vigente = cache && userId && cache.userId === userId ? cache : null;
  return {
    perms: vigente?.perms ?? RESTRICTIVE_PERMISSIONS,
    cargando: !vigente && !ultimoError,
    error: ultimoError,
  };
}

// Permisos de la cuenta staff logueada. Mientras carga (o si falla) devuelve
// los restrictivos; se releen al volver a primer plano.
export function useStaffPermissions(): StaffPermissions {
  return useStaffPermissionsEstado().perms;
}
