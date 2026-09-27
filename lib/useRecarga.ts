import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { hoyNegocio, zonaActiva } from "./tz";
import { suscribirSedeActiva } from "./active-location";

/**
 * Recarga de pantallas y protección contra respuestas fuera de orden.
 *
 * EL PROBLEMA
 * Las pestañas cargaban una sola vez (useEffect con [tenantId]). Si la app
 * quedaba en segundo plano, al día siguiente mostraba los datos de ayer bajo
 * la fecha de hoy; tampoco se refrescaban al volver de cobrar o de crear una
 * cita en otra pantalla. Y la bandera `cancelled` copiada en 19 efectos solo
 * evita actualizar un componente desmontado: si el usuario cambia de día dos
 * veces rápido, la respuesta vieja puede llegar DESPUÉS de la nueva y pisarla.
 */

// ─── Guard de respuestas ─────────────────────────────────────────────────────

export type Turno = {
  /** false si ya salió una petición más nueva o la pantalla se desmontó. */
  vigente: () => boolean;
};

export type GuardRespuestas = {
  /** Marca el inicio de una petición. Solo la última queda vigente. */
  nuevo: () => Turno;
  /** Invalida todas las peticiones en curso (p. ej. al cambiar de negocio). */
  invalidar: () => void;
  /** Uso interno del hook: activa/desactiva el guard con el montaje. */
  abrir: () => void;
  cerrar: () => void;
};

/** Versión sin hook (para providers o módulos). */
export function crearGuardRespuestas(): GuardRespuestas {
  let actual = 0;
  let activo = true;
  return {
    nuevo() {
      const id = ++actual;
      return { vigente: () => activo && id === actual };
    },
    invalidar() { actual++; },
    abrir() { activo = true; },
    cerrar() { activo = false; actual++; },
  };
}

/**
 * Reemplazo de la bandera `cancelled`:
 *
 *   const guard = useGuardRespuestas();
 *   const cargar = async () => {
 *     const turno = guard.nuevo();
 *     const { data, error } = await supabase.from(...)...;
 *     if (!turno.vigente()) return;      // llegó tarde: la ignoro
 *     if (error) { setError(mensajeError(error)); return; }
 *     setFilas(data ?? []);
 *   };
 */
export function useGuardRespuestas(): GuardRespuestas {
  const ref = useRef<GuardRespuestas | null>(null);
  if (!ref.current) ref.current = crearGuardRespuestas();
  useEffect(() => {
    const g = ref.current!;
    g.abrir();
    return () => g.cerrar();
  }, []);
  return ref.current;
}

// ─── "Hoy" del negocio como estado ───────────────────────────────────────────

/**
 * Día de hoy en la zona del negocio ('YYYY-MM-DD'). Cambia solo a medianoche
 * del negocio (se revisa cada minuto y al volver a primer plano), así que
 * sirve como dependencia de un efecto para recargar cuando cambia el día.
 */
