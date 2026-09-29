import { Linking } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import DetalleCobro, { type CobroDetalle } from "@/components/cobros/DetalleCobro";

// El detalle de un cobro reemplaza a la papelera de cada tarjeta: muestra qué
// se cobró y cómo se pagó, y desde ahí se envía el recibo, se factura o se anula.
jest.mock("@/lib/tenant", () => ({ useTenant: () => ({ timezone: "America/Bogota", tenant: { name: "Barbería Prueba" } }) }));
jest.mock("@/components/AnularCobroModal", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: ({ cobro }: { cobro: { id: string } | null }) => (cobro ? <Text>Confirmar anulación {cobro.id}</Text> : null),
  };
});

const base: CobroDetalle = {
  id: "venta-1",
  created_at: "2026-09-26T01:30:00Z", // 25-sep 8:30 PM en Bogotá
  total: 45000,
  subtotal: 50000,
  payment_method: "mixto",
  payments: [{ method: "efectivo", amount: 25000 }, { method: "nequi", amount: 20000 }],
  note: "Corte + 2× Cera",
  appointment_id: "cita-1",
  clients: { name: "Ana María", phone: "3001234567" },
  pos_sale_items: [{ name: "Corte", price: 30000, quantity: 1 }, { name: "Cera", price: 10000, quantity: 2 }],
};

test("muestra ítems, descuento y el desglose del pago dividido", async () => {
  await render(<DetalleCobro cobro={base} onClose={() => {}} onAnulado={() => {}} />);
  expect(screen.getByText("Cera × 2")).toBeOnTheScreen();
  expect(screen.getByText("Descuento")).toBeOnTheScreen();
  expect(screen.getByText("Pago dividido")).toBeOnTheScreen();
  expect(screen.getByText("Efectivo")).toBeOnTheScreen();
  expect(screen.getByText("Nequi")).toBeOnTheScreen();
  // La nota por defecto son los mismos ítems: no se repite.
  expect(screen.queryByText("Nota")).toBeNull();
  // Fecha y hora en la zona del negocio.
  expect(screen.getByText(/vie 25 sep · 8:30/)).toBeOnTheScreen();
});

test("recibo por WhatsApp con el teléfono del cliente", async () => {
  const abrir = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<DetalleCobro cobro={base} onClose={() => {}} onAnulado={() => {}} />);
  await fireEvent.press(screen.getByRole("button", { name: "Enviar recibo por WhatsApp" }));
  expect(abrir).toHaveBeenCalledWith(expect.stringContaining("https://wa.me/573001234567?text="));
  abrir.mockRestore();
});

test("sin teléfono no ofrece recibo, y Facturar solo si se puede", async () => {
  const onFacturar = jest.fn();
  const { rerender } = await render(
    <DetalleCobro cobro={{ ...base, clients: { name: "Ana" } }} onClose={() => {}} onAnulado={() => {}} />,
  );
  expect(screen.queryByRole("button", { name: "Enviar recibo por WhatsApp" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Emitir factura electrónica" })).toBeNull();
  await rerender(<DetalleCobro cobro={base} onFacturar={onFacturar} onClose={() => {}} onAnulado={() => {}} />);
  await fireEvent.press(screen.getByRole("button", { name: "Emitir factura electrónica" }));
  expect(onFacturar).toHaveBeenCalled();
});

test("Anular abre la confirmación con contraseña encima", async () => {
  await render(<DetalleCobro cobro={base} onClose={() => {}} onAnulado={() => {}} />);
  expect(screen.queryByText(/Confirmar anulación/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Anular cobro" }));
  expect(screen.getByText("Confirmar anulación venta-1")).toBeOnTheScreen();
});
