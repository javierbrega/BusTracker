# BusTracker

Aplicación web para consultar recorridos y horarios publicados de Iselín. Los horarios son programados y no representan la ubicación en vivo de los colectivos.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm
- Un proyecto Supabase para consultar recorridos y horarios

## Desarrollo local

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Completa `.env.local` con las variables de entorno de Supabase:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sin las variables de Supabase, la aplicación usa horarios de demostración de la línea 520. Nunca agregues `.env.local` al repositorio ni uses una clave `service_role` en el frontend.

Al ingresar por primera vez, la app solicita un nombre y lo guarda localmente en ese dispositivo. El selector de tema claro/oscuro también guarda su preferencia. La encuesta enlaza al formulario público de Google Forms.

## Catálogo de Iselín y carga de datos

El selector agrupa las líneas publicadas por Iselín y deja elegir una variante o sentido. La fuente de datos pública consultada es [`api_data` en Recorridos y Horarios de Iselín](https://logistica.iselinsa.com.ar/horarios_iselin). El importador valida e incluye grupos, variantes, geometrías disponibles, frecuencias, paradas y horarios por parada. La cantidad de datos puede cambiar cuando Iselín actualice su publicación.

Para preparar Supabase e importar una instantánea:

1. En el SQL Editor de Supabase, ejecuta [`20261004000000_add_iselin_route_catalog.sql`](./supabase/migrations/20261004000000_add_iselin_route_catalog.sql).
2. Genera archivos SQL pequeños con los datos validados:

   ```powershell
   npm run import:iselin -- --export-sql
   ```

   El comando crea la guía en `supabase/iselin-import/README.txt` y los lotes dentro de `supabase/iselin-import/sql/`. Abre y ejecuta cada archivo `.sql` de esa carpeta en el SQL Editor de Supabase **uno por vez, en orden alfabético**. Espera que cada consulta termine antes de ejecutar la siguiente y detente si alguna informa error. El último archivo, `050-cleanup.sql`, debe ejecutarse al final. Los lotes son repetibles si hay que reintentar uno. La sesión autenticada del editor realiza la escritura; no se usa ni se incluye ninguna clave API.

   Para validar los datos sin generar el archivo:

   ```powershell
   npm run import:iselin -- --dry-run
   ```

   Como alternativa avanzada, `.\scripts\import-iselin.ps1` carga directamente con la clave `service_role` introducida en un prompt oculto. Nunca la pegues en el código, en Vercel ni en el chat. El SQL generado y el importador directo reemplazan los horarios publicados de las variantes presentes en la instantánea.

La instantánea validada para este MVP contiene 23 grupos, 117 variantes, 755 frecuencias, 186 nombres de parada normalizados y 14.535 horarios de parada. Dos variantes de temporada alta (`515A-VERANO` y `515B-VERANO`) se publican sin geometría. La fuente pública no entrega coordenadas de cada parada; por eso, “Cerca de mí” compara la ubicación únicamente con los trazados disponibles y no recomienda paradas individuales. No se inventan coordenadas.

## Mapa de la línea 520 y ubicación cercana

El enlace **Ver mapa** abre una vista propia de los sentidos 520A y 520B. Este mapa aún usa un trazado orientativo sobre calles de OpenStreetMap; no es un trazado oficial ni muestra colectivos en vivo. El botón **Cerca de mí** de la pantalla principal no abre el mapa: solicita ubicación tras una acción explícita y muestra hasta cinco líneas cuyos trazados publicados están a 500 m o menos.

La ubicación se procesa en el navegador y BusTracker no la guarda ni la envía al servicio de mapas. La geometría de las líneas se carga desde Supabase al pulsar el botón. El mapa atribuye sus datos a [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), disponibles bajo ODbL.

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

## Mantener Supabase activo con UptimeRobot

El endpoint `GET` o `HEAD /api/keepalive` se despliega como una función de Vercel y hace una consulta de solo lectura a `routes`. Acepta ambos métodos porque los monitores HTTP pueden usar `HEAD`. Para configurarlo:

1. En Vercel, agrega la variable `KEEPALIVE_TOKEN` con un valor aleatorio largo y guárdala para **Production**. No la subas a GitHub.
2. Haz un nuevo deployment de producción para que la función reciba esa variable.
3. En UptimeRobot, crea o edita un monitor **HTTP(s)** con esta URL, sustituyendo el token por el mismo valor guardado en Vercel: `https://bustracker-ecru.vercel.app/api/keepalive?token=TU_TOKEN`.
4. Usa un intervalo disponible de hasta 24 horas. La función responde `200` solo si logra consultar Supabase; las solicitudes no autorizadas y los errores de base responden con códigos distintos de `200`.

El endpoint reutiliza `SUPABASE_URL` y `SUPABASE_ANON_KEY` si están configuradas en Vercel; si no, usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Nunca uses una clave `service_role`.

La función opcional `supabase/functions/keepalive` es una alternativa independiente y requiere un despliegue separado en Supabase.
