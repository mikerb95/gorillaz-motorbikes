# Pendientes — Auditoría de seguridad

> Estado al **2026-06-09**. Documento de traspaso para la próxima sesión.
> La auditoría de seguridad está **completa a nivel de código**: los 7 hallazgos
> están corregidos. Lo que queda abajo son **acciones operativas** (de tu lado) y
> **mejoras opcionales** de endurecimiento a futuro.

---

## ✅ Hecho (referencia rápida)

| # | Hallazgo | Fix |
|---|----------|-----|
| — | Webhook de pago aceptaba órdenes sin firma (fraude) | `routes/shop.js` — exige firma + secreto siempre |
| — | `.env.vercel` (OIDC token) trackeado en git | añadido a `.gitignore` + `git rm --cached` |
| 1 | Sin cabeceras de seguridad | `app.js` — helmet + CSP a medida |
| 2 | Fuerza bruta del PIN del taller | `db.js`/`routes/taller.js` — throttle global `security_throttle` + PIN 6 díg. |
| 3 | JWT sin revocación | `db.js`/`middleware/locals.js`/`routes/club.js` — `token_version` |
| 4 | Enumeración de cuentas en registro | mitigado con reCAPTCHA + rate-limit (decisión: no rediseñar) |
| 5 | Sin reCAPTCHA en auth / `/runt` sin límite | `routes/club.js` + `routes/runt.js` |

Detalle completo en la memoria del proyecto: `project_security_audit.md`.

---

## 🔴 ACCIONES OPERATIVAS (hacer antes/al desplegar)

### 1. Configurar las claves de reCAPTCHA en Vercel
Sin estas variables, el captcha es un **no-op**: el sitio funciona igual pero la
protección de #4 y #5 **no está activa**.
- `RECAPTCHA_SITE_KEY`
- `RECAPTCHA_SECRET_KEY`

Crear las claves (reCAPTCHA v2 "No soy un robot") en
https://www.google.com/recaptcha/admin y añadirlas con `vercel env add` (o el
dashboard) para los entornos Production/Preview.

### 2. Probar la CSP de helmet en un deploy Preview antes de Producción
La CSP nueva (`app.js`) limita de qué orígenes se cargan recursos. Está pensada
para los que usa el sitio (Google Fonts, reCAPTCHA, Leaflet/mapas, Vercel Blob),
pero **si algún recurso quedó fuera, se bloqueará** y aparecerá en la consola del
navegador como error de "Content Security Policy".
- Abrir el Preview, revisar la consola en: home, panel del club, mapas/eventos,
  tienda (imágenes desde Blob), login (widget reCAPTCHA).
- Si algo se bloquea: añadir el origen a la directiva correspondiente en `app.js`.

### 3. Push
Todo está **committeado localmente** (un hook auto-commitea las ediciones) pero
**nada se ha pusheado** todavía. Revisar `git log origin/main..HEAD` y hacer push
cuando esté validado.

---

## 🟡 DECISIONES YA TOMADAS (contexto, no requieren acción)

- **Captcha en login**: se activa en **cada** inicio de sesión cuando configures
  las claves. Si genera fricción, se puede quitar solo del login (dejándolo en
  registro/olvidé) en 1 línea de `routes/club.js`. El login ya está protegido por
  rate-limit aparte.
- **Enumeración en registro (#4)**: se decidió **NO** rediseñar el flujo. Se
  mantiene el mensaje "correo/cédula ya en uso" por UX y se acepta el riesgo,
  mitigado por reCAPTCHA + rate-limit. Si en el futuro se quiere eliminar de raíz,
  habría que mover la confirmación a correo (quita el auto-login actual).
- **PINs existentes de 4-5 díg.**: siguen funcionando (el login acepta 4–6). Solo
  los PINs **nuevos** exigen 6 dígitos. Conviene rotar los viejos a 6 cuando se
  pueda, desde el panel admin.

---

## 🔧 MEJORAS OPCIONALES DE ENDURECIMIENTO (a futuro, no urgentes)

1. **CSP con nonces** — hoy la CSP mantiene `'unsafe-inline'` en `script-src` y
   `style-src` porque las plantillas EJS usan scripts/estilos/`onclick` inline.
   Eso limita la protección real contra XSS. El siguiente nivel sería migrar a
   nonces por request y quitar los inline. Es trabajo amplio (tocar muchas vistas).

2. **Throttle del PIN: compromiso conocido (DoS)** — el bloqueo tras 20 fallos es
   **global** (no por empleado, porque el PIN no identifica a quién). Un atacante
   podría forzar el bloqueo ~15 min y dejar el login por PIN inutilizable. Por eso
   el **fallback correo+contraseña** es importante. Solución definitiva: pedir un
   identificador de empleado antes del PIN para bloquear por-cuenta, o migrar fuera
   de PINs.

3. **Gap de testing local vs Turso** — los tests locales corren con SQLite
   (`file::memory:`), que acepta sentencias que Turso (libsql remoto) rechaza
   (p. ej. `PRAGMA` — ya nos mordió una vez, ver más abajo). Para blindarlo: un
   smoke test de arranque en CI contra una BD Turso de staging.

4. **Rate-limit en serverless** — `express-rate-limit` usa store en memoria
   (por-instancia). El throttle del PIN sí es global porque va en BD, pero el resto
   de limiters (login, /runt, carrito) son por-instancia. Para protección robusta
   multi-instancia, respaldarlos con un store compartido (la BD o Upstash Redis).

---

## ℹ️ Notas de contexto

- **Bug de arranque ya resuelto** (no es pendiente): `initDb` usaba
  `PRAGMA user_version`, que Turso rechaza → 500 en todas las rutas. Corregido
  (commit `49f07d7`) usando la tabla `schema_meta`. Mencionado aquí solo para que
  no se reintroduzca.
- **Esquema de BD**: `SCHEMA_VERSION` en `db.js` se sube +1 por cada cambio de
  tabla/columna/índice. Esta auditoría lo dejó en **4** (token_version) y añadió la
  tabla `security_throttle`.
