import { useState, useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, SectionLabel } from "@/components/ui";
import { HELP_CATEGORIES, type HelpArticle, type HelpCategory, type CategoryIconName } from "@/lib/help-content";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Mapeo de los íconos del portal web a Ionicons
const ICONS: Record<CategoryIconName, IoniconName> = {
  Zap:        "flash-outline",
  Calendar:   "calendar-outline",
  Users:      "people-outline",
  CreditCard: "card-outline",
  ChartBar:   "bar-chart-outline",
  Chat:       "logo-whatsapp",
  Palette:    "color-palette-outline",
};
const CAT_COLORS: Record<CategoryIconName, string> = {
  Zap: "#f59e0b", Calendar: Colors.red, Users: Colors.blue,
  CreditCard: Colors.success, ChartBar: "#8b5cf6", Chat: "#25D366", Palette: "#ec4899",
};

const allArticles = (): HelpArticle[] => HELP_CATEGORIES.flatMap(c => c.articles);

// ─── Lector de artículo (pasos) ───────────────────────────────────────────────
function ArticleModal({ article, category, onClose }: {
  article: HelpArticle; category: HelpCategory; onClose: () => void;
}) {
  const { t } = useTheme();
  const color = CAT_COLORS[category.iconName];
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[m.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={m.accent} />
          <View style={m.headerRow}>
            <TouchableOpacity onPress={onClose} style={m.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={m.crumb}>{category.label}</Text>
              <Text style={m.title} numberOfLines={2}>{article.title}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
          <View style={m.metaRow}>
            <View style={[m.metaChip, { backgroundColor: color + "16" }]}>
              <Ionicons name="time-outline" size={13} color={color} />
              <Text style={[m.metaText, { color }]}>{article.readMinutes} min de lectura</Text>
            </View>
          </View>
          <Text style={[m.desc, { color: t.muted }]}>{article.description}</Text>

          {article.steps.map((step, i) => (
            <View key={i} style={m.step}>
              <View style={m.stepLeft}>
                <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={m.stepNum}>
                  <Text style={m.stepNumText}>{i + 1}</Text>
                </LinearGradient>
                {i < article.steps.length - 1 && <View style={[m.stepLine, { backgroundColor: t.line }]} />}
              </View>
              <View style={{ flex: 1, paddingBottom: 22 }}>
                <Text style={[m.stepTitle, { color: t.ink }]}>{step.title}</Text>
                <Text style={[m.stepBody, { color: t.muted }]}>{step.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Pantalla principal ────────────────────────────────────────────────────────
export default function HelpScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [query, setQuery] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [reading, setReading] = useState<{ a: HelpArticle; c: HelpCategory } | null>(null);

  const isSearching = query.trim().length > 0;
  const results = useMemo<HelpArticle[]>(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return allArticles().filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.steps.some(s => s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q))
    );
  }, [query]);

  const catOf = (id: string) => HELP_CATEGORIES.find(c => c.id === id)!;
  const openArticle = (a: HelpArticle) => setReading({ a, c: catOf(a.category) });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader
        crumb="Soporte"
        title="Centro de ayuda"
        subtitle={`${allArticles().length} guías para sacarle todo a Zyncra`}
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Buscador */}
        <View style={[s.search, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <Ionicons name="search-outline" size={17} color={t.subtle} />
          <TextInput
            style={[s.searchInput, { color: t.ink }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Busca cómo hacer algo…"
            placeholderTextColor={t.subtle}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={18} color={t.subtle} />
            </TouchableOpacity>
          )}
        </View>

        {isSearching ? (
          /* Resultados de búsqueda */
          <View style={{ marginTop: 18 }}>
            <SectionLabel>{results.length} resultado{results.length !== 1 ? "s" : ""}</SectionLabel>
            {results.length === 0 ? (
              <Card><View style={{ padding: 28, alignItems: "center" }}>
                <Ionicons name="help-buoy-outline" size={34} color={t.subtle} />
                <Text style={[s.emptyText, { color: t.muted }]}>No encontramos guías para “{query}”. Prueba con otras palabras.</Text>
              </View></Card>
            ) : (
              results.map(a => {
                const c = catOf(a.category);
                return <ArticleRow key={a.slug} article={a} category={c} onPress={() => openArticle(a)} />;
              })
            )}
          </View>
        ) : (
          /* Categorías */
          <View style={{ marginTop: 18, gap: 10 }}>
            <SectionLabel>Temas de ayuda</SectionLabel>
            {HELP_CATEGORIES.map((cat, i) => {
              const color = CAT_COLORS[cat.iconName];
              const expanded = openCat === cat.id;
              return (
                <Animated.View key={cat.id} entering={FadeInDown.delay(i * 40).duration(320)}>
                  <Card>
                    <TouchableOpacity style={s.catHead} onPress={() => setOpenCat(expanded ? null : cat.id)} activeOpacity={0.7}>
                      <View style={[s.catIcon, { backgroundColor: color + "16" }]}>
                        <Ionicons name={ICONS[cat.iconName]} size={19} color={color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.catLabel, { color: t.ink }]}>{cat.label}</Text>
                        <Text style={[s.catDesc, { color: t.subtle }]} numberOfLines={1}>{cat.description}</Text>
                      </View>
                      <View style={[s.catCount, { backgroundColor: t.chipBg }]}>
                        <Text style={[s.catCountText, { color: t.muted }]}>{cat.articles.length}</Text>
                      </View>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={17} color={t.subtle} />
                    </TouchableOpacity>

                    {expanded && (
                      <View style={[s.catBody, { borderTopColor: t.divider }]}>
                        {cat.articles.map((a, ai) => (
                          <TouchableOpacity
                            key={a.slug}
                            style={[s.artRow, ai < cat.articles.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
                            onPress={() => openArticle(a)}
                            activeOpacity={0.6}
                          >
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={[s.artTitle, { color: t.ink }]}>{a.title}</Text>
                              <Text style={[s.artMeta, { color: t.subtle }]}>{a.readMinutes} min · {a.steps.length} pasos</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={15} color={t.subtle} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </Card>
                </Animated.View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {reading && (
        <ArticleModal article={reading.a} category={reading.c} onClose={() => setReading(null)} />
      )}
    </SafeAreaView>
  );
}

// Fila de artículo (resultados de búsqueda)
function ArticleRow({ article, category, onPress }: {
  article: HelpArticle; category: HelpCategory; onPress: () => void;
}) {
  const { t } = useTheme();
  const color = CAT_COLORS[category.iconName];
  return (
    <Card style={{ marginBottom: 10 }}>
      <TouchableOpacity style={s.artRow2} onPress={onPress} activeOpacity={0.6}>
        <View style={[s.catIcon, { backgroundColor: color + "16" }]}>
          <Ionicons name={ICONS[category.iconName]} size={18} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.artTitle, { color: t.ink }]} numberOfLines={1}>{article.title}</Text>
          <Text style={[s.artMeta, { color: t.subtle }]}>{category.label} · {article.readMinutes} min</Text>
        </View>
        <Ionicons name="chevron-forward" size={15} color={t.subtle} />
      </TouchableOpacity>
    </Card>
  );
}

const s = StyleSheet.create({
  search:      { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13 },
  searchInput: { flex: 1, fontSize: 14.5, fontFamily: Fonts.regular },
  emptyText:   { fontSize: 13.5, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 20, marginTop: 12 },

  catHead:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  catIcon:   { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  catLabel:  { fontSize: 14.5, fontFamily: Fonts.semibold },
  catDesc:   { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  catCount:  { minWidth: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 7 },
  catCountText: { fontSize: 12, fontFamily: Fonts.monoBold },
  catBody:   { borderTopWidth: 1, paddingHorizontal: 14 },
  artRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  artRow2:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  artTitle:  { fontSize: 13.5, fontFamily: Fonts.semibold },
  artMeta:   { fontSize: 11.5, fontFamily: Fonts.mono, marginTop: 2 },
});

const m = StyleSheet.create({
  header:    { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 18 },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  closeBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  crumb:     { fontSize: 10, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(255,255,255,.55)" },
  title:     { fontSize: 17, fontFamily: Fonts.bold, color: "white", marginTop: 3, letterSpacing: -0.3 },
  metaRow:   { flexDirection: "row", marginBottom: 14 },
  metaChip:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20 },
  metaText:  { fontSize: 12, fontFamily: Fonts.semibold },
  desc:      { fontSize: 15, fontFamily: Fonts.regular, lineHeight: 22, marginBottom: 24 },
  step:      { flexDirection: "row", gap: 14 },
  stepLeft:  { alignItems: "center", width: 30 },
  stepNum:   { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 13, fontFamily: Fonts.bold, color: "white" },
  stepLine:  { width: 2, flex: 1, marginTop: 4 },
  stepTitle: { fontSize: 15, fontFamily: Fonts.bold, marginBottom: 6, marginTop: 3 },
  stepBody:  { fontSize: 14, fontFamily: Fonts.regular, lineHeight: 21 },
});
