import { render, screen } from "@testing-library/react-native";
import { DesglosePendiente, Productividad } from "@/components/nomina/ResumenPiezas";
import { LineasNomina } from "@/components/nomina/DetalleLineas";
import ColillaModal from "@/components/nomina/ColillaModal";
import type { Linea, ResumenProfesional } from "@/lib/nomina";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));

// Mi nómina del profesional: las citas que atendió y su comisión, nunca el
// valor de los servicios ni de los productos (pedido de Imperio Capilar, 15-oct).

const linea = (p: Partial<Linea>): Linea => ({
  tipo: "servicio", professional_id: "p1", dia: "2026-10-03", cita_id: "c1", venta_id: null, item_id: null,
  service_id: "s1", nombre: "Corte clásico", cantidad: 1, valor: 40000, comision: 16000, regla: "general",
  cliente: "Andrés", hora: "10:00:00", liquidada: false, ...p,
});

const totales = { citas: 3, ventasServicios: 265000, comisionServicios: 46000, ventasProductos: 80000, comisionProductos: 8000 };
const pro: ResumenProfesional = {
  professional_id: "p1", nombre: "Sergio", activo: true, periodo: totales, comisionLiquidada: 0,
  pendiente: { tramosComision: [], comisiones: totales, basico: null, novedades: [], propinas: 0, bonos: 0, descuentos: 0, total: 54000 },
  lineas: [linea({}), linea({ tipo: "producto", nombre: "Serum", cantidad: 2, valor: 80000, comision: 8000, service_id: null, cita_id: null, venta_id: "v1" })],
  citasSinCerrar: 0, firma: "",
} as ResumenProfesional;

test("sin valores: citas, productos y comisión, nada de lo cobrado", async () => {
  await render(<>
    <DesglosePendiente pend={pro.pendiente} sinValores />
    <Productividad p={pro} sinValores />
    <LineasNomina lineas={pro.lineas} sinValores />
  </>);
  expect(screen.getAllByText("3 citas").length).toBeGreaterThan(0);
  expect(screen.getByText("Productos vendidos")).toBeOnTheScreen();
  expect(screen.getByText("2")).toBeOnTheScreen();
  expect(screen.getAllByText("$54.000").length).toBeGreaterThan(0);
  expect(screen.getAllByText("$16.000").length).toBeGreaterThan(0);
  for (const v of ["$265.000", "$80.000", "$40.000"]) expect(screen.queryByText(new RegExp(v.replace("$", "\\$")))).toBeNull();
  expect(screen.queryByText(/^de \$/)).toBeNull();
});

test("el dueño sí ve lo cobrado", async () => {
  await render(<>
    <DesglosePendiente pend={pro.pendiente} />
    <Productividad p={pro} />
    <LineasNomina lineas={pro.lineas} />
  </>);
  expect(screen.getByText("3 citas · $265.000 en servicios")).toBeOnTheScreen();
  expect(screen.getByText("$80.000 en productos")).toBeOnTheScreen();
  expect(screen.getByText("de $40.000")).toBeOnTheScreen();
});

jest.mock("@/lib/nomina", () => ({
  ...jest.requireActual("@/lib/nomina"),
  leerColilla: jest.fn(async () => ({
    liquidacion: {
      id: "3a5998b9-9ab9-464b-9f80-3cc890ecb2e5", professional_id: "p1", period_start: "2026-10-01", period_end: "2026-10-15",
      // Lo que manda el servidor al profesional: los valores en 0.
      appointments_count: 3, service_sales: 0, service_commission: 46000, product_sales: 0, product_commission: 8000,
      base_amount: 0, base_days: 0, tips_amount: 0, bonus_amount: 0, deduction_amount: 0, total_amount: 54000,
      note: null, paid_at: "2026-10-16T01:30:00Z",
      detail: {
        version: 1, profesional: "Sergio", desde: "2026-10-01", hasta: "2026-10-15", basico: null, novedades: [],
        lineas: [
          { tipo: "servicio", dia: "2026-10-03", hora: "10:00:00", cliente: "Andrés", nombre: "Corte", cantidad: 1, valor: 0, comision: 16000, regla: "general" },
          { tipo: "producto", dia: "2026-10-03", hora: null, cliente: "Andrés", nombre: "Serum", cantidad: 2, valor: 0, comision: 8000, regla: "producto" },
        ],
      },
    },
    profesional: { nombre: "Sergio", cargo: null },
    negocio: { nombre: "Imperio Capilar", logo: null },
  })),
}));

test("la colilla del profesional: citas, productos y comisiones, sin valores", async () => {
  await render(<ColillaModal tenantId="t" timeZone="America/Bogota" puedeAnular={false} sinValores onClose={() => {}}
    item={{ id: "3a5998b9-9ab9-464b-9f80-3cc890ecb2e5", profesional: "Sergio", period_start: "2026-10-01", period_end: "2026-10-15" }} />);
  expect(await screen.findByText("Comisión por productos")).toBeOnTheScreen();
  expect(screen.getByText("3 citas")).toBeOnTheScreen();
  expect(screen.getByText("2 productos")).toBeOnTheScreen();
  expect(screen.queryByText(/^de \$/)).toBeNull();
  expect(screen.queryByText(/· \$0/)).toBeNull();
});
