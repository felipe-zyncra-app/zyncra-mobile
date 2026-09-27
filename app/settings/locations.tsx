import { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Image,
} from "react-native";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { activeLocationStorageKey, setActiveLocationId } from "@/lib/active-location";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { exigirFilas, mensajeError, traerTodo } from "@/lib/db";
import { fmtTelefono } from "@/lib/format";

type Loc = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  image_url: string | null;
  is_active: boolean;
};

export default function LocationsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const guard = useGuardRespuestas();
  const [locations, setLocations] = useState<Loc[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const locs = await traerTodo<Loc>((d, h) =>
        supabase
          .from("locations")
          .select("id, name, address, phone, image_url, is_active")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("created_at").order("id")
          .range(d, h),
      { contexto: "No se pudieron cargar tus sedes" });
      const saved = await AsyncStorage.getItem(activeLocationStorageKey(tenantId)).catch(() => null);
      if (!turno.vigente()) return;
      setLocations(locs);
      // Misma resolución que lib/active-location: elegida y válida, o la principal
      if (saved && locs.some(l => l.id === saved)) setActiveId(saved);
      else setActiveId(locs[0]?.id ?? null);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  /**
   * setActiveLocationId guarda la elección Y avisa a las pantallas abiertas
   * (Panel, Agenda, Cobros recargan con la sede nueva). Antes solo se
   * limpiaba el caché: las pestañas montadas seguían mostrando la sede
   * anterior mientras lo nuevo se escribía en la elegida (ARQ-10).
   */
  const selectLocation = async (loc: Loc) => {
    if (!tenantId || loc.id === activeId) return;
    setActiveId(loc.id);
    await setActiveLocationId(tenantId, loc.id);
  };

  const changePhoto = async (loc: Loc) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;

    setUploadingId(loc.id);
    try {
      // Mismo bucket/path que usa el panel web para las fotos de sede
      const subida = await new Promise<{ url: string | null; error: unknown }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", result.assets[0].uri);
        xhr.responseType = "blob";
        xhr.onload = async () => {
          try {
            const blob: Blob = xhr.response;
            const path = `${tenantId}/locations/${Date.now()}.jpg`;
            const { error } = await supabase.storage
              .from("web")
              .upload(path, blob, { contentType: "image/jpeg", upsert: true });
            if (error) { resolve({ url: null, error }); return; }
            const { data } = supabase.storage.from("web").getPublicUrl(path);
            resolve({ url: data.publicUrl, error: null });
          } catch (e) {
            resolve({ url: null, error: e });
          }
        };
        xhr.onerror = () => resolve({ url: null, error: new Error("No se pudo leer la foto del teléfono.") });
        xhr.send();
      });

      if (!subida.url) {
        Alert.alert("No se pudo subir la foto", mensajeError(subida.error));
        return;
      }
      exigirFilas(
        await supabase.from("locations").update({ image_url: subida.url }).eq("id", loc.id).select("id"),
        "No se pudo guardar la foto",
      );
      setLocations(prev => (prev ?? []).map(l => l.id === loc.id ? { ...l, image_url: subida.url } : l));
    } catch (e) {
      Alert.alert("No se pudo guardar la foto", mensajeError(e));
    } finally {
      setUploadingId(null);
    }
  };

  const total = locations?.length ?? 0;

  if (error && !locations) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScreenHeader crumb="Negocio" title="Sedes" onBack={() => router.back()} />
        <ErrorState error={error} onRetry={recargar} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Sedes"
        subtitle={locations ? `${total} activa${total !== 1 ? "s" : ""}` : "Cargando…"}
        onBack={() => router.back()}
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {error ? (
          <View style={[s.hint, { backgroundColor: Colors.red + "12", borderColor: Colors.red + "33" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
            <Text style={[s.hintText, { color: t.text }]}>{mensajeError(error)}</Text>
          </View>
        ) : null}

        {locations === null ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : locations.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <Ionicons name="location-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin sedes registradas</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>Crea tus sedes desde el panel web en Negocio → Sedes.</Text>
          </Animated.View>
        ) : (
          <>
            {locations.length > 1 && (
              <Animated.View entering={FadeInDown.duration(400)} style={[s.hint, { backgroundColor: Colors.blue + "0D", borderColor: Colors.blue + "30" }]}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.blue} />
                <Text style={[s.hintText, { color: t.muted }]}>
                  La sede activa se estampa en las citas, cobros y caja que crees desde el celular, y el Panel, la Agenda y Cobros muestran esa sede.
                </Text>
              </Animated.View>
            )}

            {locations.map((loc, i) => {
              const isActive = loc.id === activeId;
              return (
                <Animated.View key={loc.id} entering={i < 8 ? FadeInRight.delay(i * 60).duration(320) : undefined}>
                  <TouchableOpacity
                    style={[s.row, Shadow.sm, { backgroundColor: t.card, borderColor: isActive ? Colors.red : t.cardBorder }, isActive && { borderWidth: 1.5 }]}
                    onPress={() => selectLocation(loc)}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isActive }}
                    accessibilityLabel={`${loc.name}${loc.address ? `, ${loc.address}` : ""}`}
                    // En iOS la fila agrupa a sus hijos y el botón de la foto no
                    // recibe el foco de VoiceOver: se ofrece como acción de la fila.
                    accessibilityActions={[{ name: "cambiarFoto", label: `Cambiar foto de ${loc.name}` }]}
                    onAccessibilityAction={e => { if (e.nativeEvent.actionName === "cambiarFoto") changePhoto(loc); }}
                  >
                    <TouchableOpacity onPress={() => changePhoto(loc)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`Cambiar foto de ${loc.name}`}>
                      {loc.image_url ? (
                        <Image source={{ uri: loc.image_url }} style={s.photo} />
                      ) : (
                        <View style={[s.photo, s.photoEmpty, { backgroundColor: Colors.blue + "10" }]}>
                          <Ionicons name="location-outline" size={20} color={Colors.blue} />
                        </View>
                      )}
                      <View style={[s.photoBadge, { borderColor: t.card }]}>
                        {uploadingId === loc.id
                          ? <ActivityIndicator size={10} color="white" />
                          : <Ionicons name="camera" size={11} color="white" />}
                      </View>
                    </TouchableOpacity>

                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{loc.name}</Text>
                        {isActive && (
                          <View style={s.activePill}>
                            <Text style={s.activePillText}>ACTIVA</Text>
                          </View>
                        )}
                      </View>
                      {loc.address ? <Text style={[s.info, { color: t.muted }]} numberOfLines={1}>{loc.address}</Text> : null}
                      {loc.phone ? <Text style={[s.info, { color: t.subtle }]}>{fmtTelefono(loc.phone)}</Text> : null}
                      <Text style={[s.photoHint, { color: t.subtle }]}>Toca la foto para cambiarla</Text>
                    </View>

                    <Ionicons
                      name={isActive ? "radio-button-on" : "radio-button-off"}
                      size={20}
                      color={isActive ? Colors.red : t.subtle}
                    />
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hint:       { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 14 },
  hintText:   { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 17 },
  row:        { borderRadius: Radius.md, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  photo:      { width: 54, height: 54, borderRadius: 14 },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  photoBadge: { position: "absolute", bottom: -3, right: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.ink, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 1 },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  photoHint:  { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", marginTop: 4 },
  activePill: { backgroundColor: Colors.red + "14", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.red + "35" },
  activePillText: { fontSize: 8.5, fontFamily: "JetBrainsMono_700Bold", color: Colors.red, letterSpacing: 0.5 },
  empty:      { borderRadius: Radius.xl, borderWidth: 1, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
});
