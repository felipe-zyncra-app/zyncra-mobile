import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type ClientLite = { id: string; name: string; phone: string };

// Las listas locales de clientes se cargan con limit(150); este hook busca en el
// servidor (debounce 300ms) para que los clientes fuera de ese corte también aparezcan.
// Devuelve null mientras la búsqueda no aplica (query corta) — el caller usa su filtro local.
export function useClientSearch(tenantId: string | null | undefined, query: string): ClientLite[] | null {
  const [results, setResults] = useState<ClientLite[] | null>(null);

  useEffect(() => {
    const q = query.trim().replace(/[%,()]/g, "");
    if (!tenantId || q.length < 2) { setResults(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, phone")
        .eq("tenant_id", tenantId)
        .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
        .order("name")
        .limit(30);
      if (!cancelled) setResults((data ?? []).map(c => ({ ...c, phone: c.phone ?? "" })));
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tenantId, query]);

  return results;
}
