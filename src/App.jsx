import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { findNearbyRouteGroups } from './lib/routeProximity'

const RouteMap = lazy(() => import('./components/RouteMap'))

const NAME_STORAGE_KEY = 'bustracker:user-name'
const THEME_STORAGE_KEY = 'bustracker:dark-mode'
const GOOGLE_FORM_URL =
  import.meta.env.VITE_GOOGLE_FORM_URL?.trim() || 'https://forms.google.com/'
const IS_PROVISIONAL_GOOGLE_FORM_URL = !import.meta.env.VITE_GOOGLE_FORM_URL?.trim()
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const loadSavedName = () => {
  try {
    return window.localStorage.getItem(NAME_STORAGE_KEY) ?? ''
  } catch (error) {
    console.error('No se pudo leer el nombre guardado:', error)
    return ''
  }
}

const loadDarkMode = () => {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'true'
  } catch (error) {
    console.error('No se pudo leer la preferencia de tema:', error)
    return false
  }
}

const isGoogleFormUrl = (formUrl) => {
  try {
    const url = new URL(formUrl)
    return url.protocol === 'https:' &&
      (url.hostname === 'docs.google.com' || url.hostname === 'forms.gle')
  } catch {
    return false
  }
}

const HAS_GOOGLE_FORM_URL = isGoogleFormUrl(GOOGLE_FORM_URL)

const buildDemoTrips = (route) => {
  const names =
    route === '520A'
      ? ['Terminal San Rafael', 'Bolívar y Mitre', 'Goudge', 'Monte Comán']
      : ['Monte Comán', 'Goudge', 'Bolívar y Mitre', 'Terminal San Rafael']
  const times =
    route === '520A'
      ? [['06:40', '06:50', '07:30', '08:00'], ['10:20', '10:50', '11:15', '11:55'], ['23:20', '23:40', '00:10', '00:45']]
      : [['05:30', '05:42', '06:10', '06:45'], ['11:55', '12:07', '12:35', '13:15'], ['21:00', '21:12', '21:40', '22:20']]

  return times.map((stopTimes, index) => ({
    id: `${route}-${index + 1}`,
    frequency_number: index + 1,
    service_days: WEEKDAYS,
    stop_times: stopTimes.map((departure_time, stopIndex) => ({
      departure_time,
      stop_sequence: stopIndex + 1,
      stops: { name: names[stopIndex] },
    })),
  }))
}