export function useHoyNegocio(timeZone?: string): string {
  const zona = timeZone ?? zonaActiva();
  const [hoy, setHoy] = useState(() => hoyNegocio(zona));

  useEffect(() => {
    const revisar = () => {
      const h = hoyNegocio(zona);
      setHoy(prev => (prev === h ? prev : h));
    };
    revisar();
    const id = setInterval(revisar, 60_000);
    const sub = AppState.addEventListener("change", s => { if (s === "active") revisar(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [zona]);

  return hoy;
}

// ─── Recarga de pantalla ─────────────────────────────────────────────────────

export type OpcionesRecarga = {
  /** Zona del negocio para detectar el cambio de día. Default: zona activa. */
  timeZone?: string;
  /** false = todavía no se puede cargar (falta tenantId, o useTenant().ready). Default true. */
  habilitado?: boolean;
  /** Recargar al volver a primer plano. Default true. */
  alVolver?: boolean;
  /** Recargar cuando cambia el día del negocio. Default true. */
  alCambiarDia?: boolean;
  /** Recargar cuando cambia la sede activa. Default true. */
  alCambiarSede?: boolean;
  /**
   * No volver a cargar al enfocar si la última carga fue hace menos de esto
   * (ms). Default 0: siempre. Útil en pestañas pesadas (p. ej. 30_000).
   */
  frescuraMs?: number;
};

/**
 * Carga la pantalla al enfocarla y la vuelve a cargar cuando:
 *   · la pantalla vuelve a enfocarse (volver de otra pantalla o pestaña),
 *   · la app vuelve a primer plano mientras la pantalla está visible,
 *   · cambia el día del negocio (medianoche) o la sede activa,
 *   · cambia cualquiera de `deps` (tenantId, timezone, filtros…).
 *
 * Reemplaza al useEffect de carga: NO dejes también el useEffect, o cargará
 * dos veces al montar. `cargar` puede cambiar en cada render: siempre se usa
 * la última versión.
 *
 *   const { tenantId } = useAuth();
 *   const { timezone, ready } = useTenant();
 *   const guard = useGuardRespuestas();
 *   const { hoy, recargar } = useRecarga(async () => {
 *     const turno = guard.nuevo();
 *     const { data, error } = await supabase.from("appointments")...;
 *     if (!turno.vigente()) return;
 *     ...
 *   }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready });
 *
 * Devuelve `hoy` (día del negocio, se actualiza a medianoche), `recargar`
 * (para pull-to-refresh o después de guardar) y `cargando` (true mientras la
 * última carga no termina).
 */
export function useRecarga(
  cargar: () => unknown,
  deps: DependencyList,
  opciones: OpcionesRecarga = {},
): { hoy: string; recargar: () => Promise<void>; cargando: boolean } {
  const {
    timeZone,
    habilitado = true,
    alVolver = true,
    alCambiarDia = true,
    alCambiarSede = true,
    frescuraMs = 0,
  } = opciones;

  const hoy = useHoyNegocio(timeZone);
  const hoyRef = useRef(hoy);
  hoyRef.current = hoy;
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const habilitadoRef = useRef(habilitado);
  habilitadoRef.current = habilitado;
  const enfocada = useRef(false);
  const ultimaCarga = useRef(0);
  const pendiente = useRef(false);   // algo cambió mientras la pantalla no se veía
  const [cargando, setCargando] = useState(false);
  const enCurso = useRef(0);

  const ejecutar = useCallback(async () => {
    if (!habilitadoRef.current) return;
    ultimaCarga.current = Date.now();
    pendiente.current = false;
    enCurso.current++;
    setCargando(true);
    try {
      await cargarRef.current();
    } catch {
      // La pantalla maneja sus errores (ErrorState); aquí solo se evita un
      // rechazo sin atrapar que tumbe la app en desarrollo.
    } finally {
      enCurso.current--;
      if (enCurso.current === 0) setCargando(false);
    }
  }, []);

  // Enfoque + cambios de deps/día/habilitado mientras la pantalla se ve.
  const diaDep = alCambiarDia ? hoy : "";
  const depsRef = useRef<{ key: DependencyList; dia: string; hab: boolean } | null>(null);
  useFocusEffect(
    useCallback(() => {
      enfocada.current = true;
      const previo = depsRef.current;
      const cambioAlgo = !previo
        || previo.dia !== diaDep
        || previo.hab !== habilitado
        || previo.key.length !== deps.length
        || previo.key.some((d, i) => !Object.is(d, deps[i]));
      depsRef.current = { key: deps, dia: diaDep, hab: habilitado };
      const fresca = frescuraMs > 0 && Date.now() - ultimaCarga.current < frescuraMs;
      if (cambioAlgo || pendiente.current || !fresca) ejecutar();
      return () => { enfocada.current = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [habilitado, diaDep, ejecutar, frescuraMs, ...deps]),
  );

  // Volver a primer plano con la pantalla visible.
  useEffect(() => {
    if (!alVolver) return;
    const sub = AppState.addEventListener("change", s => {
      if (s !== "active") return;
      if (!enfocada.current) { pendiente.current = true; return; }
      // Si además cambió el día, la recarga la hace el efecto de enfoque
      // (hoy cambia): no cargar dos veces.
      if (alCambiarDia && hoyNegocio(timeZone ?? zonaActiva()) !== hoyRef.current) return;
      if (Date.now() - ultimaCarga.current > 1500) ejecutar();
    });
    return () => sub.remove();
  }, [alVolver, alCambiarDia, timeZone, ejecutar]);

  // Cambio de sede activa.
  useEffect(() => {
    if (!alCambiarSede) return;
    return suscribirSedeActiva(() => {
      if (enfocada.current) ejecutar();
      else pendiente.current = true;
    });
  }, [alCambiarSede, ejecutar]);

  return { hoy, recargar: ejecutar, cargando };
}
