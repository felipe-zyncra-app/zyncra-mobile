import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// Permisos de visibilidad de una cuenta staff, guardados en professionals.permissions (jsonb).
// null/ausente = todo visible (comportamiento histórico): los defaults son true y
// parsePermissions solo pisa las claves presentes.
export type StaffPermissions = {
  contact: boolean;      // teléfono/correo de clientes y botones de llamada/WhatsApp
  amounts: boolean;      // precios de servicios y totales gastados
  clients_tab: boolean;  // pestaña de Clientes completa
};

export const DEFAULT_PERMISSIONS: StaffPermissions = { contact: true, amounts: true, clients_tab: true };

export function parsePermissions(raw: any): StaffPermissions {
  return { ...DEFAULT_PERMISSIONS, ...(raw && typeof raw === "object" ? raw : {}) };
}

// Permisos de la cuenta staff logueada. Mientras carga devuelve los defaults
// (todo visible), igual que una fila sin permisos configurados.
export function useStaffPermissions(): StaffPermissions {
  const { user } = useAuth();
  const [perms, setPerms] = useState<StaffPermissions>(DEFAULT_PERMISSIONS);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from("professionals")
      .select("permissions")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setPerms(parsePermissions(data.permissions));
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  return perms;
}
