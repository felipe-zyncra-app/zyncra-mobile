import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

type TenantData = {
  name: string;
  phone: string;
  address: string;
  slug: string;
};

type TenantCtx = {
  tenant: TenantData | null;
  loading: boolean;
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
  loading: true,
  refresh: async () => {},
  update: async () => false,
  patch: () => {},
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { tenantId } = useAuth();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("tenants")
      .select("name, phone, address, slug")
      .eq("id", tenantId)
      .single();
    if (data) {
      setTenant({
        name: data.name ?? DEFAULTS.name,
        phone: data.phone ?? DEFAULTS.phone,
        address: data.address ?? DEFAULTS.address,
        slug: data.slug ?? DEFAULTS.slug,
      });
    }
  }, [tenantId]);

  const patch = useCallback((fields: Partial<TenantData>) => {
    setTenant(prev => prev ? { ...prev, ...fields } : null);
  }, []);

  const update = useCallback(async (fields: Partial<TenantData>): Promise<boolean> => {
    if (!tenantId) return false;
    const { error } = await supabase.from("tenants").update(fields).eq("id", tenantId);
    if (error) return false;
    patch(fields);
    return true;
  }, [tenantId, patch]);

  useEffect(() => {
    if (!tenantId) {
      setTenant(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <TenantContext.Provider value={{ tenant, loading, refresh, update, patch }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
