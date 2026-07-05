# Auditoría de integridad del sistema — 5 de julio de 2026

**Resumen: el núcleo contable (orden ↔ proforma ↔ entrega) está sano, pero se encontró 1 hallazgo alto en el flujo de pago de la tienda, 2 medios en finanzas/webhook y 2 bajos.**

## Alcance y lo que se verificó como correcto

Se revisó `db.js` completo (schema v14) y las rutas de admin, KDS, taller, tienda y finanzas:

- **Facturación atómica**: `convertServiceOrderToInvoice` hace el claim de la orden y la inserción de la factura en una sola transacción con UPDATE condicional — no puede quedar una orden `facturado` sin factura ni quemarse consecutivos.
- **Política de estados**: los tres portales (admin, KDS, taller) pasan por `applyStatusPolicy`; `entregado` es terminal, una factura cerrada bloquea reversiones, y una proforma viva se anula con claim atómico al devolver el estado.
- **Reconciliación v14** (`reconcileOrderInvoiceLinks` + `reconcileAnnulledInvoices`): idempotente, repara vínculos rotos y proformas huérfanas comparando totales.
- **Trazabilidad**: eventos solo en cambios reales de estado, sin duplicados por claims concurrentes.
- **Stock de tienda**: `claimStockDecrement` con UPDATE condicional evita el doble descuento entre webhook y return.
- **Consecutivos**: generados con MAX+1 dentro de transacción de escritura (Turso serializa) — sin huecos ni duplicados.
- **Baja de cuenta**: anonimiza sin romper la trazabilidad del taller (que no depende de `user_id`).

## Hallazgos

### 1. ALTO — `/payment/return` marca la orden como pagada sin verificar firma (`routes/shop.js:354`)

La verificación es `if (sigHash && pending && !verifyBoldSignature(...))`: si la URL llega **sin** `bold-signature`, el chequeo se salta por completo y el bloque APPROVED marca la orden como `paid`, descuenta stock y envía correos de confirmación.

**Escenario de explotación**: un cliente crea su pedido, no paga en Bold, y visita a mano `/payment/return?bold-tx-status=APPROVED` (la cookie `bold_pending` con su orderId sigue viva 35 minutos) → pedido «pagado» gratis.

El webhook sí exige firma siempre; el return no.

**Corrección propuesta**: exigir firma para APPROVED (rechazar si falta) o tratar el return como informativo (`pending_confirmation`) y dejar que solo el webhook firmado confirme el pago.

### 2. MEDIO — El parqueadero cobrado nunca se contabiliza como ingreso (`routes/finanzas.js`)

Al entregar la moto, `total = subtotal + IVA + parking_amount`. Finanzas suma `subtotal` en el dashboard, la gráfica mensual y el desglose por método (correcto para excluir el IVA, que no es ingreso), pero el **parqueadero sí es ingreso real** y queda fuera de todos los reportes: solo aparece embebido en `total`. El ingreso operacional está subreportado por cada factura con parqueadero.

**Corrección propuesta**: sumar `subtotal + parkingAmount` en los agregados de ingresos.

### 3. MEDIO — El webhook de Bold permite regresión de estado (`routes/shop.js:414`)

`updateOrderStatus` es incondicional: un webhook `failed`/`PENDING` que llegue tardío o duplicado después de un `APPROVED` degrada la orden de `paid` a `failed`, con el stock ya descontado y el email ya enviado.

**Corrección propuesta**: guard de «no bajar desde paid» (UPDATE condicional `WHERE status != 'paid'` para estados no-APPROVED).

### 4. BAJO — Entrega sin claim atómico (`db.js:1864`)

`deliverServiceOrder` actualiza la factura sin condición `AND status = 'proforma'`. Un doble clic concurrente en `/entregar` pasa dos veces la validación (ambos requests leen `proforma`) y duplica los hitos `factura_cerrada`/`entregado`. Sin impacto monetario (los valores son los mismos), pero ensucia la trazabilidad.

**Corrección propuesta**: el mismo patrón de claim condicional que ya usa el resto del flujo.

### 5. BAJO — `getUpcomingEvents` usa fecha UTC (`db.js:1109`)

Usa `new Date().toISOString().slice(0,10)` en vez de `hoyCO()`: entre las 7 pm y medianoche hora Colombia, los eventos de «hoy» desaparecen de la lista de próximos eventos (UTC ya está en el día siguiente).

**Corrección propuesta**: usar `hoyCO()` de `helpers/datetime.js`.

## Pendientes de auditorías anteriores (sin cambios)

- Dashboards de finanzas cargan tablas completas (full-table) — no urgente.
- Desglose de medios de pago pendiente (auditoría financiera jul 2026).
