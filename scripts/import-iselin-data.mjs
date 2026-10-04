import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(projectRoot, '.env.local')
const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
        return [line.slice(0, separator).trim(), value]
      }),
  )

const localEnv = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {}
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? localEnv.VITE_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dryRun = process.argv.includes('--dry-run')
const exportSql = process.argv.includes('--export-sql')
const sqlImportDirectory = path.join(projectRoot, 'supabase', 'iselin-import')
const sqlOutputDirectory = path.join(sqlImportDirectory, 'sql')
const legacySqlFilename =
  /^(000-route-groups|010-routes-\d{3}|020-stops|030-trips|040-stop-times-\d{3}|050-cleanup)\.sql$/
const apiUrl = `https://logistica.iselinsa.com.ar/horarios_iselin/api_data?t=${Date.now()}`
const batchSize = 500
const sqlBatchLimit = 256 * 1024

const normalizeStopName = (name) =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

const toServiceDays = (description) => {
  const text = description
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
  const days = new Set()

  if (text.includes('todos los dias')) {
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }
  if (/lunes\s+a\s+viernes/.test(text)) {
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) days.add(day)
  }
  if (/lunes\s+a\s+sabado/.test(text)) {
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']) {
      days.add(day)
    }
  }
  if (/lunes\s+a\s+domingo/.test(text)) {
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      days.add(day)
    }
  }

  const dayNames = [
    ['lunes', 'monday'],
    ['martes', 'tuesday'],
    ['miercoles', 'wednesday'],
    ['jueves', 'thursday'],
    ['viernes', 'friday'],
    ['sabado', 'saturday'],
    ['domingo', 'sunday'],
  ]
  for (const [spanish, english] of dayNames) {
    if (new RegExp(`\\b${spanish}s?\\b`).test(text)) days.add(english)
  }

  if (!days.size) {
    throw new Error(`No se pudieron interpretar los días de servicio: "${description}"`)
  }

  return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .filter((day) => days.has(day))
}

const chunks = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  )

const assertResult = (operation, result) => {
  if (result.error) {
    const { code, details, hint, message } = result.error
    const diagnostics = [code && `Código: ${code}`, details, hint && `Ayuda: ${hint}`]
      .filter(Boolean)
      .join('\n')
    throw new Error(`${operation}: ${message}${diagnostics ? `\n${diagnostics}` : ''}`)
  }
  return result.data
}

