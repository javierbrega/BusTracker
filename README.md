# BusTracker

Aplicación web para consultar horarios programados de la línea 520. Los horarios son estimados y no representan la ubicación en vivo de los colectivos.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm
- Un proyecto Supabase para consultar los horarios reales

## Desarrollo local

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Completa `.env.local` con las variables de entorno de Supabase:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sin esas variables, la aplicación usa horarios de demostración. Nunca agregues `.env.local` al repositorio ni uses una clave `service_role` en el frontend.

## Verificación de producción

```powershell
npm run lint
npm run build
```

Vite genera el sitio listo para publicar en `dist`.

## Publicar en Vercel

1. Importa este repositorio desde GitHub en Vercel.
2. Usa la carpeta raíz del repositorio como **Root Directory**.
3. Vercel detecta Vite; los valores son `npm run build` para **Build Command** y `dist` para **Output Directory**.
4. En **Settings → Environment Variables**, agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` para los entornos que vayas a desplegar.
5. Despliega o vuelve a desplegar el proyecto.

Las variables con prefijo `VITE_` se incluyen en el código del navegador. La clave anon de Supabase es pública por diseño: protege las tablas con políticas RLS y no configures una clave `service_role` como variable `VITE_`.

La función opcional `supabase/functions/keepalive` no se despliega junto con la web en Vercel; requiere un despliegue separado en Supabase.
