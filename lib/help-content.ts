/**
 * Centro de ayuda de la APP (no del portal web).
 *
 * Antes era una copia de las guías del portal: hablaba de "menú lateral",
 * "Negocio → Mi Marca", moneda, invitar admins de sede por correo, la URL
 * del webhook y variables con llaves simples ({nombre}) que la app no
 * reemplaza (COM-18). Aquí cada paso nombra pantallas y botones que existen
 * en el teléfono: las pestañas de abajo (Panel, Agenda, Clientes, Cobros,
 * Ajustes) y las entradas de Ajustes. lib/__tests__/help-content-test.ts
 * revisa que los nombres de "Ajustes → …" sigan existiendo en el menú.
 *
 * Regla de tiendas (iOS 3.1.1): nada de precios, planes ni suscripción aquí.
 */

export type CategoryIconName =
  | "Zap" | "Calendar" | "Users" | "CreditCard" | "ChartBar" | "Chat" | "Palette";

export interface HelpStep {
  title: string;
  body: string;
  /** Sin capturas por ahora: las del portal no corresponden a la app. */
  image: string | null;
}

export interface HelpArticle {
  slug: string;
  title: string;
  description: string;
  category: string;
  readMinutes: number;
  steps: HelpStep[];
}

export interface HelpCategory {
  id: string;
  label: string;
  description: string;
  iconName: CategoryIconName;
  articles: HelpArticle[];
}

