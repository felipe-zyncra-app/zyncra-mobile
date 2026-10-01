import { useEffect, useState } from "react";
import { View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import ErrorState from "@/components/ErrorState";
import type { ItemHistorial } from "@/lib/nomina";
import ColillaModal, { type ItemColilla } from "./ColillaModal";
import { FilaHistorial, useHistorialNomina } from "./HistorialComun";
import { Aviso, BotonNomina } from "./ResumenPiezas";
import { mensajeNomina } from "./ResumenTextos";
import type { PropsTabNomina } from "./tipos";

type Pro = { id: string; name: string };

/**
 * Historial de pagos (dueño): colillas de nómina y liquidaciones de comisión
 * de antes, más nuevas primero, con filtro por profesional y "Ver más". Cada
 * nómina abre su colilla, que se puede compartir o anular.
 */
export default function TabHistorial({ tenantId, timezone }: PropsTabNomina) {
  const { t } = useTheme();
  const [filtro, setFiltro] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<ItemHistorial | null>(null);
  const [pros, setPros] = useState<Pro[]>([]);
  const hist = useHistorialNomina({ tenantId, profesionalId: filtro, timeZone: timezone, version });

  // Solo para el filtro: si falla, no hay filtro y la lista sigue funcionando.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const { data, error } = await supabase.from("professionals").select("id, name").eq("tenant_id", tenantId).order("name");
        if (vivo && !error) setPros((data ?? []) as Pro[]);
      } catch {
        // sin filtro
      }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  const onRefresh = async () => { setRefreshing(true); await hist.recargar(); setRefreshing(false); };

  const alAnular = (it: ItemColilla) => {
    setAbierta(null);
    setAviso(`Se anuló la liquidación de ${it.profesional}. Lo que cubría volvió a quedar pendiente en el Resumen.`);
    setVersion(v => v + 1);
  };

  const cabecera = (
    <View style={{ gap: 12, marginBottom: 12 }}>
      {aviso ? <Aviso tono="ok" texto={aviso} onCerrar={() => setAviso(null)} /> : null}
      <Text style={[s.ayuda, { color: t.subtle }]}>Pagos registrados: liquidaciones de nómina y de comisiones.</Text>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {pros.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[s.filtros, { borderBottomColor: t.line }]}
          contentContainerStyle={s.filtrosDentro}
        >
          <Chip label="Todos" activo={filtro === null} onPress={() => setFiltro(null)} />
          {pros.map(p => (
            <Chip key={p.id} label={p.name} activo={filtro === p.id} onPress={() => setFiltro(prev => (prev === p.id ? null : p.id))} />
          ))}
        </ScrollView>
      ) : null}

      {hist.error && hist.items.length === 0 ? (
        <View style={{ flex: 1, minHeight: 260 }}>
          <ErrorState error={hist.error} message={mensajeNomina(hist.error)} onRetry={() => { void hist.recargar(); }} />
        </View>
      ) : !hist.cargado ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={hist.items}
          keyExtractor={it => `${it.tipo}-${it.id}`}
          contentContainerStyle={s.lista}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          ListHeaderComponent={cabecera}
          ListEmptyComponent={
            <View style={[s.caja, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              <Text style={[s.vacio, { color: t.muted }]}>
                {filtro ? "Esta persona todavía no tiene pagos registrados." : "Todavía no hay pagos registrados."}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <View style={[
              s.filaCaja,
              { backgroundColor: t.cardSolid, borderColor: t.line },
              index === 0 && s.primera,
              index === hist.items.length - 1 && s.ultima,
            ]}>
              <FilaHistorial it={item} timeZone={timezone} primero={index === 0} onPress={setAbierta} />
            </View>
          )}
          ListFooterComponent={
            <View style={{ alignItems: "center", paddingTop: 14, gap: 8 }}>
              {hist.hayMas ? (
                <BotonNomina chico tono="fantasma" label="Ver más" onPress={() => { void hist.verMas(); }} cargando={hist.cargandoMas} />
              ) : null}
              {hist.errorMas ? <Text style={[s.errorMas, { color: Colors.red }]}>{mensajeNomina(hist.errorMas)}</Text> : null}
              {hist.error && hist.items.length > 0 ? (
                <Text style={[s.errorMas, { color: Colors.red }]}>No se pudo actualizar: {mensajeNomina(hist.error)}</Text>
              ) : null}
            </View>
          }
        />
      )}

      {abierta ? (
        <ColillaModal
          tenantId={tenantId}
          timeZone={timezone}
          item={abierta}
          puedeAnular
          onClose={() => setAbierta(null)}
          onAnulada={alAnular}
        />
      ) : null}
    </View>
  );
}

function Chip({ label, activo, onPress }: { label: string; activo: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: activo }}
      style={[s.chip, { backgroundColor: activo ? t.ink : t.chipBg, borderColor: activo ? t.ink : t.line }]}
    >
      <Text style={[s.chipTxt, { color: activo ? t.cardSolid : t.muted }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  filtros:       { flexGrow: 0, borderBottomWidth: 1 },
  filtrosDentro: { paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: "row" },
  chip:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, maxWidth: 180 },
  chipTxt:       { fontSize: 12.5, fontFamily: Fonts.semibold },
  lista:         { padding: 20, paddingBottom: 110 },
  ayuda:         { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
  caja:          { borderWidth: 1, borderRadius: Radius.lg },
  // Bordes de los lados en cada fila; arriba solo la primera y abajo solo la
  // última: el separador entre filas lo pone FilaHistorial.
  filaCaja:      { borderLeftWidth: 1, borderRightWidth: 1, overflow: "hidden" },
  primera:       { borderTopWidth: 1, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  ultima:        { borderBottomWidth: 1, borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg },
  vacio:         { fontSize: 13.5, fontFamily: Fonts.regular, textAlign: "center", paddingVertical: 28, paddingHorizontal: 20 },
  errorMas:      { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center" },
});
