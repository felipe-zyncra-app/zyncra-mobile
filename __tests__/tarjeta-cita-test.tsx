import { render, screen, fireEvent } from "@testing-library/react-native";
import TarjetaCita, { porCobrar, type CitaCobro } from "@/components/cobros/TarjetaCita";

const cita = (extra: Partial<CitaCobro> = {}): CitaCobro => ({
  id: "c1",
  appointment_time: "15:00:00",
  status: "confirmed",
  client_id: "cl1",
  service_id: "s1",
  location_id: null,
  clients: { name: "Ana" },
  services: { name: "Corte", price: 30000 },
  appointment_services: [{ price: 5000 }],
  pos_sales: [],
  ...extra,
});

test("por cobrar: el botón lleva el precio con los adicionales y lo demás va en Más", async () => {
  const onCobrar = jest.fn();
  const onMas = jest.fn();
  await render(<TarjetaCita cita={cita()} index={0} onCobrar={onCobrar} onMas={onMas} />);
  expect(screen.getByText("Corte + 1 adicional")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: /Cobrar .*35\.000 a Ana/ }));
  expect(onCobrar).toHaveBeenCalled();
  // Cancelar ya no está al lado de Cobrar.
  expect(screen.queryByText("Cancelar")).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Más opciones para la cita de Ana" }));
  expect(onMas).toHaveBeenCalled();
});

test("completada sin cobro sigue por cobrar y lo avisa", async () => {
  const c = cita({ status: "completed" });
  expect(porCobrar(c)).toBe(true);
  await render(<TarjetaCita cita={c} index={0} onCobrar={() => {}} onMas={() => {}} />);
  expect(screen.getByText("Completada sin cobro")).toBeOnTheScreen();
});

test("cobrada: fila compacta con el método, sin botón de cobrar", async () => {
  const onVer = jest.fn();
  const c = cita({ status: "completed", pos_sales: [{ total: 35000, payment_method: "nequi" }] });
  expect(porCobrar(c)).toBe(false);
  await render(<TarjetaCita cita={c} index={0} onVerCobro={onVer} />);
  expect(screen.getByText("Nequi")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /^Cobrar/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /cobrada/ }));
  expect(onVer).toHaveBeenCalled();
});

test("cancelada o no asistió: solo se rotula", async () => {
  await render(<TarjetaCita cita={cita({ status: "no_show" })} index={0} />);
  expect(screen.getByText("No asistió")).toBeOnTheScreen();
  expect(screen.queryByRole("button")).toBeNull();
});
