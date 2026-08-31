import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, useSegments } from "expo-router";
import { supabase } from "./supabase";
import type { Session, User } from "@supabase/supabase-js";

export type UserRole = "admin" | "staff" | null;

type AuthCtx = {
  session: Session | null;
  user: User | null;
  role: UserRole;
  tenantId: string | null;
  loading: boolean;
  /** Vuelve a resolver el rol contra la base. Hace falta cuando el rol cambia
   *  DESPUÉS del SIGNED_IN: al registrarse, el signUp dispara SIGNED_IN antes
   *  de que exista el negocio, así que el rol queda en null y el guard de
   *  (admin) rebotaría al login. */
  refreshRole: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  role: null,
  tenantId: null,
  loading: true,
  refreshRole: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  async function resolveRole(userId: string) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();

    if (tenant) {
      setRole("admin");
      setTenantId(tenant.id);
      return;
    }

    const { data: pro } = await supabase
      .from("professionals")
      .select("id, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (pro) {
      setRole("staff");
      setTenantId(pro.tenant_id);
      return;
    }

    setRole(null);
    setTenantId(null);
  }

  const refreshRole = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user) await resolveRole(s.user.id);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        resolveRole(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        setSession(newSession);

        if (event === "SIGNED_OUT" || !newSession) {
          setRole(null);
          setTenantId(null);
          router.replace("/(auth)/login");
          return;
        }

        if (event === "SIGNED_IN" && newSession?.user) {
          await resolveRole(newSession.user.id);
        }

        if (event === "TOKEN_REFRESHED" && !newSession) {
          setRole(null);
          setTenantId(null);
          router.replace("/(auth)/login");
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Route protection: redirect if user is in the wrong segment
  useEffect(() => {
    if (loading) return;

    const inAdmin = segments[0] === "(admin)";
    const inStaff = segments[0] === "(staff)";
    const inAuth = segments[0] === "(auth)";

    if (!session && !inAuth) {
      router.replace("/(auth)/login");
      return;
    }

    if (session && role === "staff" && inAdmin) {
      router.replace("/(staff)/agenda");
      return;
    }

    if (session && role === "admin" && inStaff) {
      router.replace("/(admin)/(tabs)");
      return;
    }
  }, [session, role, loading, segments]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        role,
        tenantId,
        loading,
        refreshRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
