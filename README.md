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
- `VITE_GOOGLE_FORM_URL` (opcional): enlace publicado del formulario de Google. Por ahora, si no se define, se usa el enlace provisorio `https://forms.google.com/`.

Sin las variables de Supabase, la aplicación usa horarios de demostración. Nunca agregues `.env.local` al repositorio ni uses una clave `service_role` en el frontend.

Al ingresar por primera vez, la app solicita un nombre y lo guarda localmente en ese dispositivo. El selector de tema claro/oscuro también guarda su preferencia. Cuando esté listo el formulario, reemplaza `VITE_GOOGLE_FORM_URL` por su enlace público de Google Forms (dominios `docs.google.com` o `forms.gle`) y vuelve a desplegar.

## Mapa estimado y ubicación cercana

El enlace **Ver mapa** abre una vista propia de los sentidos 520A y 520B. El trazado es orientativo: se calculó sobre calles de OpenStreetMap pasando por San Rafael, Goudge, La Llave y Monte Comán, y no es un trazado oficial ni muestra colectivos en vivo. Las recomendaciones de paradas cercanas quedan pendientes hasta disponer de coordenadas verificadas para cada parada.

El botón **Cerca de mí** solo solicita permiso de ubicación cuando la persona lo pulsa. La posición se usa en el navegador para comparar con la línea estimada dentro de 500 m y centrar el mapa; BusTracker no la guarda. Al centrar el mapa, OpenStreetMap recibe solicitudes de teselas para el área visible. El mapa atribuye los datos a [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), disponibles bajo ODbL.

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
4. En **Settings → Environment Variables**, agrega `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y, si usarás la encuesta, `VITE_GOOGLE_FORM_URL` para los entornos que vayas a desplegar.
5. Despliega o vuelve a desplegar el proyecto.

Las variables con prefijo `VITE_` se incluyen en el código del navegador. La clave anon de Supabase es pública por diseño: protege las tablas con políticas RLS y no configures una clave `service_role` como variable `VITE_`.

## Mantener Supabase activo con UptimeRobot

El endpoint `GET` o `HEAD /api/keepalive` se despliega como una función de Vercel y hace una consulta de solo lectura a `routes`. Acepta ambos métodos porque los monitores HTTP pueden usar `HEAD`. Para configurarlo:

1. En Vercel, agrega la variable `KEEPALIVE_TOKEN` con un valor aleatorio largo y guárdala para **Production**. No la subas a GitHub.
2. Haz un nuevo deployment de producción para que la función reciba esa variable.
3. En UptimeRobot, crea o edita un monitor **HTTP(s)** con esta URL, sustituyendo el token por el mismo valor guardado en Vercel: `https://bustracker-ecru.vercel.app/api/keepalive?token=TU_TOKEN`.
4. Usa un intervalo disponible de hasta 24 horas. La función responde `200` solo si logra consultar Supabase; las solicitudes no autorizadas y los errores de base responden con códigos distintos de `200`.

El endpoint reutiliza `SUPABASE_URL` y `SUPABASE_ANON_KEY` si están configuradas en Vercel; si no, usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Nunca uses una clave `service_role`.

La función opcional `supabase/functions/keepalive` es una alternativa independiente y requiere un despliegue separado en Supabase.
