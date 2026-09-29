import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useSegments, type Href } from "expo-router";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { useTenant } from "./tenant";
import { getActiveLocationId } from "./active-location";
import { revisar } from "./db";
import { hoyNegocio, sumarDias } from "./tz";
import { useGuardRespuestas, useRecarga } from "./useRecarga";
import { alRecibirNotificacion, alTocarNotificacion } from "./notifications";
import {
  armarAvisos, avisosVisibles, leerEstadoAvisos, marcar, podarEstado,
  DIAS_PROXIMOS, ESTADO_AVISOS_VACIO, MAX_RECIENTES, VENTANA_RECIENTES_MS,
  type AvisoVisible, type CitaAviso, type EstadoAvisos,
} from "./avisos";

/**
 * Campana del Panel: datos, leídas/descartadas y apertura al tocar una
 * notificación. Las reglas están en lib/avisos.ts (puras, con tests).
 */

/** Pantalla de la campana (app/(admin)/notificaciones.tsx). */
// Ruta nueva: las rutas tipadas (.expo/types) se regeneran con `expo start`.
export const RUTA_AVISOS = "/(admin)/notificaciones" as Href;

// ─── Leídas y descartadas (AsyncStorage, por negocio) ────────────────────────
// Una copia en memoria por negocio es la fuente de verdad entre la campana
// del Panel y la pantalla de avisos: al marcar en una, la otra se entera al
// instante sin esperar a releer AsyncStorage.

const claveMarcas = (tenantId: string) => `zyncra_avisos_${tenantId}`;
const marcasEnMemoria = new Map<string, EstadoAvisos>();
const oyentesMarcas = new Set<(tenantId: string) => void>();

async function leerMarcas(tenantId: string): Promise<EstadoAvisos> {
  const enMemoria = marcasEnMemoria.get(tenantId);
  if (enMemoria) return enMemoria;
  let texto: string | null = null;
  try {
    texto = await AsyncStorage.getItem(claveMarcas(tenantId));
  } catch {
    texto = null;
  }
  // Si mientras se leía alguien marcó algo, gana lo de memoria.
  const ya = marcasEnMemoria.get(tenantId);
  if (ya) return ya;
  const leido = podarEstado(leerEstadoAvisos(texto), Date.now());
  marcasEnMemoria.set(tenantId, leido);
  return leido;
}

function cambiarMarcas(tenantId: string, cambio: (e: EstadoAvisos) => EstadoAvisos): void {
  const previo = marcasEnMemoria.get(tenantId) ?? ESTADO_AVISOS_VACIO;
  const nuevo = cambio(previo);
  if (nuevo === previo) return;
  marcasEnMemoria.set(tenantId, nuevo);
  try {
    AsyncStorage.setItem(claveMarcas(tenantId), JSON.stringify(nuevo)).catch(() => {});
  } catch {
    // Sin almacenamiento: vale para esta sesión.
  }
  oyentesMarcas.forEach(fn => {
    try { fn(tenantId); } catch { /* un oyente roto no tumba a los demás */ }
  });
}

// ─── Consultas ───────────────────────────────────────────────────────────────

const SEL_PROXIMAS = "id, appointment_date, appointment_time, status, professional_id, clients(name), services(name)";
const SEL_RECIENTES = "id, appointment_date, appointment_time, status, created_at, clients(name), services(name)";

type DatosAvisos = {
  /** Negocio y zona con que se consultó: no mostrar avisos de otra cuenta. */
  clave: string;
  proximas: CitaAviso[];
  recientes: CitaAviso[];
  /** Nombre de la sede que se mira, solo si el negocio tiene más de una. */
  sede: string | null;
};

/**
 * Lo que necesita armarAvisos, filtrado por la sede activa como el Panel.
 * En vez de traer TODAS las citas de 8 días (el portal no pone tope), dos
 * consultas justas dan el mismo resultado: las de hoy (sin confirmar / por
 * presentarse) y las primeras sin profesional de la semana.
 */
