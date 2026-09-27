import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { ErrorDB, FILAS_POR_BLOQUE } from "./db";
import { useGuardRespuestas, useRecarga, type Turno } from "./useRecarga";
import { filtroBusquedaClientes } from "./useClientSearch";

/**
 * Lista de clientes paginada y con búsqueda en el servidor.
 *
 * Las pantallas cargaban todos los clientes de una vez (o con limit 500) y
 * filtraban en el teléfono. El servidor corta cada respuesta en 1000 filas,
 * así que en un negocio con 1.400 clientes los que iban después de la "M" no
 * aparecían ni se podían buscar, y el encabezado decía "1000 clientes".
 * Aquí: páginas con .range() al llegar al final de la lista, total con
 * count exact y, con 2 o más caracteres, búsqueda en el servidor.
 *
 * Recarga al enfocar la pantalla o volver a primer plano (useRecarga)
 * conservando las páginas ya abiertas.
 */
export type ListaClientes<T> = {
  filas: T[];
  /** Total de clientes (o de coincidencias si hay búsqueda). null mientras no se sabe. */
  total: number | null;
  /** Primera carga (o recarga completa) en curso. */
  cargando: boolean;
  cargandoMas: boolean;
  error: unknown;
  hayMas: boolean;
  /** true si la búsqueda ya se está haciendo en el servidor. */
  buscando: boolean;
  cargarMas: () => void;
  recargar: () => Promise<void>;
};

export function useListaClientes<T extends { id: string }>(opciones: {
  tenantId: string | null | undefined;
  busqueda: string;
  /** Columnas de clients para el select ("id, name, phone"). */
  columnas: string;
  porPagina?: number;
  habilitado?: boolean;
  timeZone?: string;
}): ListaClientes<T> {
  const { tenantId, busqueda, columnas, timeZone } = opciones;
  const porPagina = Math.min(opciones.porPagina ?? 50, FILAS_POR_BLOQUE);
  const habilitado = (opciones.habilitado ?? true) && !!tenantId;

  // La búsqueda se aplica 300 ms después de dejar de escribir.
  const [filtro, setFiltro] = useState<string | null>(() => filtroBusquedaClientes(busqueda));
  useEffect(() => {
    const f = filtroBusquedaClientes(busqueda);
    const t = setTimeout(() => setFiltro(f), f ? 300 : 0);
    return () => clearTimeout(t);
  }, [busqueda]);

  const [filas, setFilas] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hayMas, setHayMas] = useState(false);
  const guard = useGuardRespuestas();
  const filasRef = useRef<T[]>([]);
  filasRef.current = filas;
  const filtroCargado = useRef<string | null | undefined>(undefined);
  const cargandoMasRef = useRef(false);
  // Turno de la última carga desde cero. "Cargar más" NO pide turno propio:
  // antes lo pedía, invalidaba una recarga en curso y esa recarga ya no bajaba
  // `cargando` (la lista quedaba trabada). Ahora solo se descarta la página
  // si empezó otra carga desde cero (o la pantalla se desmontó).
  const turnoCarga = useRef<Turno | null>(null);
  const cargandoRef = useRef(false);

  const consulta = useCallback((desde: number, hasta: number, conConteo: boolean) => {
    let q = supabase
      .from("clients")
      .select(columnas, conConteo ? { count: "exact" } : undefined)
      .eq("tenant_id", tenantId as string);
    if (filtro) q = q.or(filtro);
    return q.order("name").order("id").range(desde, hasta);
  }, [columnas, tenantId, filtro]);

  // Carga desde el principio. Si el filtro no cambió, vuelve a traer tantas
  // filas como ya había abiertas, para no perder la posición al refrescar.
  const cargarDesdeCero = async () => {
    const turno = guard.nuevo();
    turnoCarga.current = turno;
    cargandoRef.current = true;
    const mismoFiltro = filtroCargado.current === filtro;
    const cuantas = mismoFiltro ? Math.max(porPagina, filasRef.current.length) : porPagina;
    if (!mismoFiltro) setFilas([]);
    setCargando(true);
    try {
      const nuevas: T[] = [];
      let conteo: number | null = null;
      let desde = 0;
      let ultimaIncompleta = false;
      while (nuevas.length < cuantas) {
        const hasta = Math.min(desde + FILAS_POR_BLOQUE, cuantas) - 1;
        const { data, error: err, count } = await consulta(desde, hasta, desde === 0);
        if (err) throw new ErrorDB(err, "No se pudieron cargar los clientes");
        if (desde === 0) conteo = count ?? null;
        const pagina = (data ?? []) as unknown as T[];
        nuevas.push(...pagina);
        if (pagina.length < hasta - desde + 1) { ultimaIncompleta = true; break; }
        desde = hasta + 1;
      }
      if (!turno.vigente()) return;
      filtroCargado.current = filtro;
      setFilas(nuevas);
      setTotal(conteo);
      setHayMas(!ultimaIncompleta && (conteo == null || nuevas.length < conteo));
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) {
        cargandoRef.current = false;
        setCargando(false);
      }
    }
  };

  const { recargar } = useRecarga(cargarDesdeCero, [tenantId, filtro, columnas], {
    timeZone,
    habilitado,
    alCambiarDia: false,
    alCambiarSede: false,
  });

  const cargarMas = () => {
    const turno = turnoCarga.current;
    if (!habilitado || !turno || cargandoRef.current || cargandoMasRef.current || !hayMas) return;
    cargandoMasRef.current = true;
    setCargandoMas(true);
    const desde = filasRef.current.length;
    (async () => {
      try {
        const { data, error: err } = await consulta(desde, desde + porPagina - 1, false);
        if (err) throw new ErrorDB(err, "No se pudieron cargar más clientes");
        if (!turno.vigente()) return;
        const pagina = (data ?? []) as unknown as T[];
        setFilas(prev => {
          // Si alguien creó o borró un cliente entre páginas, evita duplicados.
          const vistos = new Set(prev.map(f => f.id));
          return [...prev, ...pagina.filter(f => !vistos.has(f.id))];
        });
        setHayMas(pagina.length === porPagina);
        // Un reintento que funciona quita el aviso del intento fallido.
        setError(null);
      } catch (e) {
        if (turno.vigente()) setError(e);
      } finally {
        cargandoMasRef.current = false;
        setCargandoMas(false);
      }
    })();
  };

  return {
    filas,
    total,
    cargando,
    cargandoMas,
    error,
    hayMas,
    buscando: !!filtro,
    cargarMas,
    recargar,
  };
}
