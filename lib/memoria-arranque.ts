import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Lo último que el servidor dijo de ESTA cuenta, guardado en el teléfono para
 * arrancar sin esperar la red (23-oct-2026, "está lento en cargar").
 *
 * La API de Supabase da picos de 1,5 s por petición y el arranque esperaba en
 * serie quién es el usuario (dueño o staff) y luego los datos del negocio: 2 a
 * 3 vueltas antes de mostrar algo. Con esto, a partir de la segunda apertura
 * la app entra con lo último conocido y lo confirma en silencio; si el
 * servidor dice otra cosa (le quitaron el acceso, cambió el negocio), manda
 * el servidor. Es el mismo patrón que ya usa la suscripción (lib/subscription).
 *
 * Solo se guarda lo que la app ya tenía en memoria (ids, permisos, nombre y
 * zona del negocio), por cuenta. Los datos de la base siguen protegidos por la
 * RLS: esto decide qué pantalla abrir, no qué datos se pueden leer.
 */

export interface AccesoGuardado {
  estado: "admin" | "staff";
  tenantId: string;
  professionalId: string | null;
  permisos: unknown;
}

export interface NegocioGuardado {
  tenant: { name: string; phone: string; address: string; slug: string; logoUrl: string | null };
  timezone: string;
  currency: string;
  locale: string;
  categoryOrder: string[];
}

const claveAcceso = (userId: string) => `zyncra_acceso_${userId}`;
const claveNegocio = (rol: string, tenantId: string) => `zyncra_negocio_${rol}_${tenantId}`;

function leer<T>(clave: string, valido: (x: unknown) => x is T): Promise<T | null> {
  return AsyncStorage.getItem(clave)
    .then(txt => {
      if (!txt) return null;
      try {
        const v = JSON.parse(txt) as unknown;
        return valido(v) ? v : null;
      } catch {
        return null;   // caché corrupta: como si no hubiera
      }
    })
    .catch(() => null);
}

export function esAccesoGuardado(x: unknown): x is AccesoGuardado {
  const v = x as Partial<AccesoGuardado> | null;
  return !!v && (v.estado === "admin" || v.estado === "staff") && typeof v.tenantId === "string" && v.tenantId.length > 0
    && (v.professionalId === null || typeof v.professionalId === "string")
    // El staff siempre tiene su ficha: sin ella no se puede abrir su agenda.
    && (v.estado === "admin" || typeof v.professionalId === "string");
}

export function esNegocioGuardado(x: unknown): x is NegocioGuardado {
  const v = x as Partial<NegocioGuardado> | null;
  return !!v && !!v.tenant && typeof v.tenant.name === "string"
    && typeof v.timezone === "string" && typeof v.currency === "string" && typeof v.locale === "string"
    && Array.isArray(v.categoryOrder);
}

export const leerAcceso = (userId: string) => leer(claveAcceso(userId), esAccesoGuardado);
export const guardarAcceso = (userId: string, a: AccesoGuardado) =>
  AsyncStorage.setItem(claveAcceso(userId), JSON.stringify(a)).catch(() => {});
export const borrarAcceso = (userId: string) => AsyncStorage.removeItem(claveAcceso(userId)).catch(() => {});

export const leerNegocio = (rol: string, tenantId: string) => leer(claveNegocio(rol, tenantId), esNegocioGuardado);
export const guardarNegocio = (rol: string, tenantId: string, n: NegocioGuardado) =>
  AsyncStorage.setItem(claveNegocio(rol, tenantId), JSON.stringify(n)).catch(() => {});
