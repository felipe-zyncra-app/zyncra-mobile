import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const { t } = useTheme();
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;
  if (role === "staff") return <Redirect href="/(staff)/agenda" />;
  return <Redirect href="/(admin)/(tabs)" />;
}
