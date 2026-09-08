# Notas para App Review (App Store Connect)

Texto para pegar en **App Store Connect → App para iOS 1.1.0 → Información de revisión
de la app → Notas**. Está en inglés porque el equipo de App Review responde en inglés.

Antes de enviar, completar **Credenciales de demostración** con una cuenta real de un
negocio de prueba (correo + contraseña). Sin credenciales el revisor no pasa del login
y rechaza por 2.1.

> **BORRADOR — revisar línea por línea antes de pegarlo.** Es una declaración
> comercial ante Apple; que cada frase sea verdad es responsabilidad de ustedes,
> no de la redacción.

## Contexto (no pegar esto — es para nosotros)

La 1.0.0 se aprobó tras seis rechazos por 3.1.1 y 3.1.3(c). Lo que destrabó la
aprobación fue retirar el plan Starter (1 colaborador) el 27-ago-2026: la 3.1.3(c)
solo exime del IAP a los servicios vendidos *únicamente* a organizaciones.

**La 1.1.0 cambia dos cosas que tocan justo ese argumento**, y por eso las notas
anteriores ya no sirven — afirmaban tres cosas que hoy son falsas:

| Decía antes | Realidad en 1.1.0 |
|---|---|
| "No account registration or business sign-up" | La app tiene registro de negocio |
| "The app is unusable without an existing account provisioned to a business" | Cualquiera puede crear una cuenta |
| "Accounts are provisioned by our team… there is no online self-service sign-up" | Hay alta self-service con 14 días de prueba |

Lo que **sí** se mantiene y sostiene el argumento: ningún plan es de usuario único,
la app no muestra precios ni planes, y en iOS la pantalla de cuenta inactiva no
tiene botón, link ni precio hacia el pago.

**Riesgo:** el argumento es más débil que en la 1.0.0. Antes se podía decir que la
app era inútil sin un contrato previo; ahora no. Un revisor puede leer
"registro gratis + prueba de 14 días + se bloquea al vencer" como una suscripción
al consumidor y volver a pedir IAP. Decisión de negocio, no técnica.

---

## Notes for the reviewer

Zyncra is business management software for service companies in Colombia — hair
salons, barbershops, spas, and dental/aesthetic clinics. Businesses use it to manage
appointments, staff, point of sale, inventory and client records.

**What changed in this version**

This update adds business registration to the app, a device-appearance setting, and
an account status screen. It removes an internal demo feature that was visible to all
accounts by mistake.

**Nothing is sold inside the app, and nothing requires In-App Purchase**

- The app shows **no prices, no plans, no subscription tiers and no upgrade prompts**
  for Zyncra, anywhere — including during registration.
- There is **no way to buy, renew or upgrade Zyncra from inside the app**, and no
  button or link that leads to any page where Zyncra can be bought.
- Registration creates a business workspace and starts a **14-day free trial**. No
  payment details are requested and no charge occurs at any point in the app.
- When a business's subscription is not active, the app shows a plain status screen
  saying the account is inactive and to contact their Zyncra account manager. That
  screen contains **no price, no link and no payment button**.

**Every plan is for a business with a team (guideline 3.1.3(c))**

| Plan | Team size |
|---|---|
| Growth | 2–5 employees |
| Pro | 6–15 employees |
| Enterprise | 15+ employees, multi-location |

There is no plan for a single user, consumer, or family use. This is verifiable on our
public pricing page: https://www.zyncra.app/pricing — the page is in Spanish, and every
plan's call to action is "Hablar con ventas" (talk to sales). There is no "buy" button.

Pricing is agreed commercially, the contract is signed with the company and invoiced to
its tax ID (NIT). Payment is handled outside the app entirely.

**Two screens show money — neither is a purchase by the app's user (guideline 3.1.5(a))**

1. **Cobros / POS.** The business charging *its own walk-in customers* for a haircut,
   a manicure or a treatment performed in its physical premises. The app only records
   the amount and the payment method the customer already paid at the counter; it
   processes no payment and moves no money. Physical services consumed outside the app.

2. **Ajustes → Compras → Proveedores.** A wholesale catalogue where the business orders
   *physical inventory* (shampoo, dye, tools) from its suppliers. Placing an order
   creates a purchase order with `payment_status: pending`; the supplier is paid later
   by bank transfer, outside the app.

Neither is a digital good or service, and in neither case is Zyncra selling anything to
the person using the app.

**Account deletion (guideline 5.1.1(v))**

- Business owner: Ajustes → Eliminar cuenta (deletes the business and all its data).
- Staff member: Perfil → Eliminar cuenta (deletes the staff user; the business remains).

**Roles**

A business owner sees the full admin area (Agenda, Clientes, POS, Ajustes). A staff
member (barber, stylist) sees a reduced area (Agenda, Clientes, Perfil). The demo
credentials below belong to a business owner account so every screen can be reviewed.

If any of this needs clarification, please reply here and we will respond the same day.
