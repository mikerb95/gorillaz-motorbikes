# SEO — Gorillaz Motorbikes

Análisis y recomendaciones SEO para la página principal (`/`), basado en la revisión del código fuente actual (mayo 2026).

---

## Problemas críticos (impacto alto)

### 1. Sin `<meta name="description">`
El partial `views/partials/head.ejs` no incluye ninguna etiqueta de descripción. Google usa este texto en los resultados de búsqueda; sin él genera uno automático de baja calidad.

**Solución:** Agregar en `head.ejs`, justo después del `<title>`:
```html
<meta name="description" content="<%= description || 'Gorillaz Motorbikes — Taller de motos en Bogotá. Mecánica, pintura, electricidad, alistamiento tecnomecánica y tienda de accesorios.' %>" />
```
Y pasar `description` desde cada ruta. Para la home:
```js
res.render('home', { ..., description: 'Taller de motos en Bogotá: mecánica, pintura, electricidad, alistamiento tecnomecánica y escaneo. Agenda tu cita en Gorillaz Motorbikes.' });
```

---

### 2. Sin etiqueta `<h1>` en la página principal
`views/home.ejs` arranca directamente con `<h2>Servicios destacados</h2>`. No hay `<h1>`. Google le da peso especial al H1 para entender el tema de la página.

**Solución:** Agregar un H1 visible (o visualmente oculto si el diseño lo requiere) antes de la sección de servicios, o dentro del hero:
```html
<h1 class="sr-only">Gorillaz Motorbikes — Taller de motos en Bogotá</h1>
```
O, mejor, hacerlo visible como subtítulo dentro del hero slideshow.

---

### 3. Sin Open Graph ni Twitter Card
No hay metaetiquetas OG ni Twitter Card. Cuando alguien comparte el sitio en WhatsApp, Instagram o Twitter, no aparece imagen ni descripción previsualizada.

**Solución:** Agregar en `head.ejs`:
```html
<!-- Open Graph -->
<meta property="og:type"        content="website" />
<meta property="og:site_name"   content="Gorillaz Motorbikes" />
<meta property="og:title"       content="<%= title || 'Gorillaz Motorbikes' %>" />
<meta property="og:description" content="<%= description || 'Taller de motos en Bogotá — mecánica, pintura, electricidad, tienda de accesorios.' %>" />
<meta property="og:image"       content="<%= ogImage || 'https://gorillazmotorbikes.com/images/og-default.jpg' %>" />
<meta property="og:url"         content="https://gorillazmotorbikes.com<%= canonicalPath || '' %>" />
<!-- Twitter Card -->
<meta name="twitter:card"        content="summary_large_image" />
<meta name="twitter:title"       content="<%= title || 'Gorillaz Motorbikes' %>" />
<meta name="twitter:description" content="<%= description || 'Taller de motos en Bogotá.' %>" />
<meta name="twitter:image"       content="<%= ogImage || 'https://gorillazmotorbikes.com/images/og-default.jpg' %>" />
```
Crear `/images/og-default.jpg` (1200×630 px) con logo y slogan sobre fondo de marca.

---

### 4. Sin `robots.txt` ni `sitemap.xml`
No existen estos archivos en `/public`. Sin ellos, Google no sabe qué rastrear ni qué ignorar.

**robots.txt** → crear `public/robots.txt`:
```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /club/panel
Disallow: /carrito
Disallow: /checkout
Sitemap: https://gorillazmotorbikes.com/sitemap.xml
```

