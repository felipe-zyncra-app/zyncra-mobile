import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useSegments, type Href } from "expo-router";
import { supabase } from "./supabase";
import type { Session, User } from "@supabase/supabase-js";
import { conTimeout, esErrorDeRed, mensajeError } from "./db";
import { borrarPushTokenDelServidor, cancelarTodasLasNotificaciones } from "./notifications";
import { clearActiveLocationCache } from "./active-location";
import { CLAVE_BORRADOR_REGISTRO } from "./cuenta";

export type UserRole = "admin" | "staff" | null;

/**
 * En qué punto está la cuenta. `role` se mantiene por compatibilidad; esto
 * distingue los casos en que role es null, que antes eran todos "al login":
 *  · "cargando"    resolviendo la sesión o el rol
 *  · "sin-sesion"  nadie ha iniciado sesión
 *  · "admin"       dueño de un negocio
 *  · "staff"       profesional ACTIVO de un negocio
 *  · "sin-rol"     sesión válida sin negocio ni perfil de staff: registro a
 *                  medias (la cuenta se crea antes del OTP), admin de sede…
 *  · "desactivado" profesional con is_active = false (el dueño lo apagó)
 *  · "error"       no se pudo consultar (casi siempre, sin red); se reintenta
 */
export type EstadoAcceso = "cargando" | "sin-sesion" | "admin" | "staff" | "sin-rol" | "desactivado" | "error";

/** Pantalla para sesión sin rol, staff desactivado o error de red al resolver el rol. */
export const RUTA_SIN_ACCESO = "/sin-acceso" as Href;
/** Retomar el registro con la sesión existente (sin volver a hacer signUp). */
export const RUTA_TERMINAR_REGISTRO = "/(auth)/register?reanudar=1" as Href;

type AuthCtx = {
  session: Session | null;
  user: User | null;
  role: UserRole;
  tenantId: string | null;
  /** professionals.id del staff con sesión (null para el dueño). */
  professionalId: string | null;
  estado: EstadoAcceso;
  /** Mensaje en español cuando estado === "error". */
  errorAcceso: string | null;
  loading: boolean;
  /** Vuelve a resolver el rol contra la base. Hace falta cuando el rol cambia
   *  DESPUÉS del SIGNED_IN: al registrarse, el signUp dispara SIGNED_IN antes
   *  de que exista el negocio, así que el rol queda en null y el guard de
   *  (admin) rebotaría al login. */
  refreshRole: () => Promise<void>;
  /** Igual que refreshRole; para el botón "Reintentar". */
  reintentar: () => Promise<void>;
  /**
   * Cierre de sesión completo: borra el push_token de este teléfono en el
   * servidor, cancela las notificaciones locales, limpia la sede activa y
   * cierra la sesión del teléfono (scope local: no cierra el portal web).
   * Funciona sin red. Usarla en TODOS los botones de salir y tras eliminar la
   * cuenta, en vez de supabase.auth.signOut().
   */
  cerrarSesion: () => Promise<void>;
  /** Confirma la contraseña del usuario con sesión (para acciones sensibles). */
  verificarContrasena: (password: string) => Promise<{ ok: boolean; mensaje?: string }>;
};

const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  role: null,
  tenantId: null,
  professionalId: null,
  estado: "cargando",
  errorAcceso: null,
  loading: true,
  refreshRole: async () => {},
  reintentar: async () => {},
  cerrarSesion: async () => {},
  verificarContrasena: async () => ({ ok: false }),
});

type Resolucion =
  | { estado: "admin"; tenantId: string }
  | { estado: "staff"; tenantId: string; professionalId: string }
  | { estado: "desactivado"; tenantId: string | null; professionalId: string | null }
  | { estado: "sin-rol" }
  | { estado: "error"; mensaje: string };

