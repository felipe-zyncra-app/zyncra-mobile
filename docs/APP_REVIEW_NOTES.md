# Notas para App Review (App Store Connect)

Texto para pegar en **App Store Connect → App para iOS 1.0 → Información de revisión de la app → Notas**.
Está en inglés porque el equipo de App Review responde en inglés (ver mensajes del 16–23 ago 2026).

Antes de enviar, completar **Credenciales de demostración** con una cuenta real de un negocio de prueba
(correo + contraseña). Sin credenciales el revisor no puede pasar del login y rechaza por 2.1.

---

## Notes for the reviewer

Thank you for the detailed feedback on submissions 1.0 (1) through 1.0 (6).

**Zyncra is business management software licensed to organizations (guideline 3.1.3(c)).**
Our customers are registered businesses in Colombia — hair salons, barbershops, spas, dental and
aesthetic clinics — that manage their appointments, staff, point of sale, inventory and client
records with Zyncra. Contracts are signed with the business entity and invoiced to its tax ID (NIT).
The service is not sold to individual consumers or for personal/family use.

**This build removes everything that could be read as a purchase flow:**

- The in-app business registration wizard has been removed. Accounts are provisioned by Zyncra for
  the business after a commercial agreement; the app is a login-only companion for existing accounts.
- The "Plan y facturación" screen (plan comparison, prices, upgrade calls to action) has been removed.
- There are no prices, trials, subscription tiers, upgrade prompts, or links to external payment
  mechanisms anywhere in the app.
- The login screen states that access is for businesses with an active Zyncra account.

**Account deletion (guideline 5.1.1(v))** is available in-app:
- Business owner: Ajustes → Eliminar cuenta (deletes the business and all its data).
- Staff member: Perfil → Eliminar cuenta (deletes the staff user; the business is unaffected).

**Roles.** A business owner sees the full admin area (Agenda, Clientes, POS, Ajustes). A staff member
(barber, stylist, professional) sees a reduced area (Agenda, Clientes, Perfil). The demo credentials
below belong to a business owner account so every screen can be reviewed.

If anything else needs clarification, please reply here and we will respond the same day.
