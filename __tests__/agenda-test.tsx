import { render, screen, fireEvent } from "@testing-library/react-native";
import { OtherTimeField } from "@/components/OtherTimeField";
import SemanaStrip from "@/components/agenda/SemanaStrip";
import ApptDetailModal from "@/components/agenda/ApptDetailModal";
import type { ApptAgenda } from "@/components/agenda/tipos";
import { fmtMoneyFull } from "@/lib/format";

// El detalle de cita consulta pos_sales: mockVentas es lo que responde.
// (jest.mock se eleva sobre los imports; la variable solo se lee al resolver.)
let mockVentas: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(mockVentas).then(res, rej);
      return b;
    },
  },
}));

const cita: ApptAgenda = {
  id: "cita-1",
  appointment_date: "2026-09-28",
  appointment_time: "10:00:00",
  status: "confirmed",
  service_id: "svc-1",
  client_id: "cli-1",
  professional_id: "pro-1",
  clients: { name: "Ana" },
  services: { name: "Corte", price: 20000 },
  professionals: { id: "pro-1", name: "Laura" },
  appointment_services: [{ price: 5000 }],
};

function abrirDetalle(appt: ApptAgenda = cita) {
  const props = {
    onClose: jest.fn(), onCambiarEstado: jest.fn(), onEditar: jest.fn(), onCobrar: jest.fn(), onIrAlHistorial: jest.fn(),
  };
  return { props, render: () => render(<ApptDetailModal appt={appt} {...props} />) };
}

// Piezas compartidas de la agenda: "Otra hora" ya no adivina ni descarta en
// silencio, y la tira de la semana muestra el domingo en su semana.
describe("agenda", () => {
  test("Otra hora: una hora clara se elige y una ambigua se explica", async () => {
    const onChange = jest.fn();
    await render(<OtherTimeField value={null} inGrid={false} onChange={onChange} />);
    const input = screen.getByLabelText("Otra hora, en formato de 24 horas");

    await fireEvent.changeText(input, "12:5");
    await fireEvent(input, "blur");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/No entendimos esa hora/)).toBeOnTheScreen();

    await fireEvent.changeText(input, "11:10");
    await fireEvent(input, "blur");
    expect(onChange).toHaveBeenCalledWith("11:10");
  });

  test("Otra hora: muestra el aviso de una hora fuera de la jornada", async () => {
    await render(<OtherTimeField value="21:30" inGrid={false} onChange={() => {}} aviso="Termina después del cierre (7:00 PM)." />);
    expect(screen.getByText("Elegida: 9:30 PM")).toBeOnTheScreen();
    expect(screen.getByText("Termina después del cierre (7:00 PM).")).toBeOnTheScreen();
  });

  test("SemanaStrip: un domingo aparece en su semana, marcado como hoy", async () => {
    const onSeleccionar = jest.fn();
    const onCambiarSemana = jest.fn();
    await render(
      <SemanaStrip
        semana="2026-09-27"
        seleccionado="2026-09-27"
        hoy="2026-09-27"
        onSeleccionar={onSeleccionar}
        onCambiarSemana={onCambiarSemana}
        deshabilitado={d => d < "2026-09-27"}
      />,
    );
    expect(screen.getByRole("button", { name: "domingo 27 de septiembre, hoy" })).toBeOnTheScreen();
    // Un día pasado no se puede elegir.
    await fireEvent.press(screen.getByRole("button", { name: "lunes 21 de septiembre" }));
    expect(onSeleccionar).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(onCambiarSemana).toHaveBeenCalledWith("2026-09-28");
  });

  test("Detalle: 'Cobrar' suma los servicios adicionales y 'Completada' abre el cobro (DIN-23 / D10)", async () => {
    mockVentas = { data: [], error: null };
    const { props, render: pintar } = abrirDetalle();
    await pintar();
    expect(await screen.findByText(`Cobrar esta cita · ${fmtMoneyFull(25000)}`)).toBeOnTheScreen();
    expect(screen.getByText("Corte + 1 adicional")).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Completada" }));
    expect(props.onCobrar).toHaveBeenCalledTimes(1);
    expect(props.onCambiarEstado).not.toHaveBeenCalled();

    // Cerrar y Modificar son botones con nombre para el lector de pantalla (CAL-24).
    await fireEvent.press(screen.getByRole("button", { name: "Modificar cita" }));
    expect(props.onEditar).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Cerrar" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  test("Detalle: una cita ya cobrada no ofrece cobrar otra vez", async () => {
    mockVentas = { data: [{ id: "venta-1", total: 25000 }], error: null };
    const { props, render: pintar } = abrirDetalle();
    await pintar();
    expect(await screen.findByText(`Cita cobrada · ${fmtMoneyFull(25000)}. Quedó en la caja.`)).toBeOnTheScreen();
    expect(screen.queryByText(/Cobrar esta cita/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Cancelada" }));
    expect(props.onCambiarEstado).not.toHaveBeenCalled();
  });
});
