import { useEffect, useState } from "react";
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
 *
 * Cambiar de sede avisa a quien se suscribió (suscribirSedeActiva /
 * useSedeActiva / useRecarga), así las pantallas abiertas recargan en vez de
 * seguir mostrando la sede anterior.
 */

type CacheEntry = { id: string | null; at: number };
const cache: Record<string, CacheEntry> = {};
const TTL_MS = 5 * 60 * 1000;

type Oyente = (tenantId: string | null) => void;
const oyentes = new Set<Oyente>();

function avisar(tenantId: string | null) {
  oyentes.forEach(fn => {
    try { fn(tenantId); } catch { /* un oyente roto no debe tumbar a los demás */ }
  });
}

export const activeLocationStorageKey = (tenantId: string) => `zyncra_loc_${tenantId}`;

export async function getActiveLocationId(tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;

  const hit = cache[tenantId];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;

  const saved = await AsyncStorage.getItem(activeLocationStorageKey(tenantId)).catch(() => null);

  const { data, error } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at");

  if (error) {
    // Sin red no se puede verificar: mejor la última sede conocida (o la
    // elegida) que estampar null, que deja la fila invisible en el web. No se
    // cachea para volver a intentar en la próxima llamada.
    return hit?.id ?? saved ?? null;
  }

  const locs = data ?? [];
  let id: string | null = null;

  if (locs.length === 1) {
    id = locs[0].id;
  } else if (locs.length > 1) {
    id = (saved && locs.some(l => l.id === saved)) ? saved : locs[0].id;
  }

  cache[tenantId] = { id, at: Date.now() };
  return id;
}

/** Elige la sede activa (selector de Ajustes → Sedes) y avisa a las pantallas. */
export async function setActiveLocationId(tenantId: string, locationId: string): Promise<void> {
  await AsyncStorage.setItem(activeLocationStorageKey(tenantId), locationId).catch(() => {});
  cache[tenantId] = { id: locationId, at: Date.now() };
  avisar(tenantId);
}

/**
 * Invalida el cache y avisa a los suscriptores. Llamarla si el usuario cambia
 * de sede en Ajustes; sin tenantId limpia todo (cierre de sesión).
 */
export function clearActiveLocationCache(tenantId?: string) {
  if (tenantId) delete cache[tenantId];
  else Object.keys(cache).forEach(k => delete cache[k]);
  avisar(tenantId ?? null);
}

/**
 * Se entera de cada cambio de sede. `tenantId` null = se limpió todo.
 * Devuelve la función para desuscribirse.
 */
export function suscribirSedeActiva(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}

/**
 * Sede activa como estado de React: se actualiza sola cuando cambia.
 * `version` sube en cada cambio (útil como dependencia de un efecto).
 */
export function useSedeActiva(tenantId: string | null): { locationId: string | null; cargando: boolean; version: number } {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    const cargar = () => {
      setCargando(true);
      getActiveLocationId(tenantId)
        .then(id => { if (vigente) setLocationId(id); })
        .finally(() => { if (vigente) setCargando(false); });
    };
    cargar();
    const quitar = suscribirSedeActiva(t => {
      if (t === null || t === tenantId) {
        setVersion(v => v + 1);
        cargar();
      }
    });
    return () => { vigente = false; quitar(); };
  }, [tenantId]);

  return { locationId, cargando, version };
}
