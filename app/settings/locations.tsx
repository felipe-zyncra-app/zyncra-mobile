import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { activeLocationStorageKey, clearActiveLocationCache } from "@/lib/active-location";

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
  const [locations, setLocations] = useState<Loc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const load = async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("locations")
      .select("id, name, address, phone, image_url, is_active")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("created_at");
    const locs = (data ?? []) as Loc[];
    setLocations(locs);

    const saved = await AsyncStorage.getItem(activeLocationStorageKey(tenantId)).catch(() => null);
    // Misma resolución que lib/active-location: elegida y válida, o la principal
    if (saved && locs.some(l => l.id === saved)) setActiveId(saved);
    else setActiveId(locs[0]?.id ?? null);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const selectLocation = async (loc: Loc) => {
    if (!tenantId) return;
    setActiveId(loc.id);
    await AsyncStorage.setItem(activeLocationStorageKey(tenantId), loc.id).catch(() => {});
    clearActiveLocationCache(tenantId);
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
      const url = await new Promise<string | null>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", result.assets[0].uri);
        xhr.responseType = "blob";
        xhr.onload = async () => {
          const blob: Blob = xhr.response;
          const path = `${tenantId}/locations/${Date.now()}.jpg`;
          const { error } = await supabase.storage
            .from("web")
            .upload(path, blob, { contentType: "image/jpeg", upsert: true });
          if (error) { resolve(null); return; }
          const { data } = supabase.storage.from("web").getPublicUrl(path);
          resolve(data.publicUrl);
        };
        xhr.onerror = () => resolve(null);
        xhr.send();
      });

      if (!url) {
        Alert.alert("No se pudo subir la foto", "Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
      const { error } = await supabase.from("locations").update({ image_url: url }).eq("id", loc.id);
      if (error) {
        Alert.alert("No se pudo guardar la foto", "Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
      setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, image_url: url } : l));
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Sedes</Text>
            <Text style={s.headerSub}>{locations.length} activa{locations.length !== 1 ? "s" : ""}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {loading ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : locations.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
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
                  La sede activa se estampa en las citas, cobros y caja que crees desde el celular.
                </Text>
              </Animated.View>
            )}

            {locations.map((loc, i) => {
              const isActive = loc.id === activeId;
              return (
                <Animated.View key={loc.id} entering={i < 8 ? FadeInRight.delay(i * 60).duration(320) : undefined}>
                  <TouchableOpacity
                    style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt }, isActive && { borderWidth: 1.5, borderColor: Colors.red }]}
                    onPress={() => selectLocation(loc)}
                    activeOpacity={0.75}
                  >
                    <TouchableOpacity onPress={() => changePhoto(loc)} activeOpacity={0.7}>
                      {loc.image_url ? (
                        <Image source={{ uri: loc.image_url }} style={s.photo} />
                      ) : (
                        <View style={[s.photo, s.photoEmpty, { backgroundColor: Colors.blue + "10" }]}>
                          <Ionicons name="location-outline" size={20} color={Colors.blue} />
                        </View>
                      )}
                      <View style={s.photoBadge}>
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
                      {loc.phone ? <Text style={[s.info, { color: t.subtle }]}>{loc.phone}</Text> : null}
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
  header:     { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:  { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  hint:       { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 14 },
  hintText:   { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 17 },
  row:        { borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  photo:      { width: 54, height: 54, borderRadius: 14 },
  photoEmpty: { alignItems: "center", justifyContent: "center" },
  photoBadge: { position: "absolute", bottom: -3, right: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.ink, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "white" },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 1 },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  photoHint:  { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", marginTop: 4 },
  activePill: { backgroundColor: Colors.red + "14", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.red + "35" },
  activePillText: { fontSize: 8.5, fontFamily: "JetBrainsMono_700Bold", color: Colors.red, letterSpacing: 0.5 },
  empty:      { borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
});