async function cargarDatosAvisos(tenantId: string, tz: string): Promise<Omit<DatosAvisos, "clave">> {
  const hoy = hoyNegocio(tz);
  const hasta = sumarDias(hoy, DIAS_PROXIMOS);
  const desdeCreadas = new Date(Date.now() - VENTANA_RECIENTES_MS).toISOString();
  const loc = await getActiveLocationId(tenantId);

  let qHoy = supabase.from("appointments")
    .select(SEL_PROXIMAS)
    .eq("tenant_id", tenantId)
    .eq("appointment_date", hoy)
    .in("status", ["pending", "confirmed"]);
  let qSinPro = supabase.from("appointments")
    .select(SEL_PROXIMAS)
    .eq("tenant_id", tenantId)
    .gte("appointment_date", hoy)
    .lte("appointment_date", hasta)
    .in("status", ["pending", "confirmed"])
    .is("professional_id", null);
  let qRecientes = supabase.from("appointments")
    .select(SEL_RECIENTES)
    .eq("tenant_id", tenantId)
    .gte("created_at", desdeCreadas);
  if (loc) {
    qHoy = qHoy.eq("location_id", loc);
    qSinPro = qSinPro.eq("location_id", loc);
    qRecientes = qRecientes.eq("location_id", loc);
  }

  const [resHoy, resSinPro, resRecientes, resSedes] = await Promise.all([
    qHoy.order("appointment_time").order("id").limit(300).overrideTypes<CitaAviso[], { merge: false }>(),
    qSinPro.order("appointment_date").order("appointment_time").order("id").limit(20).overrideTypes<CitaAviso[], { merge: false }>(),
    qRecientes.order("created_at", { ascending: false }).limit(MAX_RECIENTES).overrideTypes<CitaAviso[], { merge: false }>(),
    // Sin sede activa (negocio sin sedes) no hay nada que nombrar.
    loc
      ? supabase.from("locations").select("id, name").eq("tenant_id", tenantId).eq("is_active", true)
      : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
  ]);
  const deHoy = revisar(resHoy, "No se pudieron cargar los avisos") ?? [];
  const sinPro = revisar(resSinPro, "No se pudieron cargar los avisos") ?? [];
  const recientes = revisar(resRecientes, "No se pudieron cargar los avisos") ?? [];

  // Una cita de hoy sin profesional llega por las dos consultas.
  const porId = new Map<string, CitaAviso>();
  for (const c of [...deHoy, ...sinPro]) porId.set(c.id, c);

  // El nombre de la sede es solo un rótulo: si falla, la campana sigue igual.
  const sedes = (resSedes.error ? [] : resSedes.data ?? []) as { id: string; name: string | null }[];
  const activa = sedes.length > 1 ? sedes.find(x => x.id === loc) : undefined;

  return {
    proximas: Array.from(porId.values()),
    recientes,
    sede: activa ? (activa.name?.trim() || "Sede sin nombre") : null,
  };
}

/** Hora actual que se renueva cada minuto: "En 45 min" y las ventanas de 2 y 3 h no se quedan viejas. */
function useAhora(cadaMs = 60_000): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), cadaMs);
    return () => clearInterval(id);
  }, [cadaMs]);
  return ahora;
}

export type EstadoCampana = {
  /** Avisos sin los descartados, en el orden del portal, con su marca de leído. */
  avisos: AvisoVisible[];
  noLeidos: number;
  /** true cuando ya hay datos de este negocio (aunque la última recarga fallara). */
  cargado: boolean;
  error: unknown;
  sede: string | null;
  recargar: () => Promise<void>;
  marcarLeido: (id: string) => void;
  descartar: (id: string) => void;
  marcarTodosLeidos: () => void;
};

/**
 * Datos de la campana. Recarga al enfocar, al volver a primer plano, al
 * cambiar de día o de sede (useRecarga) y cuando llega una notificación con
 * la app abierta. Solo para el dueño.
 */
