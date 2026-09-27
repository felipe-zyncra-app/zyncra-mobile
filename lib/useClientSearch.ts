import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { crearGuardRespuestas } from "./useRecarga";
import { ErrorDB } from "./db";
import { variantesTelefono } from "./countries";

export type ClientLite = { id: string; name: string; phone: string };

// ─── Filtro de búsqueda ──────────────────────────────────────────────────────
// Antes se BORRABAN % , ( ) del texto: "Pérez, Ana" buscaba "Pérez Ana" y no
// encontraba nada. Ahora el valor va entre comillas dobles (así PostgREST
// acepta , . : ( ) dentro del filtro) y los comodines de LIKE se escapan para
// buscar el texto literal.

/** Escapa los comodines de LIKE (% _ \) para que se busquen literalmente. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, m => `\\${m}`);
}

/** Valor entre comillas dobles para un filtro de PostgREST (escapa \ y "). */
function citar(valor: string): string {
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Filtro para `.or()` que busca clientes por nombre o teléfono en el
 * servidor, o null si el texto tiene menos de `minimo` caracteres.
 * El teléfono se compara por dígitos: "300 123 4567" encuentra '573001234567'
 * y "+57 300…" encuentra también los guardados sin indicativo.
 *
 *   supabase.from("clients").select("id,name").eq("tenant_id", t).or(filtro)
 */
export function filtroBusquedaClientes(query: string, minimo = 2): string | null {
  // "*" es comodín en PostgREST: se quita junto con los caracteres de control.
  const texto = (query ?? "").replace(/[\u0000-\u001f*]/g, " ").replace(/\s+/g, " ").trim();
  if (texto.length < minimo) return null;
  const partes = [`name.ilike.${citar(`%${escaparLike(texto)}%`)}`];
  const digitos = texto.replace(/\D/g, "");
  // Solo si el texto es "de teléfono" (dígitos, espacios, + - ( ) .): un nombre
  // con un número suelto no debería traer medio negocio por coincidencia.
  if (digitos.length >= 3 && /^[\d\s+\-().]+$/.test(texto)) {
    partes.push(`phone.ilike.${citar(`%${digitos}%`)}`);
    if (digitos.length > 10) partes.push(`phone.ilike.${citar(`%${digitos.slice(-10)}%`)}`);
  }
  return partes.join(",");
}

// ─── Duplicados por teléfono ─────────────────────────────────────────────────

/**
 * Cliente del negocio que ya tiene ese teléfono en cualquiera de sus formatos
 * (con o sin indicativo, con "+"), o null. `excluirId` = el propio cliente al
 * editar. Lanza ErrorDB si la consulta falla: mejor no crear que duplicar.
 */
export async function buscarClientePorTelefono(
  tenantId: string,
  phone: string,
  countryCode?: string | null,
  excluirId?: string | null,
): Promise<{ id: string; name: string; phone: string } | null> {
  const variantes = variantesTelefono(phone, countryCode);
  if (variantes.length === 0) return null;
  let q = supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).in("phone", variantes);
  if (excluirId) q = q.neq("id", excluirId);
  const { data, error } = await q.limit(1);
  if (error) throw new ErrorDB(error, "No se pudo revisar si el teléfono ya existe");
  const c = (data ?? [])[0] as { id: string; name: string; phone: string } | undefined;
  return c ?? null;
}

// ─── Hook de búsqueda ────────────────────────────────────────────────────────

export type EstadoBusquedaClientes = {
  /** null mientras la búsqueda no aplica (texto corto): el llamador usa su lista local. */
  resultados: ClientLite[] | null;
  buscando: boolean;
  /** Error de la última búsqueda (se muestra con mensajeError). */
  error: unknown;
};

/**
 * Busca clientes en el servidor (debounce 300 ms) para que los clientes que no
 * están en la lista local también aparezcan. Con varias búsquedas seguidas solo
 * se acepta la respuesta de la última (una lenta ya no pisa a una rápida).
 */
export function useClientSearchEstado(
  tenantId: string | null | undefined,
  query: string,
  opciones: { limite?: number } = {},
): EstadoBusquedaClientes {
  const limite = opciones.limite ?? 30;
  const [estado, setEstado] = useState<EstadoBusquedaClientes>({ resultados: null, buscando: false, error: null });
  const guard = useRef(crearGuardRespuestas());

  useEffect(() => {
    const g = guard.current;
    g.abrir();
    return () => g.cerrar();
  }, []);

  useEffect(() => {
    const filtro = filtroBusquedaClientes(query);
    const turno = guard.current.nuevo();
    if (!tenantId || !filtro) {
      setEstado({ resultados: null, buscando: false, error: null });
      return;
    }
    setEstado(prev => ({ ...prev, buscando: true }));
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, phone")
        .eq("tenant_id", tenantId)
        .or(filtro)
        .order("name")
        .order("id")
        .limit(limite);
      if (!turno.vigente()) return;
      if (error) {
        // Sin resultados del servidor el llamador sigue con su filtro local.
        setEstado({ resultados: null, buscando: false, error: new ErrorDB(error, "No se pudo buscar en todos los clientes") });
        return;
      }
      setEstado({
        resultados: (data ?? []).map((c: { id: string; name: string; phone: string | null }) => ({ ...c, phone: c.phone ?? "" })),
        buscando: false,
        error: null,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [tenantId, query, limite]);

  return estado;
}

/** Compatibilidad: solo los resultados (null = usa tu filtro local). */
export function useClientSearch(tenantId: string | null | undefined, query: string): ClientLite[] | null {
  return useClientSearchEstado(tenantId, query).resultados;
}
