import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/**
 * Sede activa para las ESCRITURAS del móvil (citas, ventas POS, caja).
 *
 * El panel web filtra calendario, caja, POS y finanzas por location_id;
 * las filas creadas sin sede quedan invisibles en esas vistas y no
 * bloquean horarios en la reserva pública por sede. Este helper resuelve
 * la sede a estampar:
 *   · 0 sedes  → null (tenant sin multi-sede, columna queda null como antes)
 *   · 1 sede   → esa
 *   · varias   → la elegida en AsyncStorage (zyncra_loc_{tenantId}) o la
 *                más antigua (sede principal) como default.
 * La clave de AsyncStorage es la misma que usará el selector de sede
 * cuando se agregue a Ajustes.
 */

type CacheEntry = { id: string | null; at: number };
const cache: Record<string, CacheEntry> = {};
const TTL_MS = 5 * 60 * 1000;

export const activeLocationStorageKey = (tenantId: string) => `zyncra_loc_${tenantId}`;

export async function getActiveLocationId(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;

  const hit = cache[tenantId];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;

  const { data } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at");

  const locs = data ?? [];
  let id: string | null = null;

  if (locs.length === 1) {
    id = locs[0].id;
  } else if (locs.length > 1) {
    const saved = await AsyncStorage.getItem(activeLocationStorageKey(tenantId)).catch(() => null);
    id = (saved && locs.some(l => l.id === saved)) ? saved : locs[0].id;
  }

  cache[tenantId] = { id, at: Date.now() };
  return id;
}

/** Invalida el cache (llamar si el usuario cambia de sede en Ajustes). */
export function clearActiveLocationCache(tenantId?: string) {
  if (tenantId) delete cache[tenantId];
  else Object.keys(cache).forEach(k => delete cache[k]);
}
