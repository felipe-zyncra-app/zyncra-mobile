# Notas para App Review (App Store Connect)

Texto para pegar en **App Store Connect → App para iOS 1.0 → Información de revisión
de la app → Notas**. Está en inglés porque el equipo de App Review responde en inglés.

Antes de enviar, completar **Credenciales de demostración** con una cuenta real de un
negocio de prueba (correo + contraseña). Sin credenciales el revisor no pasa del login
y rechaza por 2.1.

## Contexto (no pegar esto — es para nosotros)

Rechazos previos: 3.1.1 y 3.1.3(c), seis veces. El último mensaje (26-ago-2026) dijo:
*"la aplicación ofrece servicios empresariales que se venden a usuarios individuales"*.

La causa no estaba en la app sino en la oferta comercial: **el plan Starter era de
1 colaborador**, es decir una venta a usuario único, y 3.1.3(c) solo exime del IAP a
los servicios vendidos *únicamente* a organizaciones o grupos de empleados.

El 27-ago-2026 Starter salió de la oferta. El plan más bajo es Growth (2-5
colaboradores). Ese es el cambio concreto que hace verdadero el argumento B2B, y es
lo que hay que señalarle al revisor.

---

## Notes for the reviewer

Thank you for the feedback on our previous submissions. We have made a substantive
change to our commercial offering to comply with guideline 3.1.3(c).

**What changed since the last submission**

Our previous plan lineup included an entry-level plan for a single practitioner. You
correctly identified that this meant our service was also sold to individual users,
which made guideline 3.1.3(c) unavailable to us.

**We have discontinued that plan.** As of this submission, every plan Zyncra sells is
for a business with a team of employees:

| Plan | Team size |
|---|---|
| Growth | 2–5 employees |
| Pro | 6–15 employees |
| Enterprise | 15+ employees, multi-location |

There is no longer any plan available for a single user, consumer, or family use.
This is verifiable on our public pricing page: https://www.zyncra.app/pricing

**How Zyncra is sold**

Zyncra is business management software licensed to registered companies in Colombia —
hair salons, barbershops, spas, and dental/aesthetic clinics that manage appointments,
staff, point of sale, inventory and client records. The contract is signed with the
company and invoiced to its tax ID (NIT). Accounts are provisioned by our team after a
commercial agreement; there is no online self-service sign-up.

**The app contains no purchase flow of any kind**

- No account registration or business sign-up.
- No prices, plans, subscription tiers, trials, or upgrade prompts.
- No links to external payment mechanisms or checkout pages.
- The app is unusable without an existing account provisioned to a business.
- The login screen states that access is for businesses with an active Zyncra account.

**Account deletion (guideline 5.1.1(v))**

- Business owner: Ajustes → Eliminar cuenta (deletes the business and all its data).
- Staff member: Perfil → Eliminar cuenta (deletes the staff user; the business remains).

**Roles**

A business owner sees the full admin area (Agenda, Clientes, POS, Ajustes). A staff
member (barber, stylist) sees a reduced area (Agenda, Clientes, Perfil). The demo
credentials below belong to a business owner account so every screen can be reviewed.

If any of this needs clarification, please reply here and we will respond the same day.
