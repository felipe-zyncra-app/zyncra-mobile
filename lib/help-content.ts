export type CategoryIconName =
  | "Zap" | "Calendar" | "Users" | "CreditCard" | "ChartBar" | "Chat" | "Palette";

export interface HelpStep {
  title: string;
  body: string;
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

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "primeros-pasos",
    label: "Primeros pasos",
    description: "Configura tu negocio desde cero en pocos minutos.",
    iconName: "Zap",
    articles: [
      {
        slug: "configuracion-inicial",
        title: "Configuración inicial del negocio",
        description: "Completa los datos básicos para comenzar a recibir citas.",
        category: "primeros-pasos",
        readMinutes: 3,
        steps: [
          {
            title: "Ingresa a Mi Marca",
            body: "En el menú lateral, ve a Negocio → Mi Marca. Aquí puedes subir el logo, cambiar el nombre del negocio y definir el color principal.",
            image: "/help/branding.png",
          },
          {
            title: "Sube tu logo",
            body: "Haz clic en el área de imagen y selecciona tu logo. Formatos aceptados: PNG o JPG. Tamaño recomendado: 400×400 px, máximo 2 MB.",
            image: "/help/configuracion-inicial-step2.png",
          },
          {
            title: "Define el color principal",
            body: "Elige el color que representa tu marca. Aparecerá en los botones y encabezados de tu página pública de agendamiento.",
            image: "/help/configuracion-inicial-step3.png",
          },
          {
            title: "Guarda los cambios",
            body: "Haz clic en Guardar. Los cambios se reflejan de inmediato en la página pública de reservas.",
            image: "/help/configuracion-inicial-step4.png",
          },
        ],
      },
      {
        slug: "primer-servicio",
        title: "Cómo agregar tu primer servicio",
        description: "Crea los servicios que ofrecerás para que los clientes puedan agendar.",
        category: "primeros-pasos",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Servicios",
            body: "En el menú lateral, dirígete a Negocio → Servicios.",
            image: "/help/services.png",
          },
          {
            title: "Haz clic en Añadir servicio",
            body: "Encontrarás el botón en la esquina superior derecha de la pantalla.",
            image: "/help/primer-servicio-step2.png",
          },
          {
            title: "Completa los datos del servicio",
            body: "Ingresa el nombre del servicio, la duración en minutos y el precio. El nombre es lo que verán tus clientes al agendar.",
            image: "/help/primer-servicio-step3.png",
          },
          {
            title: "Guarda el servicio",
            body: "Haz clic en Crear servicio. El servicio ya estará disponible para asignarlo a profesionales y para el agendamiento público.",
            image: "/help/primer-servicio-step4.png",
          },
        ],
      },
      {
        slug: "agregar-profesionales",
        title: "Cómo agregar profesionales al equipo",
        description: "Agrega a los miembros de tu equipo que atenderán las citas.",
        category: "primeros-pasos",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Equipo",
            body: "En el menú lateral, dirígete a Negocio → Equipo.",
            image: "/help/professionals.png",
          },
          {
            title: "Haz clic en Añadir profesional",
            body: "Completa el nombre completo y los datos de contacto del profesional.",
            image: "/help/agregar-profesionales-step2.png",
          },
          {
            title: "Completa los datos del profesional",
            body: "Ingresa nombre completo y rol o especialidad. Puedes subir una foto de perfil opcional.",
            image: "/help/agregar-profesionales-step3.png",
          },
          {
            title: "Guarda y verifica",
            body: "Haz clic en Añadir al equipo. El profesional aparecerá en el calendario y en la página pública de agendamiento, listo para recibir citas.",
            image: "/help/agregar-profesionales-step4.png",
          },
        ],
      },
    ],
  },

  {
    id: "calendario",
    label: "Calendario & Citas",
    description: "Gestiona citas, reagendamientos y disponibilidad.",
    iconName: "Calendar",
    articles: [
      {
        slug: "crear-cita",
        title: "Cómo crear una cita manualmente",
        description: "Agrega citas directamente desde el panel sin esperar al cliente.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          {
            title: "Ve al Calendario",
            body: "En el menú lateral, haz clic en Panel → Calendario.",
            image: "/help/calendar.png",
          },
          {
            title: "Selecciona un horario disponible",
            body: "Haz clic en el botón Nueva cita en la esquina superior derecha o toca una celda vacía del calendario.",
            image: "/help/crear-cita-step2.png",
          },
          {
            title: "Completa los datos de la cita",
            body: "Selecciona el cliente (busca por nombre o teléfono), elige el servicio y el profesional. Confirma la fecha y hora.",
            image: "/help/crear-cita-step3.png",
          },
          {
            title: "Confirma y guarda",
            body: "Haz clic en Guardar. Si el cliente tiene email registrado, recibirá un correo de confirmación automáticamente.",
            image: "/help/crear-cita-step4.png",
          },
        ],
      },
      {
        slug: "reagendar-cancelar",
        title: "Cómo reagendar o cancelar una cita",
        description: "Modifica o cancela citas existentes desde el calendario.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          {
            title: "Encuentra la cita en el calendario",
            body: "En el Calendario, haz clic sobre la cita que deseas modificar. Se abrirá un panel con los detalles.",
            image: "/help/calendar.png",
          },
          {
            title: "Elige la acción: Reagendar o Cancelar",
            body: "Verás los botones de acción en el panel lateral. Selecciona la que necesitas.",
            image: "/help/reagendar-cancelar-step2.png",
          },
          {
            title: "Para reagendar",
            body: "Selecciona la nueva fecha y hora. El sistema verificará automáticamente que el horario esté disponible antes de confirmar.",
            image: "/help/reagendar-cancelar-step3.png",
          },
          {
            title: "Para cancelar",
            body: "Cambia el estado a Cancelada en el desplegable y haz clic en Guardar cambios. La cita queda cancelada y el horario queda libre.",
            image: "/help/reagendar-cancelar-step4.png",
          },
        ],
      },
      {
        slug: "horarios-negocio",
        title: "Cómo configurar los horarios del negocio",
        description: "Define los días y horas en que tu negocio recibe citas.",
        category: "calendario",
        readMinutes: 3,
        steps: [
          {
            title: "Ve a Configuración",
            body: "En el menú lateral, dirígete a Negocio → Configuración.",
            image: "/help/settings.png",
          },
          {
            title: "Encuentra la sección de Horarios",
            body: "Desplázate hacia abajo hasta la sección Horarios de atención. Verás los siete días de la semana.",
            image: "/help/horarios-negocio-step2.png",
          },
          {
            title: "Activa los días y define las horas",
            body: "Activa el interruptor de cada día en que atiendes. Luego configura la hora de apertura y la de cierre.",
            image: "/help/horarios-negocio-step3.png",
          },
          {
            title: "Guarda los cambios",
            body: "Los horarios se aplican de inmediato al agendamiento público y al agente de WhatsApp.",
            image: "/help/horarios-negocio-step4.png",
          },
        ],
      },
      {
        slug: "link-agendamiento",
        title: "Cómo compartir tu link de agendamiento",
        description: "Obtén tu enlace público para que los clientes reserven en cualquier momento.",
        category: "calendario",
        readMinutes: 2,
        steps: [
          {
            title: "Encuentra tu link de reservas",
            body: "Tu link tiene el formato zyncra.app/book/TU-SLUG. Lo encuentras en Configuración o en el panel principal.",
            image: "/help/dashboard.png",
          },
          {
            title: "Comparte el link donde estés",
            body: "Compártelo por WhatsApp, en tu bio de Instagram, en Facebook, en tu firma de correo o en Google My Business.",
            image: "/help/link-agendamiento-step2.png",
          },
          {
            title: "El cliente agenda sin ayuda",
            body: "El cliente elige servicio, profesional, fecha y hora disponible. Recibirás una notificación inmediata.",
            image: "/help/link-agendamiento-step3.png",
          },
          {
            title: "Confirmación automática al cliente",
            body: "Activa las Notificaciones por correo en Configuración. Si el cliente ingresó su email, recibirá un correo de confirmación con todos los detalles.",
            image: "/help/link-agendamiento-step4.png",
          },
        ],
      },
    ],
  },

  {
    id: "clientes",
    label: "Clientes & CRM",
    description: "Administra tu base de clientes y su historial de atenciones.",
    iconName: "Users",
    articles: [
      {
        slug: "agregar-cliente",
        title: "Cómo agregar un cliente manualmente",
        description: "Registra nuevos clientes directamente en tu base de datos.",
        category: "clientes",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Clientes (CRM)",
            body: "En el menú lateral, haz clic en Clientes → Clientes (CRM).",
            image: "/help/clients.png",
          },
          {
            title: "Haz clic en Nuevo cliente",
            body: "El botón aparece en la esquina superior derecha de la pantalla.",
            image: "/help/agregar-cliente-step2.png",
          },
          {
            title: "Ingresa los datos del cliente",
            body: "Completa nombre, número de teléfono y correo electrónico. El teléfono es el identificador principal que usa el agente de WhatsApp.",
            image: "/help/agregar-cliente-step3.png",
          },
          {
            title: "Guarda el cliente",
            body: "Haz clic en Crear cliente. El cliente quedará disponible para citas del calendario y recibirá comunicaciones automáticas.",
            image: "/help/agregar-cliente-step4.png",
          },
        ],
      },
      {
        slug: "historial-cliente",
        title: "Cómo ver el historial de un cliente",
        description: "Consulta todas las citas y compras de un cliente específico.",
        category: "clientes",
        readMinutes: 2,
        steps: [
          {
            title: "Busca al cliente",
            body: "En la sección Clientes (CRM), usa la barra de búsqueda para encontrarlo por nombre o teléfono.",
            image: "/help/clients.png",
          },
          {
            title: "Abre el perfil del cliente",
            body: "Usa la barra de búsqueda para encontrarlo. Haz clic en su nombre para ver el perfil detallado.",
            image: "/help/historial-cliente-step2.png",
          },
          {
            title: "Revisa el historial completo",
            body: "Verás todas las citas pasadas y futuras, el total gastado, los servicios más frecuentes y las notas registradas.",
            image: "/help/historial-cliente-step3.png",
          },
        ],
      },
    ],
  },

  {
    id: "pos",
    label: "POS & Caja",
    description: "Registra ventas, maneja el efectivo y aplica descuentos.",
    iconName: "CreditCard",
    articles: [
      {
        slug: "hacer-venta",
        title: "Cómo hacer una venta en el POS",
        description: "Registra ventas de servicios y productos desde el punto de venta.",
        category: "pos",
        readMinutes: 3,
        steps: [
          {
            title: "Ve al Sistema POS",
            body: "En el menú lateral, dirígete a Ventas → Sistema POS.",
            image: "/help/pos.png",
          },
          {
            title: "Agrega ítems al carrito",
            body: "Busca y agrega los servicios o productos vendidos. Puedes combinar servicios y productos del inventario en una misma venta.",
            image: "/help/hacer-venta-step2.png",
          },
          {
            title: "Aplica descuentos si aplica",
            body: "En el panel del carrito puedes aplicar un descuento por monto fijo o por porcentaje sobre el total.",
            image: "/help/hacer-venta-step3.png",
          },
          {
            title: "Selecciona el método de pago",
            body: "Elige entre efectivo, tarjeta, transferencia u otro método configurado. Si el pago es en efectivo, el sistema calcula el vuelto automáticamente.",
            image: "/help/hacer-venta-step4.png",
          },
          {
            title: "Confirma la venta",
            body: "Haz clic en Cobrar. La venta queda registrada en el módulo financiero y el inventario se actualiza automáticamente.",
            image: "/help/hacer-venta-step5.png",
          },
        ],
      },
      {
        slug: "abrir-cerrar-caja",
        title: "Cómo abrir y cerrar la caja del día",
        description: "Gestiona el ciclo diario de caja con apertura, registro y cierre.",
        category: "pos",
        readMinutes: 3,
        steps: [
          {
            title: "Abre la caja al inicio del día",
            body: "Ve a Ventas → Sistema de Caja y haz clic en Abrir caja. Ingresa el monto inicial en efectivo disponible.",
            image: "/help/caja.png",
          },
          {
            title: "Las ventas se asocian automáticamente",
            body: "Todas las ventas del POS durante el día se asocian a la caja abierta, sin pasos adicionales.",
            image: "/help/abrir-cerrar-caja-step2.png",
          },
          {
            title: "Cierra la caja al final del día",
            body: "Haz clic en Cerrar Caja. El sistema mostrará un resumen de ingresos desglosado por método de pago.",
            image: "/help/abrir-cerrar-caja-step3.png",
          },
          {
            title: "Registra el descuadre y agrega notas",
            body: "Ingresa el monto físico contado en efectivo. Si hay diferencia, el sistema la registra como descuadre. El cierre queda guardado en el historial.",
            image: "/help/abrir-cerrar-caja-step4.png",
          },
        ],
      },
      {
        slug: "inventario",
        title: "Cómo gestionar el inventario de productos",
        description: "Controla el stock de productos que vendes o usas en los servicios.",
        category: "pos",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Inventario",
            body: "En el menú lateral, dirígete a Ventas → Inventario.",
            image: "/help/inventario.png",
          },
          {
            title: "Agrega productos",
            body: "Haz clic en Nuevo producto e ingresa nombre, precio de costo, precio de venta y stock inicial.",
            image: "/help/inventario-step2.png",
          },
          {
            title: "Completa el formulario del producto",
            body: "Ingresa nombre, SKU, precios de costo y venta, y el stock inicial. Puedes subir una foto del producto.",
            image: "/help/inventario-step3.png",
          },
          {
            title: "Monitorea el stock disponible",
            body: "La columna Stock en la tabla se actualiza automáticamente con cada venta. Cuando cae por debajo del mínimo configurado, aparecerá una alerta.",
            image: "/help/inventario-step4.png",
          },
        ],
      },
    ],
  },

  {
    id: "finanzas",
    label: "Módulo Financiero",
    description: "Reportes de ingresos, comisiones y análisis del negocio.",
    iconName: "ChartBar",
    articles: [
      {
        slug: "resumen-financiero",
        title: "Cómo ver el resumen financiero",
        description: "Consulta ingresos, ventas y métricas clave en cualquier período.",
        category: "finanzas",
        readMinutes: 2,
        steps: [
          {
            title: "Ve al Módulo Financiero",
            body: "En el menú lateral, dirígete a Ventas → Módulo Financiero.",
            image: "/help/finanzas.png",
          },
          {
            title: "Filtra por período de tiempo",
            body: "Usa los botones de período (Hoy, Esta semana, Este mes) o define un rango personalizado.",
            image: "/help/resumen-financiero-step2.png",
          },
          {
            title: "Analiza las métricas principales",
            body: "Verás ingresos totales, número de citas completadas, ticket promedio y comparativa con el período anterior.",
            image: "/help/resumen-financiero-step3.png",
          },
          {
            title: "Revisa el desglose por servicio",
            body: "Desplázate hacia abajo para ver cuáles servicios generaron más ingresos y cuáles tienen menor rendimiento.",
            image: "/help/resumen-financiero-step4.png",
          },
        ],
      },
      {
        slug: "comisiones-equipo",
        title: "Cómo calcular las comisiones del equipo",
        description: "Consulta cuánto le corresponde pagar a cada profesional por sus ventas.",
        category: "finanzas",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Comisiones",
            body: "En el menú lateral, dirígete a Ventas → Comisiones.",
            image: "/help/commissions.png",
          },
          {
            title: "Selecciona el período a liquidar",
            body: "Usa los botones Esta semana, Este mes o Rango personalizado para filtrar el período que quieres liquidar.",
            image: "/help/comisiones-equipo-step2.png",
          },
          {
            title: "Revisa el desglose por profesional",
            body: "El sistema muestra el total de ventas de cada profesional y el monto de comisión calculado según el porcentaje configurado en su perfil.",
            image: "/help/comisiones-equipo-step3.png",
          },
        ],
      },
    ],
  },

  {
    id: "whatsapp",
    label: "WhatsApp & Agente IA",
    description: "Automatiza reservas y envía campañas de marketing por WhatsApp.",
    iconName: "Chat",
    articles: [
      {
        slug: "agente-whatsapp",
        title: "Cómo funciona el agente de reservas por WhatsApp",
        description: "Entiende cómo el agente IA atiende a tus clientes automáticamente.",
        category: "whatsapp",
        readMinutes: 4,
        steps: [
          {
            title: "¿Qué hace el agente?",
            body: "El agente IA responde mensajes de WhatsApp las 24 horas. Identifica al cliente por su número, consulta disponibilidad y agenda citas sin que tengas que intervenir.",
            image: "/help/whatsapp.png",
          },
          {
            title: "Flujo de una reserva nueva",
            body: "1) Cliente saluda → el agente le da la bienvenida y pregunta qué necesita. 2) Cliente menciona servicio y fecha → el agente muestra horarios disponibles. 3) Cliente elige un horario → el agente pregunta '¿Confirmas la cita?'. 4) Cliente responde 'sí' → la cita queda registrada.",
            image: "/help/agente-whatsapp-step2.png",
          },
          {
            title: "El agente nunca agenda sin confirmación",
            body: "Por seguridad, el agente siempre pide confirmación explícita antes de crear o cancelar una cita. Si el cliente no confirma, le pregunta directamente.",
            image: "/help/agente-whatsapp-step3.png",
          },
          {
            title: "Verifica que el agente está activo",
            body: "En la pestaña Bot IA, copia la URL del Webhook y asegúrate de que esté configurada en Meta. Luego envía un mensaje de prueba al número conectado.",
            image: "/help/agente-whatsapp-step4.png",
          },
        ],
      },
      {
        slug: "campanas-marketing",
        title: "Cómo enviar campañas de marketing por WhatsApp",
        description: "Envía mensajes masivos o segmentados a tu base de clientes.",
        category: "whatsapp",
        readMinutes: 3,
        steps: [
          {
            title: "Ve a Marketing WhatsApp",
            body: "En el menú lateral, dirígete a Marketing → Marketing WhatsApp.",
            image: "/help/whatsapp.png",
          },
          {
            title: "Crea una nueva campaña",
            body: "En la pestaña Nueva Campaña, escribe el nombre, selecciona el segmento de clientes y redacta el mensaje.",
            image: "/help/campanas-marketing-step2.png",
          },
          {
            title: "Previsualiza el mensaje",
            body: "Revisa el mensaje en el área de texto. Asegúrate de que el texto sea claro y no tenga errores antes de enviar.",
            image: "/help/campanas-marketing-step3.png",
          },
          {
            title: "Envía y monitorea",
            body: "Haz clic en Iniciar campaña. Podrás ver el estado de entrega y las respuestas recibidas en el panel de conversaciones.",
            image: "/help/campanas-marketing-step4.png",
          },
        ],
      },
    ],
  },

  {
    id: "marca",
    label: "Mi Marca & Config.",
    description: "Personaliza la apariencia y los ajustes globales del sistema.",
    iconName: "Palette",
    articles: [
      {
        slug: "logo-colores",
        title: "Cómo cambiar el logo y los colores",
        description: "Personaliza la identidad visual de tu página pública de agendamiento.",
        category: "marca",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Mi Marca",
            body: "En el menú lateral, dirígete a Negocio → Mi Marca.",
            image: "/help/branding.png",
          },
          {
            title: "Sube un nuevo logo",
            body: "Haz clic sobre el área de imagen actual. Selecciona un archivo PNG o JPG de máximo 2 MB. Tamaño recomendado: 400×400 px.",
            image: "/help/logo-colores-step2.png",
          },
          {
            title: "Cambia el color principal",
            body: "Usa el selector de color para definir el color de acento de tu marca. Aparece en los botones y encabezados de tu página pública.",
            image: "/help/logo-colores-step3.png",
          },
          {
            title: "Guarda y verifica",
            body: "Haz clic en Guardar configuración. Los cambios se aplican en tiempo real. Abre tu link de agendamiento en otra pestaña para ver cómo quedó.",
            image: "/help/logo-colores-step4.png",
          },
        ],
      },
      {
        slug: "moneda-zona-horaria",
        title: "Cómo configurar moneda y zona horaria",
        description: "Ajusta la configuración regional para mostrar precios y horarios correctamente.",
        category: "marca",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Configuración",
            body: "En el menú lateral, dirígete a Negocio → Configuración.",
            image: "/help/settings.png",
          },
          {
            title: "Ubica la sección Regional",
            body: "Encuentra los campos de Moneda y Zona horaria en la sección de configuración regional.",
            image: "/help/moneda-zona-horaria-step2.png",
          },
          {
            title: "Selecciona los valores correctos",
            body: "Elige la moneda de tu país (p.ej. COP para Colombia, USD para Estados Unidos) y tu zona horaria.",
            image: "/help/moneda-zona-horaria-step3.png",
          },
          {
            title: "Guarda los cambios",
            body: "La moneda se usará en el POS, finanzas y facturas. La zona horaria afecta los horarios mostrados a los clientes al agendar.",
            image: "/help/moneda-zona-horaria-step4.png",
          },
        ],
      },
      {
        slug: "admins-sede",
        title: "Cómo gestionar administradores de sede",
        description: "Invita a colaboradores con acceso restringido a una sede específica.",
        category: "marca",
        readMinutes: 3,
        steps: [
          {
            title: "Ve a Sedes",
            body: "En el menú lateral, dirígete a Negocio → Sedes.",
            image: "/help/locations.png",
          },
          {
            title: "Selecciona la sede",
            body: "Haz clic en la sede para la que quieres asignar un administrador.",
            image: "/help/admins-sede-step2.png",
          },
          {
            title: "Invita al administrador",
            body: "En la sección Admins de sede, ingresa el correo del colaborador y haz clic en Invitar.",
            image: "/help/admins-sede-step3.png",
          },
          {
            title: "El colaborador acepta la invitación",
            body: "El colaborador recibirá un correo. Al aceptar, tendrá acceso al panel limitado solo a su sede: calendario, clientes y ventas, sin acceso a Configuración ni WhatsApp.",
            image: "/help/admins-sede-step4.png",
          },
        ],
      },
      {
        slug: "recordatorios",
        title: "Cómo configurar recordatorios automáticos",
        description: "Envía recordatorios de cita automáticos para reducir las ausencias.",
        category: "marca",
        readMinutes: 2,
        steps: [
          {
            title: "Ve a Recordatorios",
            body: "En el menú lateral, dirígete a Panel → Recordatorios.",
            image: "/help/reminders.png",
          },
          {
            title: "Activa los recordatorios",
            body: "En la pestaña Configuración, activa el interruptor para habilitar el envío automático de recordatorios.",
            image: "/help/recordatorios-step2.png",
          },
          {
            title: "Configura el tiempo de anticipación",
            body: "Selecciona con cuántas horas de anticipación se enviará el recordatorio: 1h, 2h, 4h, 12h, 24h o 48h antes de la cita.",
            image: "/help/recordatorios-step3.png",
          },
          {
            title: "Personaliza el mensaje",
            body: "Edita el texto del recordatorio en el campo de texto. Puedes usar variables como {nombre}, {servicio} y {hora} para personalizarlo automáticamente.",
            image: "/help/recordatorios-step4.png",
          },
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