const paso = (title: string, body: string): HelpStep => ({ title, body, image: null });

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "primeros-pasos",
    label: "Primeros pasos",
    description: "Deja tu negocio listo para recibir citas.",
    iconName: "Zap",
    articles: [
      {
        slug: "configuracion-inicial",
        title: "Configura los datos de tu negocio",
        description: "Nombre, contacto, zona horaria y tu página de reservas.",
        category: "primeros-pasos",
        readMinutes: 3,
        steps: [
          paso("Abre Info del negocio",
            "Toca Ajustes (la última pestaña de abajo) → Info del negocio. Ahí están el nombre, el teléfono, la dirección y la zona horaria."),
          paso("Revisa la zona horaria",
            "La zona horaria decide qué cuenta como \"hoy\" en la Agenda, en Cobros y en los reportes. Si tu negocio no está en Colombia, elígela aquí antes de empezar."),
          paso("Personaliza tu página de reservas",
            "En Ajustes → Mi Tienda sube tu logo, escribe el mensaje de bienvenida y elige los colores. Toca Guardar cambios."),
          paso("Comparte tu link",
            "Tu link de reservas aparece arriba en Ajustes y en Mi Tienda. Tócalo para compartirlo por WhatsApp, Instagram o donde quieras."),
        ],
      },
      {
        slug: "primer-servicio",
        title: "Cómo agregar tus servicios",
        description: "Crea el catálogo que tus clientes verán al reservar.",
        category: "primeros-pasos",
        readMinutes: 2,
        steps: [
          paso("Abre Servicios", "Ve a Ajustes → Servicios y toca + (arriba a la derecha)."),
          paso("Completa los datos",
            "Nombre, precio y duración en minutos son lo básico. El código es opcional: sirve para llamar el servicio por número en Cobros y en la Agenda. Las etiquetas ayudan a agruparlos."),
          paso("Guarda",
            "El servicio queda disponible para agendar, para cobrar y en tu página de reservas."),
          paso("Si dejas de ofrecerlo, archívalo",
            "Archivar lo saca de la agenda y de la reserva en línea, pero conserva su historial de citas y ventas. Un servicio que ya tiene citas no se puede borrar."),
        ],
      },
      {
        slug: "agregar-profesionales",
        title: "Cómo agregar a tu equipo",
        description: "Los profesionales que atienden las citas.",
        category: "primeros-pasos",
        readMinutes: 3,
        steps: [
          paso("Abre Equipo", "Ve a Ajustes → Equipo y toca +."),
          paso("Completa los datos",
            "Escribe el nombre, el cargo (por ejemplo Estilista) y sus días y horas de trabajo. Toca Agregar profesional."),
          paso("Dale acceso a la app (opcional)",
            "Abre de nuevo al profesional y, en Cuenta de acceso, escribe su correo y toca Crear cuenta de acceso. Podrá entrar a Zyncra y ver su agenda y sus clientes, según los permisos que le des."),
          paso("Cuando alguien deja el equipo, desactívalo",
            "Toca Desactivar profesional: deja de recibir citas, sale de la reserva en línea y pierde el acceso a la app. Sus citas, cobros y comisiones se conservan en los reportes, y puedes reactivarlo cuando quieras."),
        ],
      },
    ],
  },

  {
    id: "calendario",
    label: "Agenda y citas",
    description: "Crea, mueve, cancela y cobra citas.",
    iconName: "Calendar",
    articles: [
      {
        slug: "crear-cita",
        title: "Cómo crear una cita",
        description: "Agenda a un cliente desde el teléfono.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          paso("Abre la Agenda", "Toca la pestaña Agenda y elige el día."),
          paso("Toca Nueva cita", "Es el botón + de la Agenda."),
          paso("Sigue los pasos",
            "Elige el profesional, luego el cliente (uno existente o Nuevo cliente con nombre y teléfono), el servicio y la hora libre."),
          paso("Confirma",
            "Revisa el resumen y toca Confirmar cita. Si la hora se cruza con otra cita o está fuera del horario, la app te avisa antes de guardar."),
        ],
      },
      {
        slug: "reagendar-cancelar",
        title: "Cómo cambiar, cancelar o cobrar una cita",
        description: "Todo lo que puedes hacer desde el detalle de una cita.",
        category: "calendario",
        readMinutes: 3,
        steps: [
          paso("Abre la cita", "En la Agenda, toca la cita. Se abre su detalle."),
          paso("Cóbrala al terminar",
            "Toca Cobrar esta cita: el servicio y el cliente ya vienen cargados. Al cobrar, la cita queda Completada y el dinero entra en Cobros y en la caja."),
          paso("Cambia la fecha o la hora", "Toca Editar, elige el nuevo horario y guarda."),
          paso("Cancela o marca que no vino",
            "Cambia el estado a Cancelada o No asistió. Una cita que ya se cobró no se puede devolver a Pendiente ni a Confirmada: primero anula el cobro en Cobros → Historial de cobros."),
        ],
      },
      {
        slug: "horarios-negocio",
        title: "Cómo configurar el horario de atención",
        description: "Los días y horas en que se puede reservar.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          paso("Abre Horario de atención", "Ve a Ajustes → Horario de atención."),
          paso("Activa los días y define las horas",
            "Activa cada día que atiendes y pon la hora de apertura y de cierre. Si tienes almuerzo, agrega un descanso."),
          paso("Elige el intervalo entre turnos",
            "Define cada cuánto se ofrecen horas para reservar (por ejemplo, cada 30 minutos), contando desde la apertura."),
          paso("Guarda", "El horario se aplica a la reserva en línea y a Hanna en WhatsApp."),
        ],
      },
      {
        slug: "link-agendamiento",
        title: "Cómo compartir tu link de reservas",
        description: "Para que tus clientes reserven solos, a cualquier hora.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          paso("Encuentra tu link",
            "Está arriba en Ajustes y en Ajustes → Mi Tienda, con el botón para compartirlo o copiarlo. Tiene la forma zyncra.app/book/tu-negocio."),
          paso("Compártelo donde estén tus clientes",
            "En la bio de Instagram, en tu estado de WhatsApp, en Facebook o en tu perfil de Google."),
          paso("El cliente reserva sin ayuda",
            "Elige servicio, profesional, fecha y hora libre. La cita aparece en tu Agenda y te llega un aviso al teléfono si tienes activadas las notificaciones."),
        ],
      },
    ],
  },

  {
    id: "clientes",
    label: "Clientes",
    description: "Tu base de clientes y su historial.",
    iconName: "Users",
    articles: [
      {
        slug: "agregar-cliente",
        title: "Cómo agregar un cliente",
        description: "Registra a un cliente con sus datos de contacto.",
        category: "clientes",
        readMinutes: 2,
        steps: [
          paso("Abre Clientes", "Toca la pestaña Clientes y luego +."),
          paso("Completa los datos",
            "El nombre es obligatorio. En el teléfono elige el país con la bandera: así los enlaces de WhatsApp y las llamadas funcionan también con números de otros países."),
          paso("Datos opcionales", "Correo, documento, dirección, cumpleaños y notas (preferencias, alergias…)."),
          paso("Guarda", "Toca Crear cliente. Queda listo para agendarle citas y cobrarle."),
        ],
      },
      {
        slug: "historial-cliente",
        title: "Cómo ver el historial de un cliente",
        description: "Citas, asistencia y lo que ha gastado.",
        category: "clientes",
        readMinutes: 2,
        steps: [
          paso("Búscalo", "En Clientes, escribe su nombre o teléfono en el buscador."),
          paso("Abre su ficha", "Toca su nombre."),
          paso("Revisa su historial",
            "Verás cuántas citas tiene, cuántas completó, cuántas veces no asistió, cuánto ha gastado y sus notas. La etiqueta Nuevo, Recurrente, En riesgo o Perdido te dice hace cuánto no viene."),
        ],
      },
      {
        slug: "eliminar-cliente",
        title: "Cómo editar o eliminar un cliente",
        description: "Corregir datos y cuándo se puede borrar una ficha.",
        category: "clientes",
        readMinutes: 2,
        steps: [
          paso("Edita sus datos", "Abre la ficha del cliente, cambia lo que necesites y toca Guardar cambios."),
          paso("Solo se eliminan clientes sin historial",
            "Si el cliente tiene citas, cobros o historia clínica, su ficha no se puede eliminar: ese historial se conserva (la historia clínica, además, por obligación legal)."),
          paso("Eliminar una ficha vacía",
            "Si el cliente no tiene historial, toca el botón de eliminar en su ficha y confirma. No se puede deshacer."),
        ],
      },
    ],
  },

  {
    id: "pos",
    label: "Cobros y caja",
    description: "Cobra citas y ventas, maneja la caja y el inventario.",
    iconName: "CreditCard",
    articles: [
      {
        slug: "hacer-venta",
        title: "Cómo cobrar una cita o hacer una venta",
        description: "Servicios, productos, descuentos y medios de pago.",
        category: "pos",
        readMinutes: 3,
        steps: [
          paso("Abre Cobros",
            "En la pestaña Cobros verás las citas del día pendientes de cobro. Toca Cobrar en la cita, o + para una venta directa sin cita."),
          paso("Agrega lo que se vendió",
            "Puedes sumar otro servicio, productos del inventario (descuentan stock) o un ítem libre, como una propina."),
          paso("Aplica un descuento si toca", "En porcentaje o en valor fijo, sobre el total."),
          paso("Elige el medio de pago",
            "Efectivo, tarjeta, transferencia, Nequi, Daviplata o QR. Si el cliente paga con dos medios, usa Dividido."),
          paso("Confirma el cobro",
            "Toca Cobrar. La venta queda en Cobros y en la caja abierta, y la cita pasa a Completada. Una cita completada sin cobro aparece como por cobrar: no suma a tus ingresos."),
        ],
      },
      {
        slug: "anular-cobro",
        title: "Cómo anular un cobro",
        description: "Cuando un cobro se registró por error.",
        category: "pos",
        readMinutes: 2,
        steps: [
          paso("Abre el historial", "En Cobros, toca el ícono del reloj (Historial de cobros)."),
          paso("Busca el cobro y anúlalo", "Toca Anular cobro en la venta y confirma."),
          paso("Qué pasa después",
            "La venta deja de contar en los ingresos y la cita vuelve a quedar por cobrar. Un cobro con factura electrónica o con bono no se puede anular desde aquí."),
        ],
      },
      {
        slug: "abrir-cerrar-caja",
        title: "Cómo abrir y cerrar la caja",
        description: "El ciclo diario del efectivo.",
        category: "pos",
        readMinutes: 3,
        steps: [
          paso("Abre la caja al empezar",
            "Ve a Ajustes → Sistema de caja, escribe el fondo inicial (puede ser 0) y toca Abrir caja."),
          paso("Los cobros se suman solos",
            "Cada cobro en efectivo entra a la caja abierta. Para pagos o retiros que no son ventas, usa Registrar movimiento."),
          paso("Cierra al final del día",
            "Toca Cerrar caja y escribe el efectivo que contaste. La app muestra el fondo inicial, lo que entró en efectivo, los egresos y la diferencia (descuadre)."),
          paso("Revisa cierres anteriores", "En la pestaña Historial de la caja están todas las sesiones cerradas."),
        ],
      },
      {
        slug: "inventario",
        title: "Cómo manejar el inventario",
        description: "Productos, stock y alertas.",
        category: "pos",
        readMinutes: 2,
        steps: [
          paso("Abre Inventario", "Ve a Ajustes → Inventario y toca Nuevo."),
          paso("Crea el producto",
            "Nombre, SKU o código, precio de costo, precio de venta, stock inicial y la alerta de mínimo."),
          paso("Ajusta el stock",
            "En la ficha del producto usa Ajustar stock para registrar una compra, un ajuste, una devolución o una cortesía."),
          paso("Véndelo desde Cobros",
            "Al agregarlo a un cobro, el stock se descuenta solo. Cuando baja del mínimo, el producto aparece con alerta."),
        ],
      },
    ],
  },

  {
    id: "finanzas",
    label: "Reportes y comisiones",
    description: "Ingresos, rendimiento y pagos al equipo.",
    iconName: "ChartBar",
    articles: [
      {
        slug: "resumen-financiero",
        title: "Cómo ver tus ingresos",
        description: "Reportes por semana, mes o año.",
        category: "finanzas",
        readMinutes: 2,
        steps: [
          paso("Abre Reportes", "Ve a Ajustes → Reportes. Para ingresos contra egresos, usa Ajustes → Módulo financiero."),
          paso("Elige el período", "Semana, Mes o Año, y muévete con las flechas a períodos anteriores."),
          paso("Qué cuenta como ingreso",
            "Solo lo que cobraste. Las citas completadas que no se cobraron no suman: aparecen como por cobrar."),
          paso("Revisa el detalle",
            "Ingresos por día, los servicios más vendidos, el rendimiento de cada profesional y las horas con más movimiento."),
        ],
      },
      {
        slug: "comisiones-equipo",
        title: "Cómo calcular y pagar comisiones",
        description: "Cuánto le corresponde a cada profesional.",
        category: "finanzas",
        readMinutes: 2,
        steps: [
          paso("Abre Comisiones", "Ve a Ajustes → Comisiones."),
          paso("Define la regla de cada profesional", "Elige el tipo de comisión y el valor, y guarda."),
          paso("Elige el período", "La tabla muestra los ingresos y la comisión de cada profesional en ese período."),
          paso("Liquida", "Toca Liquidar para registrar el pago. Queda en el historial de liquidaciones."),
        ],
      },
    ],
  },

  {
    id: "whatsapp",
    label: "WhatsApp, Hanna y reseñas",
    description: "Chats, campañas, tu copiloto y las reseñas.",
    iconName: "Chat",
    articles: [
      {
        slug: "agente-whatsapp",
        title: "Cómo funciona Hanna en tu WhatsApp",
        description: "La asistente que responde y agenda por ti.",
        category: "whatsapp",
        readMinutes: 3,
        steps: [
          paso("Qué hace Hanna",
            "Responde los mensajes de WhatsApp de tus clientes a cualquier hora, consulta tu disponibilidad y agenda citas. Antes de crear o cancelar una cita, siempre le pide confirmación al cliente."),
          paso("Conecta tu número",
            "La conexión del número con Meta se hace una sola vez desde el portal web de Zyncra (zyncra.app), en Marketing → WhatsApp. En la app, Ajustes → Campañas WhatsApp → Conexión te muestra si el número está conectado."),
          paso("Actívala o páusala",
            "En esa misma pestaña Conexión, el interruptor Hanna responde en WhatsApp la enciende o la apaga para todos los chats."),
          paso("Ajusta su personalidad",
            "En Ajustes → Hanna IA puedes cambiar el saludo, el tono y darle instrucciones extra (por ejemplo, una promo del mes)."),
        ],
      },
      {
        slug: "bandeja-chats",
        title: "Cómo responder desde la bandeja de WhatsApp",
        description: "Tus conversaciones con clientes, en la app.",
        category: "whatsapp",
        readMinutes: 3,
        steps: [
          paso("Abre la bandeja",
            "Ve a Ajustes → Bandeja de WhatsApp. Verás los chats del más reciente al más viejo, con los no leídos marcados. Puedes buscar por nombre o número."),
          paso("Atiende tú un chat",
            "Abre el chat y toca \"Hanna responde · toca para atender tú\". Hanna deja de responder en ese chat (aparece MANUAL) hasta que la reactives."),
          paso("La ventana de 24 horas",
            "WhatsApp solo deja escribir libremente hasta 24 horas después del último mensaje del cliente. Si pasó más tiempo, podrás responder cuando vuelva a escribirte."),
          paso("Revisa las entregas",
            "Una palomita es enviado, dos son entregado y en azul, leído. Si WhatsApp no pudo entregar un mensaje (por ejemplo, si el cliente bloqueó el número), la burbuja aparece en rojo con el motivo."),
        ],
      },
      {
        slug: "campanas-marketing",
        title: "Cómo enviar una campaña por WhatsApp",
        description: "Un mensaje para todos tus clientes o solo para un grupo.",
        category: "whatsapp",
        readMinutes: 3,
        steps: [
          paso("Abre Campañas WhatsApp", "Ve a Ajustes → Campañas WhatsApp, pestaña Campaña."),
          paso("Arma la campaña",
            "Ponle nombre, elige a quién va (todos, activos con cita en los últimos 90 días o inactivos) y escribe el mensaje. Usa {{nombre}} y {{negocio}}: se reemplazan por el nombre de cada cliente y el de tu negocio."),
          paso("Envía uno por uno",
            "Toca Iniciar campaña. Por cada cliente, Enviar abre WhatsApp con el mensaje listo y tú lo mandas desde tu teléfono. Los números inválidos aparecen marcados para que los corrijas en Clientes."),
          paso("Finaliza",
            "Toca Finalizar campaña para guardarla en el Historial con los envíos que hiciste. Si cierras sin finalizar, la app te pregunta si quieres guardarla."),
          paso("Pídele ideas a Hanna",
            "En Ajustes → Hanna IA, toca Generar campañas. Con Usar en campaña, el mensaje que te propone pasa directo a una campaña nueva."),
        ],
      },
      {
        slug: "copiloto-hanna",
        title: "Cómo usar a Hanna como copiloto",
        description: "Pregúntale por tu negocio desde cualquier pantalla.",
        category: "whatsapp",
        readMinutes: 2,
        steps: [
          paso("Abre el copiloto",
            "Si ves el botón redondo de Hanna en la esquina de la pantalla, tócalo. Si no aparece, esta función no está disponible en tu cuenta."),
          paso("Pregúntale lo que necesites",
            "Por ejemplo: ¿cómo va mi día?, ¿cuántas citas tengo mañana? o ¿cuánto he vendido este mes?"),
          paso("Pídele cambios",
            "También puede cancelar una cita o cambiar el precio de un servicio. Antes de hacerlo te muestra un resumen con los botones Confirmar y Cancelar: nada cambia hasta que confirmes."),
        ],
      },
      {
        slug: "resenas",
        title: "Cómo conseguir y moderar reseñas",
        description: "Reseñas en Google y en tu página de reservas.",
        category: "whatsapp",
        readMinutes: 3,
        steps: [
          paso("Pega tu link de Google",
            "Ve a Ajustes → Reseñas Google → Configuración. Copia el link para pedir reseñas desde business.google.com, pégalo y guarda. El mensaje puede usar {{nombre}} y {{link}}."),
          paso("Pide la reseña",
            "En Pedir reseña la app te sugiere a quién pedírsela: clientes que ya atendiste y a los que no les has pedido. Elige uno y toca WhatsApp o Copiar."),
          paso("Marca quién reseñó",
            "Google no avisa quién dejó reseña. En Historial toca la estrella de la solicitud para marcarla a mano."),
          paso("Modera las reseñas de tu página",
            "En Ajustes → Reseñas del negocio apruebas o rechazas lo que tus clientes escriben en tu link de reseñas. Solo las aprobadas se muestran en tu página de reservas."),
        ],
      },
    ],
  },

  {
    id: "marca",
    label: "Mi Tienda y ajustes",
    description: "Tu página de reservas y los ajustes del negocio.",
    iconName: "Palette",
    articles: [
      {
        slug: "logo-colores",
        title: "Cómo cambiar el logo y los colores",
        description: "La imagen de tu página pública de reservas.",
        category: "marca",
        readMinutes: 2,
        steps: [
          paso("Abre Mi Tienda", "Ve a Ajustes → Mi Tienda."),
          paso("Cambia el logo", "Toca el logo actual y elige una imagen de tu galería."),
          paso("Elige los colores y el mensaje",
            "El color primario y el secundario se usan en los botones y encabezados de tu página. Debajo puedes cambiar el mensaje de bienvenida."),
          paso("Guarda", "Toca Guardar cambios. Abre tu link de reservas para ver cómo quedó."),
        ],
      },
      {
        slug: "zona-horaria",
        title: "Cómo cambiar la zona horaria",
        description: "Para que \"hoy\" sea el día de tu negocio.",
        category: "marca",
        readMinutes: 1,
        steps: [
          paso("Abre Info del negocio", "Ve a Ajustes → Info del negocio y toca Zona horaria."),
          paso("Elige la zona de tu negocio",
            "Todas las fechas de la app (agenda, cobros, caja y reportes) se calculan con esa zona, aunque tu teléfono esté en otra."),
        ],
      },
      {
        slug: "sedes",
        title: "Cómo trabajar con varias sedes",
        description: "Elegir en cuál sede estás; las sedes se crean en el portal web.",
        category: "marca",
        readMinutes: 2,
        steps: [
          paso("Abre Sedes", "Ve a Ajustes → Sedes para ver tus sedes y cambiar su foto. Para crear o renombrar sedes usa el portal web de Zyncra."),
          paso("Elige la sede activa",
            "La sede activa se asigna a las citas, cobros y caja que crees desde el teléfono, y el Panel, la Agenda y Cobros muestran esa sede."),
          paso("Administradores de sede",
            "Los administradores con acceso a una sola sede se invitan desde el portal web de Zyncra."),
        ],
      },
      {
        // Debe decir lo mismo que app/settings/reminders.tsx (AGE-19): la
        // anticipación solo mueve el aviso en el teléfono del dueño; al
        // cliente le escribe el servidor con horarios fijos.
        slug: "recordatorios",
        title: "Cómo funcionan los recordatorios de cita",
        description: "Qué te llega a ti, qué le llega al cliente y qué puedes cambiar.",
        category: "marca",
        readMinutes: 2,
        steps: [
          paso("Abre Recordatorios", "Ve a Ajustes → Recordatorios."),
          paso("El aviso en tu teléfono",
            "Elige cuánto antes de cada cita te avisamos en este teléfono: 1 h, 2 h, 6 h, 12 h, 1 día o 2 días. Esto no cambia lo que recibe el cliente."),
          paso("El recordatorio al cliente",
            "Lo envía Zyncra sin que hagas nada: un correo 24 horas y otro 2 horas antes de la cita, si el cliente tiene correo, y un WhatsApp 2 horas antes si conectaste tu WhatsApp y elegiste una plantilla aprobada en el portal web."),
          paso("El mensaje para enviar a mano",
            "La plantilla de esta pantalla es el texto que se usa cuando le mandas el recordatorio tú mismo por WhatsApp desde el portal web. Toca Nombre, Servicio, Fecha y Hora para insertar {{nombre}}, {{servicio}}, {{fecha}} y {{hora}}. Con llaves simples ({nombre}) no funcionan."),
          paso("Guarda", "Toca Guardar configuración. La vista previa te muestra cómo se verá el mensaje."),
        ],
      },
      {
        slug: "cuenta",
        title: "Tu cuenta, privacidad y cierre de sesión",
        description: "Perfil, contraseña, privacidad y eliminar la cuenta.",
        category: "marca",
        readMinutes: 2,
        steps: [
          paso("Tu perfil", "En Ajustes → Mi perfil cambias tus datos personales y tu contraseña."),
          paso("Privacidad", "En Ajustes → Política de privacidad ves cómo se tratan tus datos y los de tus clientes."),
          paso("Cerrar sesión",
            "Al final de Ajustes toca Cerrar sesión. Este teléfono deja de recibir las notificaciones del negocio."),
          paso("Eliminar la cuenta",
            "Al final de Ajustes, Eliminar mi cuenta borra tu cuenta de forma definitiva. Te pedirá confirmación."),
        ],
      },
    ],
  },
];

export function findArticle(slug: string): HelpArticle | undefined {
  for (const cat of HELP_CATEGORIES) {
    const a = cat.articles.find(a => a.slug === slug);
    if (a) return a;
  }
  return undefined;
}

export function findCategory(id: string): HelpCategory | undefined {
  return HELP_CATEGORIES.find(c => c.id === id);
}

export function allArticles(): HelpArticle[] {
  return HELP_CATEGORIES.flatMap(c => c.articles);
}