export function useAvisos(): EstadoCampana {
  const { tenantId, estado } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const ahora = useAhora();
  const habilitado = !!tenantId && ready && estado === "admin";
  const clave = `${tenantId ?? ""}|${timezone}`;

  const [datos, setDatos] = useState<DatosAvisos | null>(null);
  const [marcas, setMarcas] = useState<EstadoAvisos>(ESTADO_AVISOS_VACIO);
  const [error, setError] = useState<unknown>(null);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const [d, m] = await Promise.all([cargarDatosAvisos(tenantId, timezone), leerMarcas(tenantId)]);
      if (!turno.vigente()) return;
      setDatos({ ...d, clave: `${tenantId}|${timezone}` });
      setMarcas(m);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone], { timeZone: timezone, habilitado });

  // Marcas cambiadas desde la otra pantalla (Panel ↔ campana).
  useEffect(() => {
    if (!tenantId) return;
    const oyente = (tid: string) => {
      if (tid !== tenantId) return;
      const m = marcasEnMemoria.get(tid);
      if (m) setMarcas(m);
    };
    oyentesMarcas.add(oyente);
    return () => { oyentesMarcas.delete(oyente); };
  }, [tenantId]);

  // Un push de "Nueva cita" o "Cita cancelada" con la app abierta.
  useEffect(() => {
    if (!habilitado) return;
    return alRecibirNotificacion(() => { recargar(); });
  }, [habilitado, recargar]);

  const vigentes = datos && datos.clave === clave ? datos : null;
  const { visibles, noLeidos } = useMemo(() => {
    if (!vigentes) return { visibles: [] as AvisoVisible[], noLeidos: 0 };
    const lista = armarAvisos({ proximas: vigentes.proximas, recientes: vigentes.recientes, ahora, timeZone: timezone });
    return avisosVisibles(lista, marcas);
  }, [vigentes, marcas, ahora, timezone]);

  const marcarLeido = useCallback((id: string) => {
    if (tenantId) cambiarMarcas(tenantId, e => (Object.prototype.hasOwnProperty.call(e.leidas, id) ? e : marcar(e, "leidas", [id], Date.now())));
  }, [tenantId]);

  const descartar = useCallback((id: string) => {
    if (tenantId) cambiarMarcas(tenantId, e => marcar(e, "descartadas", [id], Date.now()));
  }, [tenantId]);

  // Lo que se ve en este momento, para "Marcar todos como leídos".
  const visiblesRef = useRef(visibles);
  visiblesRef.current = visibles;
  const marcarTodosLeidos = useCallback(() => {
    const ids = visiblesRef.current.filter(a => !a.leido).map(a => a.id);
    if (tenantId && ids.length > 0) cambiarMarcas(tenantId, e => marcar(e, "leidas", ids, Date.now()));
  }, [tenantId]);

  return {
    avisos: visibles,
    noLeidos,
    cargado: !!vigentes,
    error,
    sede: vigentes?.sede ?? null,
    recargar,
    marcarLeido,
    descartar,
    marcarTodosLeidos,
  };
}

// ─── Tocar una notificación abre la campana ──────────────────────────────────

/**
 * Al tocar cualquier notificación (push del portal o aviso local) se abre la
 * campana. También en arranque en frío. Solo el dueño: se monta en el layout
 * de (admin) y además revisa el rol. El staff no cambia.
 *
 * Desde el área del dueño se apila encima de lo que esté abierto; desde
 * /settings/* (fuera del grupo) se vuelve al área del dueño en vez de crear
 * otra copia de ella.
 */
export function useAbrirAvisosAlTocar(habilitado: boolean): void {
  const router = useRouter();
  const segmentos = useSegments();
  const { estado } = useAuth();
  const activo = habilitado && estado === "admin";
  const segmentosRef = useRef<string[]>(segmentos);
  segmentosRef.current = segmentos;

  useEffect(() => {
    if (!activo) return;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const abrir = () => {
      if (espera) clearTimeout(espera);
      // Un instante después: en arranque en frío el Stack recién se monta.
      espera = setTimeout(() => {
        espera = null;
        try {
          if (segmentosRef.current[0] === "(admin)") router.navigate(RUTA_AVISOS);
          else router.dismissTo(RUTA_AVISOS);
        } catch {
          // Navegación aún no lista: la campana sigue a un toque en el Panel.
        }
      }, 0);
    };
    const dejar = alTocarNotificacion(abrir);
    return () => {
      dejar();
      if (espera) clearTimeout(espera);
    };
  }, [activo, router]);
}
