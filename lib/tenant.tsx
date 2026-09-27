import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { zonaDelNegocio, ZONA_POR_DEFECTO, establecerZonaActiva } from "./tz";
import { configurarMoneda } from "./format";
import { esFuncionInexistente, mensajeError } from "./db";
import { crearGuardRespuestas } from "./useRecarga";

type TenantData = {
  name: string;
  phone: string;
  address: string;
  slug: string;
};

type TenantCtx = {
  tenant: TenantData | null;
  /** Zona horaria del negocio. De aqui salen las fronteras de dia de las
   *  consultas por `created_at`: la base guarda en UTC y un cobro de la noche
   *  cae en el dia siguiente si no se convierte. Ver lib/tz.ts.
   *  Mientras no se conoce vale ZONA_POR_DEFECTO: esperar `ready`. */
  timezone: string;
  /** true cuando `timezone` es la real del negocio (leída del servidor). */
  tzLista: boolean;
  /**
   * true cuando terminó la carga del negocio (bien o con error). Las pantallas
   * que calculan fechas deben esperar esto antes de consultar e incluir
   * `timezone` en las dependencias de su efecto: antes el Panel arrancaba con
   * la zona de Bogotá y no recargaba cuando llegaba la real (ARQ-07).
   */
  ready: boolean;
  /** Moneda y locale de tenants.settings (default COP / es-CO). */
  currency: string;
  locale: string;
  loading: boolean;
  /** Mensaje en español si la última carga falló. */
  error: string | null;
  refresh: () => Promise<void>;
  update: (fields: Partial<TenantData>) => Promise<boolean>;
  patch: (fields: Partial<TenantData>) => void;
};

const DEFAULTS: TenantData = {
  name: "Tu negocio",
  phone: "",
  address: "",
  slug: "",
};

const TenantContext = createContext<TenantCtx>({
  tenant: null,
  timezone: ZONA_POR_DEFECTO,
  tzLista: false,
  ready: false,
  currency: "COP",
  locale: "es-CO",
  loading: true,
  error: null,
  refresh: async () => {},
  update: async () => false,
  patch: () => {},
});

type Cargado = {
  tenant: TenantData;
  timezone: string;
  currency: string;
  locale: string;
};

type Fila = Record<string, unknown>;