**sitemap.xml** → crear `public/sitemap.xml` (o generarlo dinámicamente desde una ruta `/sitemap.xml`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://gorillazmotorbikes.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://gorillazmotorbikes.com/servicios</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>https://gorillazmotorbikes.com/tienda</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>
  <url><loc>https://gorillazmotorbikes.com/cursos</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
  <url><loc>https://gorillazmotorbikes.com/eventos</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>
  <url><loc>https://gorillazmotorbikes.com/club</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://gorillazmotorbikes.com/faq</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>https://gorillazmotorbikes.com/mision</loc><changefreq>yearly</changefreq><priority>0.4</priority></url>
  <url><loc>https://gorillazmotorbikes.com/vision</loc><changefreq>yearly</changefreq><priority>0.4</priority></url>
</urlset>
```
Para productos e incluir URLs dinámicas, generar el sitemap desde Express leyendo el catálogo.

---

### 5. Sin datos estructurados (JSON-LD)
Google usa schema markup para mostrar resultados enriquecidos (rich results): dirección, teléfono, horario, valoraciones, productos. El sitio no tiene ninguno.

**Agregar en `home.ejs`** antes de `include('partials/footer')`:
```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "AutoRepair",
  "name": "Gorillaz Motorbikes",
  "url": "https://gorillazmotorbikes.com",
  "logo": "https://gorillazmotorbikes.com/images/nobg_logo/logo_transp.png",
  "image": "https://gorillazmotorbikes.com/images/og-default.jpg",
  "description": "Taller de motos en Bogotá: mecánica, pintura, electricidad, alistamiento tecnomecánica, escaneo, torno y tienda de accesorios.",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Bogotá",
    "addressCountry": "CO"
  },
  "telephone": "+573213204299",
  "sameAs": [
    "https://www.facebook.com/gorillazmotorbikes",
    "https://www.instagram.com/gorillazmotorbikes"
  ],
  "priceRange": "$$",
  "openingHoursSpecification": []
}
</script>
```
Completar `openingHoursSpecification` con el horario real del taller.

---

## Problemas importantes (impacto medio)

### 6. Título de la home page genérico
Actualmente el `<title>` es simplemente `"Gorillaz Motorbikes"`. Las búsquedas locales incluyen términos como "taller de motos Bogotá" o "mecánica motos Bogotá".

**Solución:** Cambiar el título pasado desde la ruta home:
```js
title: 'Gorillaz Motorbikes | Taller de motos en Bogotá'
```

---

### 7. Sin URL canónica
Páginas accesibles con y sin `www`, con parámetros de query, etc. pueden generar contenido duplicado. Agregar en `head.ejs`:
```html
<link rel="canonical" href="https://gorillazmotorbikes.com<%= canonicalPath || '' %>" />
```
Pasar `canonicalPath: req.path` desde cada ruta.

---

### 8. Las tarjetas de servicio no son enlaces
En `home.ejs`, los bloques `<div class="service-card">` muestran servicios pero no son `<a>` etiquetas (excepto los 3 "Próximamente"). Google no puede seguir ningún enlace hacia las páginas de cada servicio desde la home.

**Solución:** Convertir cada service-card en un enlace `<a href="/servicios#mecanica">`, como ya se hace con los servicios "Próximamente". Esto también mejora la accesibilidad.

---

### 9. Imágenes del hero sin `preload`
El slideshow carga sus imágenes vía JavaScript. La imagen inicial del hero es probablemente el elemento LCP (Largest Contentful Paint). Sin preload, Google PageSpeed la penaliza.

**Solución:** Agregar en `head.ejs` un preload condicional para la primera imagen del slideshow:
```html
<% if (typeof slides !== 'undefined' && slides.length) { %>
  <link rel="preload" as="image" href="<%= slides[0].image %>" />
<% } %>
```
Y asegurarse de que las imágenes del hero estén en formato WebP (ya lo están según las rutas del código).

---

### 10. Imágenes sin atributos `width` y `height`
El logo (`logo_transp.png`, `logo-name.png`) y las imágenes de productos en la sección "Equípate con lo mejor" no tienen atributos `width` y `height` explícitos. Esto causa CLS (Cumulative Layout Shift), que penaliza el ranking.

**Solución:** Agregar dimensiones explícitas a todos los `<img>` que no los tengan:
```html
<img src="/images/nobg_logo/logo_transp.png" alt="Gorillaz Motorbikes" width="48" height="48" />
```
Para los productos, definir dimensiones fijas en el HTML del loop de `featuredProducts`.

---

## Oportunidades adicionales (impacto bajo/medio)

### 11. Página FAQ sin schema FAQPage
`/faq` existe pero no tiene JSON-LD de tipo `FAQPage`. Google puede mostrar las preguntas directamente en los resultados de búsqueda (rich snippets), lo que aumenta el CTR.

### 12. Sección de mapa sin NAP estructurado
El footer dice "Bogotá, Colombia" pero no incluye dirección completa, teléfono ni horario en texto HTML legible. Estos datos (NAP: Name, Address, Phone) deben aparecer en texto plano además del schema JSON-LD para reforzar el SEO local.

### 13. Google Business Profile
Asegurarse de que el perfil de Google Business esté verificado, con la misma dirección y nombre que aparece en el sitio. Las reseñas de Google Business impactan directamente en el posicionamiento local ("pack" de 3 resultados de mapas).

### 14. Atributos `lang` por sección
El sitio tiene `<html lang="es">` ✓, pero si en algún momento se agrega contenido en otro idioma, usar `lang` a nivel de elemento.

### 15. Velocidad de carga — revisión periódica
Herramientas a usar: [PageSpeed Insights](https://pagespeed.web.dev/) y [Search Console](https://search.google.com/search-console). Los principales vectores de mejora ya cubiertos en el código:
- Google Fonts con `preconnect` ✓
- CSS/JS con cache inmutable en Vercel ✓
- Imágenes en WebP ✓
- reCAPTCHA con `async defer` ✓

---

## Resumen de prioridades

| # | Problema | Dificultad | Impacto |
|---|----------|-----------|---------|
| 1 | Meta description faltante | Baja | Alta |
| 2 | Sin `<h1>` | Baja | Alta |
| 3 | Sin Open Graph / Twitter Card | Baja | Alta |
| 4 | Sin `robots.txt` y `sitemap.xml` | Baja | Alta |
| 5 | Sin JSON-LD (LocalBusiness) | Media | Alta |
| 6 | Título genérico en home | Baja | Media |
| 7 | Sin URL canónica | Baja | Media |
| 8 | Service-cards sin enlace | Baja | Media |
| 9 | Imágenes hero sin preload | Baja | Media |
| 10 | Imágenes sin width/height (CLS) | Media | Media |
| 11 | FAQ sin schema FAQPage | Baja | Baja |
| 12 | NAP en texto plano | Baja | Baja |
| 13 | Google Business Profile | Externa | Alta |
