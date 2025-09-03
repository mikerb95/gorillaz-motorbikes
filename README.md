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