function texto(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function desdeSettings(settings: unknown) {
  const s = (settings && typeof settings === "object" ? settings : {}) as Fila;
  return {
    timezone: zonaDelNegocio(s),
    currency: texto(s.currency) ?? "COP",
    locale: texto(s.locale) ?? "es-CO",
  };
}

/** Dueño: lee tenants directo (la RLS se lo permite). */
async function cargarComoDueno(tenantId: string): Promise<Cargado> {
  const { data, error } = await supabase
    .from("tenants")
    .select("name, phone, address, slug, settings")
    .eq("id", tenantId)
    .single();
  if (error) throw error;
  const d = data as Fila;
  return {
    tenant: {
      name: texto(d.name) ?? DEFAULTS.name,
      phone: texto(d.phone) ?? DEFAULTS.phone,
      address: texto(d.address) ?? DEFAULTS.address,
      slug: texto(d.slug) ?? DEFAULTS.slug,
    },
    ...desdeSettings(d.settings),
  };
}

/**
 * Staff: la RLS no le deja leer `tenants` (ARQ-09 / ESQ-17), así que para un
 * colaborador el negocio quedaba en null y la zona fija en Bogotá.
 * 1. RPC mi_negocio() (la agrega la migración: datos básicos del negocio del
 *    que llama, dueño o staff activo).
 * 2. Si aún no existe, get_staff_context() (ya existe, la usa el portal).
 */
async function cargarComoStaff(): Promise<Cargado> {
  const mi = await supabase.rpc("mi_negocio");
  if (!mi.error) {
    const d = ((Array.isArray(mi.data) ? mi.data[0] : mi.data) ?? {}) as Fila;
    const settings = (d.settings ?? d.tenant_settings) as unknown;
    const base = desdeSettings(settings);
    return {
      tenant: {
        name: texto(d.name, d.nombre, d.tenant_name) ?? DEFAULTS.name,
        phone: texto(d.phone, d.telefono) ?? DEFAULTS.phone,
        address: texto(d.address, d.direccion) ?? DEFAULTS.address,
        slug: texto(d.slug, d.tenant_slug) ?? DEFAULTS.slug,
      },
      timezone: texto(d.timezone, d.zona) ?? base.timezone,
      currency: texto(d.currency, d.moneda) ?? base.currency,
      locale: texto(d.locale) ?? base.locale,
    };
  }
  if (!esFuncionInexistente(mi.error)) throw mi.error;

  const ctx = await supabase.rpc("get_staff_context");
  if (ctx.error) throw ctx.error;
  const d = ((Array.isArray(ctx.data) ? ctx.data[0] : ctx.data) ?? {}) as Fila;
  return {
    tenant: {
      name: texto(d.tenant_name) ?? DEFAULTS.name,
      phone: DEFAULTS.phone,
      address: DEFAULTS.address,
      slug: texto(d.tenant_slug) ?? DEFAULTS.slug,
    },
    ...desdeSettings(d.tenant_settings),
  };
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { tenantId, role } = useAuth();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [timezone, setTimezone] = useState<string>(ZONA_POR_DEFECTO);
  const [tzLista, setTzLista] = useState(false);
  const [currency, setCurrency] = useState("COP");
  const [locale, setLocale] = useState("es-CO");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(crearGuardRespuestas()).current;

  const limpiar = useCallback(() => {
    setTenant(null);
    setTimezone(ZONA_POR_DEFECTO);
    setTzLista(false);
    setCurrency("COP");
    setLocale("es-CO");
    setError(null);
    establecerZonaActiva(null);
    configurarMoneda();
  }, []);

  const refresh = useCallback(async () => {
    if (!tenantId || (role !== "admin" && role !== "staff")) return;
    const turno = guard.nuevo();
    try {
      const c = role === "admin" ? await cargarComoDueno(tenantId) : await cargarComoStaff();
      if (!turno.vigente()) return;
      setTenant(c.tenant);
      setTimezone(c.timezone);
      setTzLista(true);
      setCurrency(c.currency);
      setLocale(c.locale);
      setError(null);
      establecerZonaActiva(c.timezone);
      configurarMoneda(c.currency, c.locale);
    } catch (e) {
      if (!turno.vigente()) return;
      // Se conserva lo que hubiera del mismo negocio; la zona queda en la de
      // por defecto solo si nunca se supo.
      setError(mensajeError(e, "No se pudieron cargar los datos del negocio"));
    }
  }, [tenantId, role, guard]);

  const patch = useCallback((fields: Partial<TenantData>) => {
    setTenant(prev => prev ? { ...prev, ...fields } : null);
  }, []);

  const update = useCallback(async (fields: Partial<TenantData>): Promise<boolean> => {
    if (!tenantId) return false;
    // .select() detecta el update que no toca filas (RLS) y no da error.
    const { data, error: e } = await supabase.from("tenants").update(fields).eq("id", tenantId).select("id");
    if (e || !data || data.length === 0) return false;
    patch(fields);
    return true;
  }, [tenantId, patch]);

  useEffect(() => {
    // Al cambiar de negocio (o cerrar sesión) no puede quedar nada del
    // anterior: ni el nombre ni la zona (antes el segundo negocio heredaba
    // la zona del primero si su consulta tardaba o fallaba).
    guard.invalidar();
    limpiar();
    setReady(false);
    if (!tenantId || (role !== "admin" && role !== "staff")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let vigente = true;
    refresh().finally(() => {
      if (!vigente) return;   // ya se cambió de negocio: no marcar listo el nuevo
      setLoading(false);
      setReady(true);
    });
    return () => { vigente = false; };
  }, [tenantId, role, refresh, limpiar, guard]);

  // Si la carga falló (sin red), reintentar al volver a primer plano.
  useEffect(() => {
    if (!error) return;
    const sub = AppState.addEventListener("change", s => { if (s === "active") refresh(); });
    return () => sub.remove();
  }, [error, refresh]);

  return (
    <TenantContext.Provider
      value={{ tenant, timezone, tzLista, ready, currency, locale, loading, error, refresh, update, patch }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
