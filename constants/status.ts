import type { Ionicons } from "@expo/vector-icons";
import { Colors } from "./theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// bg es el color del estado con transparencia: tiñe igual sobre la card clara
// y sobre la oscura. Los pasteles fijos de antes (#fef9eb, #eff2ff...) quedaban
// como parches blancos en modo oscuro.
export const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: IoniconName }> = {
  pending:   { label: "Pendiente",  color: "#f59e0b",      bg: "rgba(245,158,11,0.12)",  icon: "time-outline" },
  confirmed: { label: "Confirmada", color: Colors.blue,    bg: "rgba(0,39,254,0.10)",    icon: "checkmark-circle-outline" },
  completed: { label: "Completada", color: Colors.success, bg: "rgba(16,185,129,0.12)",  icon: "checkmark-done-circle-outline" },
  cancelled: { label: "Cancelada",  color: Colors.subtle,  bg: "rgba(115,108,130,0.12)", icon: "close-circle-outline" },
  no_show:   { label: "No asistió", color: Colors.red,     bg: "rgba(251,15,5,0.10)",    icon: "alert-circle-outline" },
};

export const STATUS_OPTIONS = Object.entries(STATUS_META).map(([status, meta]) => ({
  status,
  label: meta.label,
  color: meta.color,
  icon: meta.icon,
}));