/** Qué es este usuario. Nunca confunde "no pude preguntar" con "no tiene rol". */
async function consultarAcceso(userId: string): Promise<Resolucion> {
  // Dueño. order + limit en vez de maybeSingle: owner_id no es único y con
  // dos negocios maybeSingle da error y el dueño quedaba sin rol (AJU-21).
  // Se toma el más antiguo, el mismo que usa el resto del sistema.
  const own = await supabase
    .from("tenants")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (own.error) return { estado: "error", mensaje: mensajeError(own.error, "No pudimos verificar tu cuenta") };
  if (own.data && own.data.length > 0) return { estado: "admin", tenantId: own.data[0].id as string };

  // Staff. Puede tener filas en más de un negocio: se usa la primera ACTIVA.
  const pros = await supabase
    .from("professionals")
    .select("id, tenant_id, is_active")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (pros.error) return { estado: "error", mensaje: mensajeError(pros.error, "No pudimos verificar tu cuenta") };
  const filas = (pros.data ?? []) as { id: string; tenant_id: string | null; is_active: boolean | null }[];
  const activa = filas.find(p => p.is_active === true && p.tenant_id);
  if (activa) return { estado: "staff", tenantId: activa.tenant_id!, professionalId: activa.id };
  if (filas.length > 0) {
    // La RLS de la agenda ya exige is_active: entrar como staff mostraba una
    // agenda vacía sin explicación.
    return { estado: "desactivado", tenantId: filas[0].tenant_id, professionalId: filas[0].id };
  }
  return { estado: "sin-rol" };
}

/** Confirma la contraseña del usuario con sesión. No cambia de cuenta. */
export async function verificarContrasena(password: string): Promise<{ ok: boolean; mensaje?: string }> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user?.email;
  if (!email) return { ok: false, mensaje: "No hay una sesión activa." };
  if (!password) return { ok: false, mensaje: "Escribe tu contraseña." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return { ok: true };
  if (esErrorDeRed(error)) return { ok: false, mensaje: "Revisa tu conexión e inténtalo de nuevo." };
  return { ok: false, mensaje: "La contraseña no es correcta." };
}

/**
 * Sin red, signOut() devuelve error y NO borra la sesión guardada: el usuario
 * tocaba "Cerrar sesión" y seguía adentro. Aquí se fuerza el borrado local.
 * _removeSession es interno de auth-js (borra el storage y emite SIGNED_OUT);
 * si alguna versión lo quita, se borra la clave a mano.
 */
async function forzarCierreLocal() {
  const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void>; storageKey?: string };
  try {
    if (typeof auth._removeSession === "function") {
      await auth._removeSession();
      return;
    }
  } catch { /* se intenta a mano */ }
  if (auth.storageKey) await AsyncStorage.removeItem(auth.storageKey).catch(() => {});
}

