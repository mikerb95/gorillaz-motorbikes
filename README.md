# Gorillaz Motorbikes

Sitio web del taller con área de Club de Moteros (login, panel, membresía e historial de visitas).

## Ejecutar

1. Requisitos: Node.js 18+
2. Instalar dependencias:

```powershell
npm install
```

3. Desarrollo (recarga con nodemon):

```powershell
npm run dev
```

4. Producción:

```powershell
npm start
```

Sitio en http://localhost:3000

## Variables de entorno (opcional)

- `PORT` para cambiar el puerto.
- `SESSION_SECRET` para la sesión (usa un valor fuerte en prod).

## Despliegue en Vercel

1. Instala y conecta el proyecto:

```powershell
npm i -g vercel
vercel
```

2. Configura `SESSION_SECRET` en Vercel (Project Settings > Environment Variables) y despliega:

```powershell
vercel env add SESSION_SECRET production
vercel --prod
```

El archivo `vercel.json` ya enruta todos los paths a `api/index.js` (Express) y sirve los assets estáticos con caché.

## Demo de acceso al Club

- Correo: miembro@gorillaz.co
- Contraseña: gorillaz123

## Personalizar

- Vistas EJS en `views/`
- Estilos en `public/css/styles.css`
- Logos en `favicons/` e `images/`
- Usuarios demo en `server.js` (reemplazar por base de datos en producción)

## Servicios

- Mecánica
- Pintura
- Alistamiento tecnomecánica
- Electricidad
- Torno
- Prensa
- Mecánica rápida