const fetchAll = async (query, operation) => {
  const rows = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const page = assertResult(
      operation,
      await query.range(offset, offset + pageSize - 1),
    )
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

const response = await fetch(apiUrl)
if (!response.ok) {
  throw new Error(`Iselín respondió con HTTP ${response.status}.`)
}
const source = await response.json()
if (!Array.isArray(source.groups) || !Array.isArray(source.routes?.features) || !Array.isArray(source.turnos)) {
  throw new Error('La respuesta de Iselín no tiene la estructura esperada.')
}

const groupsByRouteCode = new Map()
for (const group of source.groups) {
  for (const code of group.rule_ids ?? []) {
    if (groupsByRouteCode.has(code)) {
      throw new Error(`La variante ${code} pertenece a más de una línea.`)
    }
    groupsByRouteCode.set(code, group.id)
  }
}

const routes = source.routes.features.map((feature) => {
  const code = String(feature.properties?.id ?? '').trim()
  const groupId = groupsByRouteCode.get(code)
  if (!code || !groupId) {
    throw new Error(`No se pudo asociar el recorrido "${code}" a una línea.`)
  }
  return {
    code,
    name: String(feature.properties?.nombre ?? code).trim(),
    group_id: groupId,
    geometry:
      feature.geometry?.coordinates?.length > 0
        ? feature.geometry
        : null,
  }
})

const routeCodes = new Set(routes.map((route) => route.code))
const routeCodeBySourceTrip = new Map()
const sourceTrips = []
const sourceStops = new Map()
const stopTimeDrafts = []
const frequencyByRoute = new Map()

for (const schedule of source.turnos) {
  const code = `${schedule.line}${schedule.variant ?? ''}`
  if (!routeCodes.has(code)) {
    throw new Error(`El horario ${schedule.id} no tiene un recorrido ${code} publicado.`)
  }
  const serviceDescription = String(schedule.days_text ?? '').trim()
  for (const segment of schedule.segments ?? []) {
    if (!segment.id || routeCodeBySourceTrip.has(segment.id)) {
      throw new Error(`El identificador de frecuencia "${segment.id}" está vacío o repetido.`)
    }
    if (!Array.isArray(segment.stops) || segment.stops.length === 0) {
      throw new Error(`La frecuencia "${segment.id}" no contiene paradas.`)
    }

    routeCodeBySourceTrip.set(segment.id, code)
    const segmentServiceDescription = String(segment.days_text || serviceDescription).trim()
    const serviceDays = toServiceDays(segmentServiceDescription)
    const frequencyNumber = (frequencyByRoute.get(code) ?? 0) + 1
    frequencyByRoute.set(code, frequencyNumber)
    sourceTrips.push({
      source_id: segment.id,
      route_code: code,
      frequency_number: frequencyNumber,
      service_days: serviceDays,
      service_description: segmentServiceDescription,
      season: String(schedule.season ?? ''),
    })

    segment.stops.forEach((stop, index) => {
      const name = String(stop.location ?? '').trim()
      const normalizedName = normalizeStopName(name)
      const departureTime = String(stop.time ?? '').trim()
      if (!name || !normalizedName || !/^\d{1,2}:\d{2}$/.test(departureTime)) {
        throw new Error(`Parada u horario inválido en la frecuencia "${segment.id}".`)
      }

      if (!sourceStops.has(normalizedName)) {
        sourceStops.set(normalizedName, name)
      }
      stopTimeDrafts.push({
        source_id: segment.id,
        normalized_stop_name: normalizedName,
        stop_sequence: index + 1,
        departure_time: departureTime.length === 4 ? `0${departureTime}` : departureTime,
      })
    })
  }
}

const distinctSourceStopNames = new Set(
  source.turnos.flatMap((schedule) =>
    (schedule.segments ?? []).flatMap((segment) =>
      segment.stops.map((stop) => normalizeStopName(String(stop.location ?? ''))),
    ),
  ),
)

const summary = {
  routeGroups: source.groups.length,
  routeVariants: routes.length,
  schedules: source.turnos.length,
  trips: sourceTrips.length,
  stopNames: distinctSourceStopNames.size,
  stopTimes: stopTimeDrafts.length,
  routesWithoutGeometry: routes.filter((route) => !route.geometry).map((route) => route.code),
}

console.log('Datos verificados de Iselín:', JSON.stringify(summary, null, 2))
if (exportSql) {
  const sqlJson = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`
  const chunkForSql = (rows) => {
    const batches = []
    let batch = []

    for (const row of rows) {
      const candidate = [...batch, row]
      if (batch.length && Buffer.byteLength(sqlJson(candidate), 'utf8') > sqlBatchLimit) {
        batches.push(batch)
        batch = [row]
      } else {
        batch = candidate
      }
      if (Buffer.byteLength(sqlJson(batch), 'utf8') > sqlBatchLimit) {
        throw new Error('Un registro individual excede el límite de tamaño para exportar SQL.')
      }
    }

    if (batch.length) batches.push(batch)
    return batches
  }
  const writeBatches = (prefix, rows, buildSql) => {
    const batches = chunkForSql(rows)
    batches.forEach((batch, index) => {
      const sequence = String(index + 1).padStart(3, '0')
      const filename = `${prefix}-${sequence}.sql`
      fs.writeFileSync(path.join(sqlOutputDirectory, filename), buildSql(batch), 'utf8')
    })
    return batches.length
  }
  const doBlock = (payload, statements) => `do $iselin_import$
declare
  v_rows jsonb := ${sqlJson(payload)};
begin
${statements}
end
$iselin_import$;
`
  const groups = source.groups.map((group) => ({
    id: group.id,
    display_id: String(group.display_id),
    display_name: String(group.display_name),
    color: group.color ?? null,
    alert_message: group.alert_message ?? '',
    imported_at: new Date().toISOString(),
  }))
  fs.mkdirSync(sqlImportDirectory, { recursive: true })
  fs.mkdirSync(sqlOutputDirectory, { recursive: true })
  const removeGeneratedSqlFiles = (directory) => {
    for (const filename of fs.readdirSync(directory)) {
      if (legacySqlFilename.test(filename) || filename === 'README.txt') {
        fs.unlinkSync(path.join(directory, filename))
      }
    }
  }
  removeGeneratedSqlFiles(sqlImportDirectory)
  removeGeneratedSqlFiles(sqlOutputDirectory)
  const sqlRoutes = routes.map((route) => ({
    ...route,
    geometry: route.geometry
      ? {
          ...route.geometry,
          coordinates: route.geometry.coordinates.map((coordinate) =>
            coordinate.map((value) => Number(value.toFixed(6))),
          ),
        }
      : null,
  }))
  const stops = [...sourceStops].map(([source_key, name]) => ({ source_key, name }))
  const stopTimes = stopTimeDrafts.map((stopTime) => ({
    source_id: `${stopTime.source_id}:${stopTime.stop_sequence}`,
    trip_source_id: stopTime.source_id,
    normalized_stop_name: stopTime.normalized_stop_name,
    stop_sequence: stopTime.stop_sequence,
    departure_time: stopTime.departure_time,
  }))
  fs.writeFileSync(
    path.join(sqlOutputDirectory, '000-route-groups.sql'),
    doBlock(
      groups,
      `  insert into public.route_groups (id, display_id, display_name, color, alert_message, imported_at)
  select x.id, x.display_id, x.display_name, x.color, x.alert_message, x.imported_at
  from jsonb_to_recordset(v_rows) as x(
    id text, display_id text, display_name text, color text, alert_message text, imported_at timestamptz
  )
  on conflict (id) do update set
    display_id = excluded.display_id,
    display_name = excluded.display_name,
    color = excluded.color,
    alert_message = excluded.alert_message,
    imported_at = excluded.imported_at;`,
    ),
    'utf8',
  )
  const routeBatchCount = writeBatches(
    '010-routes',
    sqlRoutes,
    (batch) =>
      doBlock(
        batch,
        `  insert into public.routes (code, name, group_id, geometry)
  select x.code, x.name, x.group_id, x.geometry
  from jsonb_to_recordset(v_rows) as x(code text, name text, group_id text, geometry jsonb)
  on conflict (code) do update set
    name = excluded.name,
    group_id = excluded.group_id,
    geometry = excluded.geometry;`,
      ),
  )
  fs.writeFileSync(
    path.join(sqlOutputDirectory, '020-stops.sql'),
    doBlock(
      stops,
      `  insert into public.stops (source_key, name)
  select x.source_key, x.name
  from jsonb_to_recordset(v_rows) as x(source_key text, name text)
  on conflict (source_key) do update set name = excluded.name;`,
    ),
    'utf8',
  )
  fs.writeFileSync(
    path.join(sqlOutputDirectory, '030-trips.sql'),
    doBlock(
      sourceTrips,
      `  insert into public.trips (
    source_id, route_id, frequency_number, service_days, service_description, season
  )
  select x.source_id, r.id, x.frequency_number, x.service_days, x.service_description, x.season
  from jsonb_to_recordset(v_rows) as x(
    source_id text, route_code text, frequency_number integer, service_days text[],
    service_description text, season text
  )
  join public.routes r on r.code = x.route_code
  on conflict (source_id) do update set
    route_id = excluded.route_id,
    frequency_number = excluded.frequency_number,
    service_days = excluded.service_days,
    service_description = excluded.service_description,
    season = excluded.season;`,
    ),
    'utf8',
  )
  const stopTimeBatchCount = writeBatches(
    '040-stop-times',
    stopTimes,
    (batch) =>
      doBlock(
        batch,
        `  insert into public.stop_times (source_id, trip_id, stop_id, stop_sequence, departure_time)
  select x.source_id, t.id, s.id, x.stop_sequence, x.departure_time::time
  from jsonb_to_recordset(v_rows) as x(
    source_id text, trip_source_id text, normalized_stop_name text,
    stop_sequence integer, departure_time text
  )
  join public.trips t on t.source_id = x.trip_source_id
  join public.stops s on s.source_key = x.normalized_stop_name
  on conflict (source_id) do update set
    trip_id = excluded.trip_id,
    stop_id = excluded.stop_id,
    stop_sequence = excluded.stop_sequence,
    departure_time = excluded.departure_time;`,
      ),
  )
  const cleanup = doBlock(
    {
      tripSourceIds: sourceTrips.map((trip) => trip.source_id),
      routeCodes: routes.map((route) => route.code),
    },
    `  delete from public.stop_times st
  using public.trips t
  where st.trip_id = t.id
    and (
      (t.source_id is not null and not exists (
        select 1
        from jsonb_array_elements_text(v_rows->'tripSourceIds') as x(source_id)
        where x.source_id = t.source_id
      ))
      or (t.source_id is null and t.route_id in (
        select r.id
        from public.routes r
        where r.code in (
          select jsonb_array_elements_text(v_rows->'routeCodes')
        )
      ))
    );

  delete from public.trips t
  where (
    t.source_id is not null and not exists (
      select 1
      from jsonb_array_elements_text(v_rows->'tripSourceIds') as x(source_id)
      where x.source_id = t.source_id
    )
  ) or (
    t.source_id is null and t.route_id in (
      select r.id
      from public.routes r
      where r.code in (
        select jsonb_array_elements_text(v_rows->'routeCodes')
      )
    )
  );

  raise notice 'Importación completada: % líneas, % recorridos, % paradas, % frecuencias y % horarios.',
    ${groups.length},
    ${routes.length},
    ${stops.length},
    ${sourceTrips.length},
    ${stopTimes.length};`,
  )
  fs.writeFileSync(path.join(sqlOutputDirectory, '050-cleanup.sql'), cleanup, 'utf8')
  const sqlFiles = fs.readdirSync(sqlOutputDirectory).filter((file) => file.endsWith('.sql'))
  const largestFile = Math.max(
    ...sqlFiles.map((file) => fs.statSync(path.join(sqlOutputDirectory, file)).size),
  )
  if (largestFile > 400 * 1024) {
    throw new Error('Uno de los archivos SQL generados excede el límite seguro de tamaño.')
  }
  fs.writeFileSync(
    path.join(sqlImportDirectory, 'README.txt'),
    `Importación Iselín: ejecutar los archivos .sql en orden alfabético, uno por vez, en el SQL Editor de Supabase.
Si un archivo informa error, detenerse, corregirlo y volver a ejecutar ese archivo antes de continuar.
Los lotes son repetibles; 050-cleanup.sql debe ser el último.
Archivos SQL: ${sqlFiles.length}
Lotes de recorridos: ${routeBatchCount}
Lotes de horarios por parada: ${stopTimeBatchCount}
Máximo por archivo: ${largestFile} bytes
Ubicación de los archivos: supabase/iselin-import/sql/
No se necesita ninguna clave API.
`,
    'utf8',
  )
  console.log(`SQL dividido en ${sqlFiles.length} archivos: ${sqlOutputDirectory}`)
  console.log(`El archivo más grande ocupa ${largestFile} bytes.`)
  console.log('Ejecuta los archivos .sql en orden alfabético, uno por vez. No se requiere ninguna clave API.')
  console.log('No se requiere ni se incluye ninguna clave API.')
  process.exit(0)
}
if (dryRun) {
  console.log('Validación terminada sin escribir en Supabase.')
  process.exit(0)
}

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Configura VITE_SUPABASE_URL en .env.local y SUPABASE_SERVICE_ROLE_KEY como variable local de entorno para importar.',
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

for (const batch of chunks(
  source.groups.map((group) => ({
    id: group.id,
    display_id: String(group.display_id),
    display_name: String(group.display_name),
    color: group.color ?? null,
    alert_message: group.alert_message ?? '',
    imported_at: new Date().toISOString(),
  })),
  batchSize,
)) {
  assertResult(
    'No se pudieron guardar las líneas',
    await supabase.from('route_groups').upsert(batch, { onConflict: 'id' }),
  )
}

for (const batch of chunks(routes, batchSize)) {
  assertResult(
    'No se pudieron guardar los recorridos',
    await supabase.from('routes').upsert(batch, { onConflict: 'code' }),
  )
}

const routeRows = assertResult(
  'No se pudieron recuperar los recorridos guardados',
  await supabase.from('routes').select('id,code').in('code', routes.map((route) => route.code)),
)
const routeIdByCode = new Map(routeRows.map((route) => [route.code, route.id]))
if (routeIdByCode.size !== routes.length) {
  throw new Error('No se guardaron todas las variantes de recorrido.')
}

const existingStops = assertResult(
  'No se pudieron recuperar las paradas existentes',
  await supabase.from('stops').select('id,name,source_key'),
)
const canonicalStopByKey = new Map()
const existingIdByKey = new Map()
for (const stop of existingStops) {
  const key = stop.source_key || normalizeStopName(stop.name)
  if (!key) continue

  const canonicalId = existingIdByKey.get(key)
  if (canonicalId && canonicalId !== stop.id) {
    for (const batch of chunks([stop.id], 100)) {
      assertResult(
        'No se pudieron consolidar las paradas duplicadas',
        await supabase.from('stop_times').update({ stop_id: canonicalId }).eq('stop_id', batch[0]),
      )
    }
    assertResult(
      'No se pudieron quitar las paradas duplicadas',
      await supabase.from('stops').delete().eq('id', stop.id),
    )
    continue
  }

  existingIdByKey.set(key, stop.id)
  canonicalStopByKey.set(key, stop.name)
  if (stop.source_key !== key) {
    assertResult(
      'No se pudo asociar una parada existente',
      await supabase.from('stops').update({ source_key: key }).eq('id', stop.id),
    )
  }
}

const stopRowsToImport = [...sourceStops].map(([source_key, sourceName]) => ({
  source_key,
  name: canonicalStopByKey.get(source_key) ?? sourceName,
}))
for (const batch of chunks(stopRowsToImport, batchSize)) {
  assertResult(
    'No se pudieron guardar las paradas',
    await supabase.from('stops').upsert(batch, { onConflict: 'source_key' }),
  )
}

const importedStops = assertResult(
  'No se pudieron recuperar las paradas guardadas',
  await supabase.from('stops').select('id,source_key').in('source_key', [...sourceStops.keys()]),
)
const stopIdByKey = new Map(importedStops.map((stop) => [stop.source_key, stop.id]))
if (stopIdByKey.size !== sourceStops.size) {
  throw new Error('No se guardaron todas las paradas del catálogo.')
}

const routeIds = [...routeIdByCode.values()]
for (const batch of chunks(
  sourceTrips.map((trip) => ({
    source_id: trip.source_id,
    route_id: routeIdByCode.get(trip.route_code),
    frequency_number: trip.frequency_number,
    service_days: trip.service_days,
    service_description: trip.service_description,
    season: trip.season,
  })),
  batchSize,
)) {
  assertResult(
    'No se pudieron guardar los horarios',
    await supabase.from('trips').upsert(batch, { onConflict: 'source_id' }),
  )
}

const importedTrips = await fetchAll(
  supabase.from('trips').select('id,source_id,route_id').in('route_id', routeIds),
  'No se pudieron recuperar los horarios importados',
)
const tripIdBySourceId = new Map(
  importedTrips
    .filter((trip) => trip.source_id)
    .map((trip) => [trip.source_id, trip.id]),
)
if (sourceTrips.some((trip) => !tripIdBySourceId.has(trip.source_id))) {
  throw new Error('No se guardaron todas las frecuencias de servicio.')
}

const stopTimes = stopTimeDrafts.map((stopTime) => ({
  source_id: `${stopTime.source_id}:${stopTime.stop_sequence}`,
  trip_id: tripIdBySourceId.get(stopTime.source_id),
  stop_id: stopIdByKey.get(stopTime.normalized_stop_name),
  stop_sequence: stopTime.stop_sequence,
  departure_time: stopTime.departure_time,
}))
if (stopTimes.some((stopTime) => !stopTime.trip_id || !stopTime.stop_id)) {
  throw new Error('Hay horarios sin asociación a un viaje o parada.')
}
for (const batch of chunks(stopTimes, batchSize)) {
  assertResult(
    'No se pudieron guardar los horarios por parada',
    await supabase.from('stop_times').upsert(batch, { onConflict: 'source_id' }),
  )
}

const importedStopTimeKeys = new Set(stopTimes.map((stopTime) => stopTime.source_id))
const existingSourceStopTimes = await fetchAll(
  supabase
    .from('stop_times')
    .select('source_id,trip_id')
    .not('source_id', 'is', null),
  'No se pudieron revisar los horarios antiguos',
)
const staleStopTimes = existingSourceStopTimes.filter(
  (stopTime) => !importedStopTimeKeys.has(stopTime.source_id),
)
for (const batch of chunks(staleStopTimes.map((stopTime) => stopTime.source_id), 100)) {
  assertResult(
    'No se pudieron limpiar horarios obsoletos',
    await supabase.from('stop_times').delete().in('source_id', batch),
  )
}

const allSourceTrips = await fetchAll(
  supabase
    .from('trips')
    .select('id,source_id,route_id')
    .not('source_id', 'is', null),
  'No se pudieron revisar las frecuencias importadas',
)
const staleSourceTrips = allSourceTrips.filter(
  (trip) => trip.source_id && !routeCodeBySourceTrip.has(trip.source_id),
)
const legacyTrips = await fetchAll(
  supabase
    .from('trips')
    .select('id,source_id,route_id')
    .in('route_id', routeIds)
    .is('source_id', null),
  'No se pudieron revisar los horarios anteriores',
)
const tripsToRemove = [...staleSourceTrips, ...legacyTrips]
for (const batch of chunks(tripsToRemove.map((trip) => trip.id), 100)) {
  assertResult(
    'No se pudieron quitar horarios obsoletos',
    await supabase.from('stop_times').delete().in('trip_id', batch),
  )
  assertResult(
    'No se pudieron quitar frecuencias obsoletas',
    await supabase.from('trips').delete().in('id', batch),
  )
}

console.log('Importación de Iselín completada correctamente.')