const REINTENTOS_MS = [2_000, 5_000, 15_000, 30_000];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [estado, setEstado] = useState<EstadoAcceso>("cargando");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [errorAcceso, setErrorAcceso] = useState<string | null>(null);
  const router = useRouter();
  const segments = useSegments();

  // Refs para leer el estado vigente desde callbacks sin re-suscribirse.
  const estadoRef = useRef<EstadoAcceso>("cargando");
  const tenantRef = useRef<string | null>(null);
  const userRef = useRef<string | null>(null);
  const generacion = useRef(0);
  const intentos = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaRevision = useRef(0);

  const fijarEstado = useCallback((e: EstadoAcceso) => {
    estadoRef.current = e;
    setEstado(e);
  }, []);

  const limpiarReintento = () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
  };

  const aplicarSinSesion = useCallback(() => {
    generacion.current++;
    limpiarReintento();
    intentos.current = 0;
    userRef.current = null;
    tenantRef.current = null;
    setSession(null);
    setTenantId(null);
    setProfessionalId(null);
    setErrorAcceso(null);
    fijarEstado("sin-sesion");
  }, [fijarEstado]);

  /**
   * Resuelve el rol. `silencioso`: no pasa por "cargando" (revalidación con la
   * app ya en uso). Un error de red nunca degrada un rol ya resuelto: con la
   * señal mala el dueño sigue adentro y se reintenta después.
   */
  const resolver = useCallback(async (userId: string, silencioso: boolean) => {
    const gen = ++generacion.current;
    limpiarReintento();
    if (!silencioso) fijarEstado("cargando");
    ultimaRevision.current = Date.now();
    let r: Resolucion;
    try {
      r = await consultarAcceso(userId);
    } catch (e) {
      r = { estado: "error", mensaje: mensajeError(e, "No pudimos verificar tu cuenta") };
    }
    if (gen !== generacion.current || userRef.current !== userId) return;   // llegó tarde

    if (r.estado === "error") {
      const yaResuelto = estadoRef.current === "admin" || estadoRef.current === "staff";
      if (!yaResuelto) {
        setErrorAcceso(r.mensaje);
        fijarEstado("error");
      }
      const espera = REINTENTOS_MS[intentos.current];
      if (espera !== undefined) {
        intentos.current++;
        temporizador.current = setTimeout(() => {
          if (userRef.current === userId) resolver(userId, true);
        }, espera);
      }
      return;
    }

    intentos.current = 0;
    setErrorAcceso(null);
    if (r.estado === "admin") {
      tenantRef.current = r.tenantId;
      setTenantId(r.tenantId);
      setProfessionalId(null);
    } else if (r.estado === "staff") {
      tenantRef.current = r.tenantId;
      setTenantId(r.tenantId);
      setProfessionalId(r.professionalId);
    } else {
      // sin-rol / desactivado: sin negocio activo (TenantProvider se limpia).
      tenantRef.current = null;
      setTenantId(null);
      setProfessionalId(r.estado === "desactivado" ? r.professionalId : null);
    }
    fijarEstado(r.estado);
  }, [fijarEstado]);

  const refreshRole = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (!s?.user) return;
    userRef.current = s.user.id;
    setSession(s);
    const resuelto = estadoRef.current === "admin" || estadoRef.current === "staff";
    await resolver(s.user.id, resuelto);
  }, [resolver]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s?.user) {
        if (!userRef.current) aplicarSinSesion();
        return;
      }
      setSession(s);
      if (userRef.current === s.user.id && estadoRef.current !== "cargando") return;
      userRef.current = s.user.id;
      resolver(s.user.id, false);
    }).catch(() => aplicarSinSesion());

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      // No se llama a Supabase dentro del callback (auth-js puede quedar en
      // deadlock): el trabajo se difiere con setTimeout.
      if (event === "SIGNED_OUT" || !newSession) {
        const habiaUsuario = !!userRef.current;
        aplicarSinSesion();
        if (habiaUsuario) {
          // La sesión pudo terminar sin pasar por cerrarSesion (token vencido,
          // eliminada desde el web): igual se limpia lo local.
          setTimeout(() => {
            cancelarTodasLasNotificaciones();
            clearActiveLocationCache();
          }, 0);
        }
        router.replace("/(auth)/login");
        return;
      }

      setSession(newSession);
      const uid = newSession.user.id;
      // TOKEN_REFRESHED de un usuario que no se tenía: la app arrancó sin red
      // con el token vencido (getSession devolvió null, pero auth-js conserva
      // la sesión ante un error de red) y el refresco automático la recuperó.
      // Sin resolver el rol quedaba "sin-sesion" CON sesión: el guard lo
      // mandaba a /sin-acceso y ahí se quedaba en "Verificando tu cuenta…".
      const recuperada = event === "TOKEN_REFRESHED" && userRef.current !== uid;
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || recuperada) {
        const mismo = userRef.current === uid;
        const resuelto = estadoRef.current === "admin" || estadoRef.current === "staff";
        userRef.current = uid;
        // Mismo usuario ya resuelto (verificar contraseña, recuperar sesión):
        // revalidar sin pantallas de carga. Usuario nuevo: resolver desde cero.
        if (!mismo) {
          generacion.current++;
          tenantRef.current = null;
          setTenantId(null);
          setProfessionalId(null);
          fijarEstado("cargando");
        }
        setTimeout(() => resolver(uid, mismo && resuelto), 0);
      }
    });

    return () => {
      subscription.unsubscribe();
      limpiarReintento();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al volver a primer plano: reintentar si quedó en error, y revalidar al
  // staff (el dueño pudo desactivarlo mientras la app estaba en segundo plano).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || !userRef.current) return;
      const e = estadoRef.current;
      if (e === "error") {
        intentos.current = 0;
        resolver(userRef.current, false);
      } else if ((e === "staff" || e === "desactivado") && Date.now() - ultimaRevision.current > 60_000) {
        resolver(userRef.current, true);
      }
    });
    return () => sub.remove();
  }, [resolver]);

  const cerrarSesion = useCallback(async () => {
    const tid = tenantRef.current;
    const eraDueno = estadoRef.current === "admin";
    // 1. Desvincular el teléfono en el servidor (solo el dueño guarda token).
    //    Con tope de tiempo: sin red no puede impedir la salida.
    if (eraDueno && tid) {
      await conTimeout(borrarPushTokenDelServidor(tid), 4_000).catch(() => {});
    }
    // 2. Limpieza local: recordatorios con nombres de clientes, sede activa y
    //    el borrador del registro a medias (nombre del negocio, WhatsApp): el
    //    siguiente que se registrara en este teléfono lo veía precargado.
    await cancelarTodasLasNotificaciones().catch(() => {});
    clearActiveLocationCache();
    await AsyncStorage.removeItem(CLAVE_BORRADOR_REGISTRO).catch(() => {});
    // 3. Cerrar la sesión de ESTE teléfono. La global (default de supabase)
    //    también cerraba el portal web del dueño.
    let cerrada = false;
    try {
      const { error } = await conTimeout(supabase.auth.signOut({ scope: "local" }), 6_000);
      cerrada = !error;
    } catch {
      cerrada = false;
    }
    if (!cerrada) await forzarCierreLocal();
    aplicarSinSesion();
    router.replace("/(auth)/login");
  }, [aplicarSinSesion, router]);

  // Protección de rutas.
  useEffect(() => {
    if (estado === "cargando") return;
    const segs = segments as string[];
    const grupo = segs[0];
    const enAuth = grupo === "(auth)";
    const enStaff = grupo === "(staff)";
    const enSinAcceso = grupo === "sin-acceso";
    const enIndex = segs.length === 0;
    // Todo lo que no es (auth), (staff) ni sin-acceso es del dueño: (admin),
    // settings y cualquier ruta nueva. Antes /settings/* no tenía guard y un
    // staff lo abría por deep link (zyncra://settings/team) (ARQ-06).
    const enDueno = !enAuth && !enStaff && !enSinAcceso && !enIndex;

    if (!session) {
      if (!enAuth) router.replace("/(auth)/login");
      return;
    }
    if (estado === "staff") {
      if (enDueno || enSinAcceso) router.replace("/(staff)/agenda");
      return;
    }
    if (estado === "admin") {
      if (enStaff || enSinAcceso) router.replace("/(admin)/(tabs)");
      return;
    }
    // sin-rol / desactivado / error / sin-sesion con sesión en carrera
    if (enAuth) {
      // En el registro la sesión existe antes que el negocio: ahí no se toca.
      // En el login sí: antes quedaba en "Entrando…" para siempre (ARQ-01).
      if (segs[1] === "login") router.replace(RUTA_SIN_ACCESO);
      return;
    }
    if (!enSinAcceso && !enIndex) router.replace(RUTA_SIN_ACCESO);
  }, [session, estado, segments, router]);

  const role: UserRole = estado === "admin" ? "admin" : estado === "staff" ? "staff" : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        tenantId,
        professionalId,
        estado,
        errorAcceso,
        loading: estado === "cargando",
        refreshRole,
        reintentar: refreshRole,
        cerrarSesion,
        verificarContrasena,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
