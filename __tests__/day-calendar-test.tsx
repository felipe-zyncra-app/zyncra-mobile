import { render, screen, fireEvent } from "@testing-library/react-native";
import DayCalendar, { COLUMNA_OTROS, type ColumnaAgenda } from "@/components/agenda/DayCalendar";
import type { ApptAgenda } from "@/components/agenda/tipos";

// La agenda del teléfono con columnas por profesional (como la vista por
// profesional del web) y huecos que se tocan para agendar.

const DIA = "2099-03-10"; // futuro: los huecos se ofrecen
const horario = { open: true, start: "09:00", end: "13:00" };
const cita = (id: string, hora: string, pro: { id: string; name: string } | null, status = "confirmed"): ApptAgenda => ({
  id, appointment_date: DIA, appointment_time: `${hora}:00`, status, service_id: "s1", client_id: "c1",
  professional_id: pro?.id ?? null, location_id: null, imported: false,
  clients: { name: `Cliente ${id}`, phone: "300" }, services: { name: "Corte", price: 1, duration_minutes: 30 },
  professionals: pro, appointment_services: [],
} as unknown as ApptAgenda);

const columnas: ColumnaAgenda[] = [
  { id: "p1", nombre: "Sergio González", iniciales: "SG", color: "#f00", horario },
  { id: "p2", nombre: "Laura Velásquez", iniciales: "LV", color: "#00f", horario: { open: false, start: "09:00", end: "13:00" } },
];

const base = {
  dia: DIA, hoy: "2099-03-01", timezone: "America/Bogota", bloqueos: [], horarios: [horario],
  ventas: new Map(), cruzadas: new Set<string>(), onPressAppt: () => {}, onAddPress: () => {},
  showPro: false, refreshing: false, onRefresh: () => {},
};

test("una columna por profesional, con cuántas citas tiene o si no atiende", async () => {
  await render(<DayCalendar {...base} columnas={columnas} citas={[cita("a", "09:00", { id: "p1", name: "Sergio González" })]} />);
  expect(screen.getByText("Sergio")).toBeOnTheScreen();
  expect(screen.getByText("1 cita")).toBeOnTheScreen();
  expect(screen.getAllByText("No atiende").length).toBeGreaterThan(0);
  // Laura no atiende ese día: su columna no ofrece huecos.
  expect(screen.queryAllByLabelText(/con Laura Velásquez$/)).toHaveLength(0);
  expect(screen.getAllByLabelText(/con Sergio González$/).length).toBeGreaterThan(0);
});

test("tocar un hueco agenda a esa hora con ese profesional", async () => {
  const onPressHueco = jest.fn();
  await render(<DayCalendar {...base} columnas={columnas} citas={[]} onPressHueco={onPressHueco} />);
  await fireEvent.press(screen.getByLabelText("Agendar a las 10:30 AM con Sergio González"));
  expect(onPressHueco).toHaveBeenCalledWith("10:30", "p1");
});

test("tocar el nombre de una columna deja solo a ese profesional", async () => {
  const onElegirColumna = jest.fn();
  await render(<DayCalendar {...base} columnas={columnas} citas={[]} onElegirColumna={onElegirColumna} />);
  await fireEvent.press(screen.getByLabelText(/^Laura Velásquez, 0 citas/));
  expect(onElegirColumna).toHaveBeenCalledWith("p2");
});

test("las citas de alguien sin columna no se pierden", async () => {
  const otros: ColumnaAgenda = { id: COLUMNA_OTROS, nombre: "Sin asignar", iniciales: "?", color: "#999", horario: null };
  await render(<DayCalendar {...base} columnas={[...columnas, otros]} citas={[cita("x", "11:00", { id: "p9", name: "Ex Empleado" })]} />);
  expect(screen.getByText("Cliente x")).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Sin asignar, 1 cita/)).toBeOnTheScreen();
});

test("un día pasado no ofrece huecos para agendar", async () => {
  const onPressHueco = jest.fn();
  await render(<DayCalendar {...base} dia="2099-02-01" columnas={null} citas={[]} onPressHueco={onPressHueco} />);
  expect(screen.queryAllByLabelText(/^Agendar a las/)).toHaveLength(0);
  expect(screen.getByText("No hubo citas.")).toBeOnTheScreen();
});