const timeToMinutes = (time) => {
  const [hours, minutes] = time.slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

const formatTime = (time) => time?.slice(0, 5) ?? '--:--'

const getStopTimes = (trip) =>
  [...(trip.stop_times ?? [])].sort(
    (first, second) => first.stop_sequence - second.stop_sequence,
  )

const getUpcomingDepartures = (trips, selectedStop, destinationStop, now, count = 4) => {
  if (!selectedStop) return []

  const upcoming = []
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (const trip of trips) {
    const stopTimes = getStopTimes(trip)
    const serviceDays = trip.service_days?.length ? trip.service_days : WEEKDAYS
    const selectedIndex = stopTimes.findIndex(
      (stopTime) => stopTime.stops?.name === selectedStop,
    )
    const destinationIndex = stopTimes.findIndex(
      (stopTime) => stopTime.stops?.name === destinationStop,
    )

    if (selectedIndex < 0) continue

    let dayOffset = 0
    let previousMinutes = -1
    let selectedDayOffset = 0
    let destinationDayOffset = 0

    stopTimes.forEach((stopTime, index) => {
      const minutes = timeToMinutes(stopTime.departure_time)
      if (minutes < previousMinutes) dayOffset += 1
      if (index === selectedIndex) selectedDayOffset = dayOffset
      if (index === destinationIndex) destinationDayOffset = dayOffset
      previousMinutes = minutes
    })

    for (let offset = -selectedDayOffset; offset <= 7; offset += 1) {
      const serviceDate = new Date(today)
      serviceDate.setDate(today.getDate() + offset)

      if (!serviceDays.includes(DAY_NAMES[serviceDate.getDay()])) continue

      const stopDate = new Date(serviceDate)
      stopDate.setDate(serviceDate.getDate() + selectedDayOffset)
      const [hours, minutes] = stopTimes[selectedIndex].departure_time
        .slice(0, 5)
        .split(':')
        .map(Number)
      stopDate.setHours(hours, minutes, 0, 0)

      if (stopDate >= now) {
        const arrivalDate = new Date(serviceDate)
        arrivalDate.setDate(serviceDate.getDate() + destinationDayOffset)
        const [arrivalHours, arrivalMinutes] = stopTimes[destinationIndex]?.departure_time
          ?.slice(0, 5)
          .split(':')
          .map(Number) ?? [hours, minutes]
        arrivalDate.setHours(arrivalHours, arrivalMinutes, 0, 0)

        upcoming.push({
          trip,
          stopTimes,
          selectedIndex,
          destinationIndex,
          departure: stopDate,
          arrival: arrivalDate,
          serviceDate,
        })
      }
    }
  }

  return upcoming.sort((first, second) => first.departure - second.departure).slice(0, count)
}

const formatDayLabel = (date, now) => {
  if (date.toDateString() === now.toDateString()) return 'Hoy'
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return 'Mañana'
  return date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
}

const getTimeUntil = (date, now) => {
  const minutes = Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 60_000))
  if (minutes < 1) return 'Programado ahora'
  if (minutes < 60) return `En ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes
    ? `En ${hours} h ${remainingMinutes} min`
    : `En ${hours} h`
}

const loadFavoriteRoutes = () => {
  try {
    const favorites = JSON.parse(window.localStorage.getItem('bustracker:favorites') ?? '[]')
    return Array.isArray(favorites) ? favorites : []
  } catch (error) {
    console.error('No se pudieron leer las paradas favoritas:', error)
    return []
  }
}

export default function App() {
  const [userName, setUserName] = useState(loadSavedName)
  const [nameInput, setNameInput] = useState(userName)
  const [showWelcomeScreen, setShowWelcomeScreen] = useState(!userName)
  const [isDarkMode, setIsDarkMode] = useState(loadDarkMode)
  const [isMapPage] = useState(
    () => new URLSearchParams(window.location.search).get('vista') === 'mapa',
  )
  const [selectedRoute, setSelectedRoute] = useState(() =>
    new URLSearchParams(window.location.search).get('route') === '520A'
      ? '520A'
      : '520B',
  )
  const [selectedStopName, setSelectedStopName] = useState('')
  const [selectedDestinationName, setSelectedDestinationName] = useState('')
  const [favorites, setFavorites] = useState(loadFavoriteRoutes)
  const [trips, setTrips] = useState([])
  const [routeCatalog, setRouteCatalog] = useState([])
  const [routeGroups, setRouteGroups] = useState([])
  const [catalogError, setCatalogError] = useState('')
  const [nearbyStatus, setNearbyStatus] = useState('idle')
  const [nearbyMessage, setNearbyMessage] = useState('')
  const [nearbyLines, setNearbyLines] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [connectionError, setConnectionError] = useState('')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (isMapPage || !supabase) return undefined

    let cancelled = false
    const loadRouteCatalog = async () => {
      try {
        const [groupsResult, routesResult] = await Promise.all([
          supabase
            .from('route_groups')
            .select('id,display_id,display_name,alert_message')
            .order('display_id')
            .order('display_name'),
          supabase
            .from('routes')
            .select(
              'code,name,group_id,group:route_groups!routes_group_id_fkey(id,display_id,display_name,alert_message)',
            )
            .order('code'),
        ])

        if (groupsResult.error) throw groupsResult.error
        if (routesResult.error) throw routesResult.error
        if (cancelled) return

        const loadedRoutes = routesResult.data ?? []
        setRouteGroups(groupsResult.data ?? [])
        setRouteCatalog(loadedRoutes)
        setSelectedRoute((currentRoute) =>
          loadedRoutes.some((route) => route.code === currentRoute)
            ? currentRoute
            : loadedRoutes.find((route) => route.code === '520B')?.code ??
              loadedRoutes[0]?.code ??
              currentRoute,
        )
        setCatalogError('')
      } catch (error) {
        console.error('Error cargando el catálogo de recorridos:', error)
        if (!cancelled) {
          setCatalogError(
            'No pudimos cargar todas las líneas. Puedes seguir consultando los recorridos disponibles.',
          )
        }
      }
    }

    loadRouteCatalog()
    return () => {
      cancelled = true
    }
  }, [isMapPage])

  useEffect(() => {
    if (isMapPage) return undefined

    let cancelled = false
    const loadTrips = async () => {
      if (!supabase) {
        setTrips(buildDemoTrips(selectedRoute))
        setLoading(false)
        return
      }

      setLoading(true)
      setConnectionError('')

      try {
        const { data, error } = await supabase
          .from('trips')
          .select(`
            id,
            frequency_number,
            service_days,
            service_description,
            season,
            routes!inner(code, name),
            stop_times(departure_time, stop_sequence, stops(name))
          `)
          .eq('routes.code', selectedRoute)
          .order('frequency_number', { ascending: true })
          .order('stop_sequence', { ascending: true, referencedTable: 'stop_times' })

        if (error) throw error
        if (!cancelled) {
          const loadedTrips = data ?? []
          setTrips(loadedTrips)
        }
      } catch (error) {
        console.error('Error cargando horarios:', error)
        if (!cancelled) {
          setConnectionError(error.message || 'No se pudieron cargar los horarios.')
          setTrips([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadTrips()
    return () => {
      cancelled = true
    }
  }, [isMapPage, refreshKey, selectedRoute])

  const routeStops = [...new Map(
    trips
      .flatMap(getStopTimes)
      .filter((stopTime) => stopTime.stops?.name)
      .map((stopTime) => [stopTime.stops.name, stopTime]),
  ).values()]
  const selectedRouteInfo = routeCatalog.find(
    (route) => route.code === selectedRoute,
  )
  const selectedRouteGroup = routeGroups.find(
    (group) => group.id === selectedRouteInfo?.group_id,
  )
  const selectedStop =
    routeStops.find((stopTime) => stopTime.stops.name === selectedStopName)?.stops.name ??
    routeStops[0]?.stops.name ??
    ''
  const selectedRouteStopIndex = routeStops.findIndex(
    (stopTime) => stopTime.stops.name === selectedStop,
  )
  const destinationStops = routeStops.slice(selectedRouteStopIndex + 1)
  const selectedDestination =
    destinationStops.find((stopTime) => stopTime.stops.name === selectedDestinationName)?.stops.name ??
    destinationStops[destinationStops.length - 1]?.stops.name ??
    ''
  const upcomingDepartures = getUpcomingDepartures(
    trips,
    selectedStop,
    selectedDestination,
    now,
  )
  const nextDeparture = upcomingDepartures[0]
  const nextStopTimes = nextDeparture?.stopTimes ?? []
  const selectedStopIndex = nextDeparture?.selectedIndex ?? -1
  const destinationStopTime =
    nextStopTimes[nextDeparture?.destinationIndex ?? -1]
  const journeyDuration = nextDeparture
    ? Math.max(0, Math.round((nextDeparture.arrival - nextDeparture.departure) / 60_000))
    : 0
  const isFavorite = favorites.some(
    (favorite) => favorite.route === selectedRoute && favorite.stop === selectedStop,
  )
  const routePreviewStops = nextStopTimes
    .map((stopTime, index) => ({ stopTime, index }))
    .filter(({ index }) => Math.abs(index - selectedStopIndex) <= 1)
  const serviceDaysLabel = nextDeparture
    ? nextDeparture.trip.service_description ||
      (nextDeparture.trip.service_days?.length === 5
        ? 'Lunes a viernes'
        : 'días de servicio')
    : 'Lunes a viernes'
  const hasSpecialServiceCalendar = /feriad|receso|apertura|temporada/i.test(
    serviceDaysLabel,
  )
  const handleNameSubmit = (event) => {
    event.preventDefault()
    const nextName = nameInput.trim()
    if (!nextName) return

    try {
      window.localStorage.setItem(NAME_STORAGE_KEY, nextName)
    } catch (error) {
      console.error('No se pudo guardar el nombre:', error)
      window.alert('No se pudo guardar tu nombre en este dispositivo.')
    }
    setUserName(nextName)
    setShowWelcomeScreen(false)
  }

  const toggleDarkMode = () => {
    const nextDarkMode = !isDarkMode
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, String(nextDarkMode))
    } catch (error) {
      console.error('No se pudo guardar la preferencia de tema:', error)
      window.alert('No se pudo guardar el tema en este dispositivo.')
    }
    setIsDarkMode(nextDarkMode)
  }

  const selectRoute = (route) => {
    setSelectedRoute(route)
    setSelectedStopName('')
    setSelectedDestinationName('')
    setTrips([])
    setLoading(true)
  }

  const findNearbyLines = () => {
    if (!routeCatalog.length) {
      setNearbyStatus('error')
      setNearbyMessage('El catálogo de recorridos todavía no está disponible.')
      setNearbyLines([])
      return
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setNearbyStatus('error')
      setNearbyMessage(
        'La ubicación requiere una conexión segura y un navegador compatible.',
      )
      setNearbyLines([])
      return
    }

    setNearbyStatus('loading')
    setNearbyMessage('')
    setNearbyLines([])

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const { data, error } = await supabase
            .from('routes')
            .select(
              'code,name,group_id,geometry,group:route_groups!routes_group_id_fkey(id,display_id,display_name)',
            )
            .not('geometry', 'is', null)
          if (error) throw error

          const matches = findNearbyRouteGroups(
            { latitude: coords.latitude, longitude: coords.longitude },
            data ?? [],
          )
          setNearbyLines(matches.slice(0, 5))
          setNearbyStatus('ready')
          setNearbyMessage(
            matches.length
              ? 'Recorridos publicados a menos de 500 m de tu ubicación:'
              : 'No encontramos recorridos publicados a menos de 500 m. La cobertura puede variar según la información disponible.',
          )
        } catch (error) {
          console.error('Error buscando recorridos cercanos:', error)
          setNearbyStatus('error')
          setNearbyMessage(
            'No pudimos consultar los trazados cercanos. Inténtalo de nuevo más tarde.',
          )
        }
      },
      (error) => {
        setNearbyStatus('error')
        setNearbyMessage(
          error.code === 1
            ? 'No tenemos permiso para acceder a tu ubicación. Puedes habilitarlo desde el navegador.'
            : error.code === 2
              ? 'No pudimos obtener tu ubicación. Comprueba el GPS e inténtalo otra vez.'
              : error.code === 3
                ? 'La solicitud de ubicación tardó demasiado. Inténtalo otra vez.'
                : 'No se pudo obtener tu ubicación.',
        )
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  const toggleFavorite = () => {
    if (!selectedStop) return
    const nextFavorites = isFavorite
      ? favorites.filter(
          (favorite) => !(favorite.route === selectedRoute && favorite.stop === selectedStop),
        )
      : [...favorites, { route: selectedRoute, stop: selectedStop }]

    try {
      window.localStorage.setItem('bustracker:favorites', JSON.stringify(nextFavorites))
      setFavorites(nextFavorites)
    } catch (error) {
      console.error('No se pudo guardar la parada favorita:', error)
      window.alert('No se pudo guardar esta parada en este dispositivo.')
    }
  }

  const selectFavorite = (favorite) => {
    if (favorite.route !== selectedRoute) selectRoute(favorite.route)
    setSelectedStopName(favorite.stop)
    setSelectedDestinationName('')
  }

  return (
    <div
      className={`app-background ${isMapPage ? 'map-background' : ''}`}
      data-theme={isDarkMode ? 'dark' : 'light'}
    >
      <div
        className={`app-frame ${isMapPage ? 'map-frame' : ''} ${showWelcomeScreen ? 'welcome-frame' : ''}`}
      >
        {isMapPage ? (
          <Suspense fallback={<div className="map-loading">Cargando mapa…</div>}>
            <RouteMap
              selectedRoute={selectedRoute}
              onSelectRoute={setSelectedRoute}
              isDarkMode={isDarkMode}
            />
          </Suspense>
        ) : showWelcomeScreen ? (
          <main className="welcome-screen">
            <div className="welcome-topline">
              <span>RECORRIDOS Y HORARIOS · SAN RAFAEL</span>
              <button
                type="button"
                className="theme-toggle"
                role="switch"
                aria-checked={isDarkMode}
                aria-label={isDarkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
                onClick={toggleDarkMode}
              >
                <span aria-hidden="true">{isDarkMode ? '☀' : '☾'}</span>
              </button>
            </div>
            <div className="welcome-content">
              <p className="welcome-kicker">TU VIAJE EMPIEZA ACÁ</p>
              <h1>Tu viaje,<br />a tiempo.</h1>
              <p className="welcome-description">
                Consulta recorridos y horarios publicados por Iselín y organiza tu próximo viaje.
              </p>
              <form className="welcome-form" onSubmit={handleNameSubmit}>
                <label htmlFor="user-name">¿Cómo te llamas?</label>
                <input
                  id="user-name"
                  type="text"
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value)}
                  placeholder="Por ejemplo, Javier"
                  maxLength={40}
                  autoComplete="given-name"
                  required
                  autoFocus
                />
                <button type="submit">
                  Comenzar mi viaje
                  <span aria-hidden="true">→</span>
                </button>
              </form>
            </div>
          </main>
        ) : (
          <>
        <header className="app-header">
          <div className="brand-lockup">
            <div>
              <h1>¡Hola, {userName}!</h1>
              <p>Tu viaje, a tiempo</p>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="name-edit"
              onClick={() => {
                setNameInput(userName)
                setShowWelcomeScreen(true)
              }}
              aria-label="Cambiar nombre"
              title="Cambiar nombre"
            >
              Editar
            </button>
            <button
              type="button"
              className="theme-toggle"
              role="switch"
              aria-checked={isDarkMode}
              aria-label={isDarkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
              onClick={toggleDarkMode}
            >
              <span aria-hidden="true">{isDarkMode ? '☀' : '☾'}</span>
            </button>
          </div>
        </header>

          <main className="schedule-main">
            <section className="welcome-block">
              <p className="eyebrow">
                {selectedRouteInfo
                  ? selectedRouteGroup?.display_name ?? selectedRouteInfo.name
                  : 'LÍNEA 520 · SAN RAFAEL / MONTE COMÁN'}
              </p>
              <h2>¿A dónde vamos hoy?</h2>
              <p>Elegí una línea, un recorrido y una parada para planificar tu viaje.</p>
            </section>

            {routeCatalog.length ? (
              <section className="route-catalog" aria-label="Líneas y recorridos">
                <div className="route-catalog-controls">
                  <div className="journey-select-field">
                    <label htmlFor="route-catalog-select">Línea y recorrido</label>
                    <div className="select-wrap">
                      <span className="select-pin" aria-hidden="true">↔</span>
                      <select
                        id="route-catalog-select"
                        value={selectedRoute}
                        onChange={(event) => selectRoute(event.target.value)}
                      >
                        {routeGroups.map((group) => {
                          const groupRoutes = routeCatalog.filter(
                            (route) => route.group_id === group.id,
                          )
                          if (!groupRoutes.length) return null
                          return (
                            <optgroup key={group.id} label={group.display_name}>
                              {groupRoutes.map((route) => (
                                <option key={route.code} value={route.code}>
                                  {route.name}
                                </option>
                              ))}
                            </optgroup>
                          )
                        })}
                      </select>
                      <span className="select-chevron" aria-hidden="true">⌄</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="nearby-button nearby-home-button"
                    onClick={findNearbyLines}
                    disabled={nearbyStatus === 'loading'}
                    aria-busy={nearbyStatus === 'loading'}
                  >
                    <span className="nearby-home-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8.5" />
                        <circle cx="12" cy="12" r="2.5" />
                        <path d="M12 1.5v3M12 19.5v3M1.5 12h3m15 0h3" />
                      </svg>
                    </span>
                    <span className="nearby-home-copy">
                      <strong>
                        {nearbyStatus === 'loading'
                          ? 'Buscando recorridos cercanos…'
                          : 'Buscar recorridos cercanos'}
                      </strong>
                      <small>
                        {nearbyStatus === 'loading'
                          ? 'Consultando tu ubicación'
                          : 'Trazados publicados a menos de 500 m'}
                      </small>
                    </span>
                    <span className="nearby-home-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
                {selectedRouteGroup?.alert_message && (
                  <p className="route-alert" role="note">
                    {selectedRouteGroup.alert_message}
                  </p>
                )}
                {nearbyMessage && (
                  <div className="nearby-home-results" role="status" aria-live="polite">
                    <p>{nearbyMessage}</p>
                    {nearbyLines.map((line) => (
                      <button
                        type="button"
                        key={line.groupId}
                        onClick={() => selectRoute(line.routeCode)}
                      >
                        <strong>{line.groupName}</strong>
                        <span>{line.routeCode} · a {line.distance} m</span>
                      </button>
                    ))}
                    {nearbyStatus === 'ready' && (
                      <small>
                        Se compara tu ubicación con el trazado publicado; no se guarda ni se muestran paradas cercanas.
                      </small>
                    )}
                  </div>
                )}
                {catalogError && (
                  <p className="catalog-error" role="status">{catalogError}</p>
                )}
              </section>
            ) : (
              <section className="route-picker" aria-label="Sentido del recorrido">
                {[
                  { code: '520A', label: 'San Rafael', destination: 'Monte Comán' },
                  { code: '520B', label: 'Monte Comán', destination: 'San Rafael' },
                ].map((route) => (
                  <button
                    key={route.code}
                    type="button"
                    aria-pressed={selectedRoute === route.code}
                    onClick={() => selectRoute(route.code)}
                    className={`route-option ${selectedRoute === route.code ? 'is-selected' : ''}`}
                  >
                    <span className="route-badge">{route.code}</span>
                    <span className="route-names">
                      <strong>{route.label}</strong>
                      <span>hacia {route.destination}</span>
                    </span>
                    <span className="route-arrow" aria-hidden="true">↗</span>
                  </button>
                ))}
                {catalogError && (
                  <p className="catalog-error" role="status">{catalogError}</p>
                )}
              </section>
            )}

            <section className="stop-field">
              <div className="journey-select-grid">
                <div className="journey-select-field">
                  <label htmlFor="stop-select">Desde</label>
                  <div className="select-wrap">
                    <span className="select-pin" aria-hidden="true">●</span>
                    <select
                      id="stop-select"
                      value={selectedStop}
                      onChange={(event) => {
                        setSelectedStopName(event.target.value)
                        setSelectedDestinationName('')
                      }}
                      disabled={!routeStops.length || loading}
                    >
                      {routeStops.length ? (
                        routeStops.map((stopTime) => (
                          <option key={stopTime.stops.name} value={stopTime.stops.name}>
                            {stopTime.stops.name}
                          </option>
                        ))
                      ) : (
                        <option value="">Cargando paradas…</option>
                      )}
                    </select>
                    <span className="select-chevron" aria-hidden="true">⌄</span>
                  </div>
                </div>
                <div className="journey-select-field">
                  <label htmlFor="destination-select">Hasta</label>
                  <div className="select-wrap">
                    <span className="destination-pin" aria-hidden="true">■</span>
                    <select
                      id="destination-select"
                      value={selectedDestination}
                      onChange={(event) => setSelectedDestinationName(event.target.value)}
                      disabled={!destinationStops.length || loading}
                    >
                      {destinationStops.length ? (
                        destinationStops.map((stopTime) => (
                          <option key={stopTime.stops.name} value={stopTime.stops.name}>
                            {stopTime.stops.name}
                          </option>
                        ))
                      ) : (
                        <option value="">Fin del recorrido</option>
                      )}
                    </select>
                    <span className="select-chevron" aria-hidden="true">⌄</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={`favorite-toggle ${isFavorite ? 'is-favorite' : ''}`}
                onClick={toggleFavorite}
                disabled={!selectedStop || loading}
                aria-pressed={isFavorite}
              >
                <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
                {isFavorite ? 'Parada guardada' : 'Guardar esta parada'}
              </button>
              {favorites.length > 0 && (
                <div className="favorite-stops" aria-label="Paradas favoritas">
                  <span className="favorite-stops-label">TUS FAVORITOS</span>
                  <div className="favorite-chips">
                    {favorites.map((favorite) => (
                      <button
                        type="button"
                        key={`${favorite.route}-${favorite.stop}`}
                        onClick={() => selectFavorite(favorite)}
                        className={`favorite-chip ${favorite.route === selectedRoute && favorite.stop === selectedStop ? 'is-current' : ''}`}
                      >
                        <span>{favorite.route}</span>
                        {favorite.stop}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {connectionError && (
              <div role="status" className="error-banner">
                <span>{connectionError}</span>
                <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
                  Reintentar
                </button>
              </div>
            )}

            {loading ? (
              <div className="state-card">Buscando próximos horarios…</div>
            ) : connectionError ? (
              <div className="state-card error-state">
                No pudimos cargar los horarios. Revisa la conexión e inténtalo de nuevo.
              </div>
            ) : !routeStops.length ? (
              <div className="state-card">
                <p>Todavía no hay horarios para el sentido {selectedRoute}.</p>
                <button
                  type="button"
                  onClick={() => selectRoute(selectedRoute === '520A' ? '520B' : '520A')}
                >
                  Ver el otro sentido
                </button>
              </div>
            ) : !nextDeparture ? (
              <div className="state-card">No hay más servicios programados en los próximos días.</div>
            ) : (
              <>
                <section
                  key={`${selectedRoute}-${selectedStop}-${selectedDestination}-${nextDeparture.departure.toISOString()}`}
                  className="next-service-card"
                  aria-labelledby="next-trip-heading"
                >
                  <div className="service-card-top">
                    <div className="service-label">
                      <span className="service-indicator" />
                      <span>PRÓXIMO SERVICIO</span>
                    </div>
                    <span className="day-pill">{formatDayLabel(nextDeparture.departure, now)}</span>
                  </div>
                  <div className="service-time-row">
                    <div>
                      <h2 id="next-trip-heading">{formatTime(nextDeparture.departure.toTimeString())}</h2>
                      <p className="countdown">{getTimeUntil(nextDeparture.departure, now)}</p>
                    </div>
                    <div className="frequency-pill">
                      <span>FRECUENCIA</span>
                      <strong>#{nextDeparture.trip.frequency_number}</strong>
                    </div>
                  </div>
                  <div className="service-destination">
                    <span className="destination-arrow" aria-hidden="true">→</span>
                  <span>Hasta <strong>{selectedDestination || 'Fin del recorrido'}</strong></span>
                  <time>{destinationStopTime ? formatTime(destinationStopTime.departure_time) : '--:--'}</time>
                  </div>
                  {destinationStopTime && (
                  <p className="arrival-caption">
                    Llegada estimada {formatTime(nextDeparture.arrival.toTimeString())}
                    <span>·</span>
                    {journeyDuration} min de viaje
                  </p>
                  )}
                </section>

                <section
                  key={`route-${selectedRoute}-${selectedStop}-${selectedDestination}`}
                  className="route-preview"
                  aria-label="Paradas cercanas del recorrido"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">EL RECORRIDO</p>
                      <h2>Tu viaje, de un vistazo</h2>
                    </div>
                    <div className="route-preview-actions">
                      <span className="stops-count">{nextStopTimes.length} paradas</span>
                      {['520A', '520B'].includes(selectedRoute) && (
                        <a
                          className="route-map-link"
                          href={`/?vista=mapa&route=${selectedRoute}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span aria-hidden="true">⌖</span>
                          Ver mapa
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="route-track">
                    <div className="track-line" aria-hidden="true">
                      <span className="track-progress" />
                    </div>
                    {routePreviewStops.map(({ stopTime, index }) => {
                      const isSelected = index === selectedStopIndex
                      const isDestination = index === nextDeparture.destinationIndex
                      const label = isSelected
                        ? 'TU PARADA'
                        : isDestination
                          ? 'TU DESTINO'
                        : index === 0
                          ? 'ORIGEN'
                          : index === nextStopTimes.length - 1
                            ? 'DESTINO'
                            : index < selectedStopIndex
                              ? 'PARADA ANTERIOR'
                              : 'SIGUIENTE PARADA'

                      return (
                        <div
                          key={`${stopTime.stop_sequence}-${stopTime.stops?.name}`}
                          className={`track-stop ${isSelected ? 'selected-track-stop' : ''} ${isDestination ? 'destination-track-stop' : ''}`}
                        >
                          <span className={`track-dot ${isSelected ? 'selected-dot' : 'route-dot'}`}>
                            {isSelected && <span />}
                          </span>
                          <span className="track-copy">
                            <span>{label}</span>
                            <strong>{stopTime.stops?.name}</strong>
                          </span>
                          <time>{formatTime(stopTime.departure_time)}</time>
                        </div>
                      )
                    })}
                  </div>
                </section>

                {upcomingDepartures.length > 1 && (
                  <details className="more-services">
                    <summary>
                      <span>Ver otras salidas</span>
                      <span className="more-count">{upcomingDepartures.length - 1}</span>
                      <span className="details-chevron" aria-hidden="true">⌄</span>
                    </summary>
                    <div className="other-services-list">
                      {upcomingDepartures.slice(1).map((departure) => (
                        <div key={`${departure.trip.id}-${departure.departure.toISOString()}`} className="other-service">
                          <span className="other-time">{formatTime(departure.departure.toTimeString())}</span>
                          <span>{formatDayLabel(departure.departure, now)}</span>
                          <span>Frecuencia #{departure.trip.frequency_number}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <details className="full-itinerary">
                  <summary>
                    <span>Ver todas las paradas y horarios</span>
                    <span className="details-chevron" aria-hidden="true">⌄</span>
                  </summary>
                  <ol>
                    {nextStopTimes.map((stopTime, index) => {
                      const isSelected = stopTime.stops?.name === selectedStop
                      return (
                        <li key={`${stopTime.stop_sequence}-${stopTime.stops?.name}`} className={isSelected ? 'itinerary-current' : ''}>
                          <span className="itinerary-marker">{isSelected ? '●' : index + 1}</span>
                          <span>{stopTime.stops?.name}</span>
                          <time>{formatTime(stopTime.departure_time)}</time>
                        </li>
                      )
                    })}
                  </ol>
                </details>
              </>
            )}

            <p className="estimate-note">
              <span aria-hidden="true">ⓘ</span>
              Horarios programados: {serviceDaysLabel.toLowerCase()}
              {nextDeparture?.trip.season && nextDeparture.trip.season !== 'ANUAL'
                ? ` · ${nextDeparture.trip.season}`
                : ''}. Pueden variar por tránsito o demoras; no es ubicación en vivo.
              {hasSpecialServiceCalendar &&
                ' La app no calcula el calendario de feriados ni condiciones estacionales; confirma el servicio.'}
            </p>

            <section className="feedback-card survey-card" aria-labelledby="survey-heading">
              <div className="feedback-heading">
                <span className="feedback-icon" aria-hidden="true">✳</span>
                <div>
                  <h2 id="survey-heading">Encuesta de Google</h2>
                  <p>Este enlace es provisorio hasta crear el formulario.</p>
                </div>
              </div>
              <div className="feedback-actions">
                <span>
                  {IS_PROVISIONAL_GOOGLE_FORM_URL
                    ? 'Enlace provisorio; lo cambiaremos al crear la encuesta.'
                    : HAS_GOOGLE_FORM_URL
                      ? 'Este enlace abre la encuesta de Google.'
                      : 'Configura un enlace válido de Google Forms.'}
                </span>
                <a
                  href={HAS_GOOGLE_FORM_URL ? GOOGLE_FORM_URL : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!HAS_GOOGLE_FORM_URL}
                  onClick={(event) => {
                    if (!HAS_GOOGLE_FORM_URL) event.preventDefault()
                  }}
                  className={!HAS_GOOGLE_FORM_URL ? 'feedback-submit is-disabled' : 'feedback-submit'}
                >
                  <span aria-hidden="true">↗</span>
                  {IS_PROVISIONAL_GOOGLE_FORM_URL ? 'Abrir Google Forms' : 'Responder encuesta'}
                </a>
              </div>
            </section>
            <footer className="app-credit">
              Diseñado y desarrollado por <strong>Brega Javier</strong>
              <span aria-hidden="true">·</span>
              2026
            </footer>
          </main>
          </>
        )}
      </div>
    </div>
  )
}
