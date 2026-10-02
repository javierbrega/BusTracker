import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const DEMO_EMAIL = 'demo@local.test'
const DEMO_PASSWORD = 'Demo123456!'
const WHATSAPP_NUMBER = '5492996579823'
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

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
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState(DEMO_EMAIL)
  const [password, setPassword] = useState(DEMO_PASSWORD)
  const [activeTab, setActiveTab] = useState('horarios')
  const [selectedRoute, setSelectedRoute] = useState('520B')
  const [selectedStopName, setSelectedStopName] = useState('')
  const [selectedDestinationName, setSelectedDestinationName] = useState('')
  const [favorites, setFavorites] = useState(loadFavoriteRoutes)
  const [feedback, setFeedback] = useState('')
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [connectionError, setConnectionError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const isDemoSession = session?.isDemo === true

  useEffect(() => {
    if (!supabase) return undefined

    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (activeTab !== 'horarios') return

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
  }, [activeTab, refreshKey, selectedRoute])

  const routeStops = [...new Map(
    trips
      .flatMap(getStopTimes)
      .filter((stopTime) => stopTime.stops?.name)
      .map((stopTime) => [stopTime.stops.name, stopTime]),
  ).values()]
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
    ? nextDeparture.trip.service_days?.length === 5
      ? 'Lunes a viernes'
      : 'Días de servicio'
    : 'Lunes a viernes'
  const feedbackMessage = feedback.trim()
    ? `Hola, quiero dejar un comentario sobre BusTracker:\n\n${feedback.trim()}`
    : ''
  const feedbackUrl = feedbackMessage
    ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(feedbackMessage)}`
    : undefined

  const handleLogin = async (event) => {
    event.preventDefault()

    if (import.meta.env.DEV && email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      setSession({ user: { email }, isDemo: true })
      return
    }

    if (!supabase) {
      alert('Supabase no está configurado. Usa las credenciales demo precargadas.')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) alert(`Error al iniciar sesión: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    if (isDemoSession || !supabase) {
      setSession(null)
      return
    }
    const { error } = await supabase.auth.signOut()
    if (error) alert(`Error al cerrar sesión: ${error.message}`)
  }

  const selectRoute = (route) => {
    setSelectedRoute(route)
    setSelectedStopName('')
    setSelectedDestinationName('')
    setTrips([])
    setLoading(true)
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
    <div className="app-background">
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path d="M8 5.5h16a3 3 0 0 1 3 3v14a2 2 0 0 1-2 2h-1v2h-3v-2h-8v2h-3v-2H9a2 2 0 0 1-2-2v-14a3 3 0 0 1 3-3Z" fill="currentColor" />
                <path d="M10 8.5h12a2 2 0 0 1 2 2v6H8v-6a2 2 0 0 1 2-2Z" fill="#164e46" />
                <path d="M10 19.5h3m6 0h3" stroke="#164e46" strokeWidth="2" strokeLinecap="round" />
                <circle cx="11" cy="23" r="1" fill="#164e46" />
                <circle cx="21" cy="23" r="1" fill="#164e46" />
              </svg>
            </span>
            <div>
            <h1>BusTracker</h1>
              <p>Tu viaje, a tiempo</p>
            </div>
          </div>
          <button className="account-button" onClick={() => setActiveTab('login')}>
            {session ? 'Mi cuenta' : 'Ingresar'}
          </button>
        </header>

        {activeTab === 'horarios' ? (
          <main className="schedule-main">
            <section className="welcome-block">
              <p className="eyebrow">LÍNEA 520 · SAN RAFAEL / MONTE COMÁN</p>
              <h2>¿Dónde lo esperás?</h2>
              <p>Elegí un sentido y una parada para planificar tu viaje.</p>
            </section>

            <section className="route-picker" aria-label="Sentido del recorrido">
              {[
                { code: '520A', label: 'San Rafael', destination: 'Monte Comán', marker: 'A' },
                { code: '520B', label: 'Monte Comán', destination: 'San Rafael', marker: 'B' },
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
            </section>

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
                    <span className="stops-count">{nextStopTimes.length} paradas</span>
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
              Horarios programados de {serviceDaysLabel.toLowerCase()}. Pueden variar por tránsito o demoras; no es ubicación en vivo.
            </p>

            <section className="feedback-card" aria-labelledby="feedback-heading">
              <div className="feedback-heading">
                <span className="feedback-icon" aria-hidden="true">✳</span>
                <div>
                  <h2 id="feedback-heading">¿Cómo podemos mejorar?</h2>
                  <p>Tu opinión nos ayuda a mejorar BusTracker.</p>
                </div>
              </div>
              <label className="visually-hidden" htmlFor="feedback-message">
                Escribe tu comentario
              </label>
              <textarea
                id="feedback-message"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                maxLength={500}
                placeholder="Cuéntanos qué te pareció o qué te gustaría mejorar…"
                rows={3}
              />
              <div className="feedback-actions">
                <span>{feedback.length}/500 · Se enviará por WhatsApp</span>
                <a
                  href={feedbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!feedbackUrl}
                  onClick={(event) => {
                    if (!feedbackUrl) event.preventDefault()
                  }}
                  className={!feedbackUrl ? 'feedback-submit is-disabled' : 'feedback-submit'}
                >
                  <span aria-hidden="true">↗</span>
                  Enviar comentario
                </a>
              </div>
            </section>
            <footer className="app-credit">
              Diseñado y desarrollado por <strong>Brega Javier</strong>
              <span aria-hidden="true">·</span>
              2026
            </footer>
          </main>
        ) : (
          <main className="account-main">
            {session ? (
              <div className="account-card">
                <div className="account-check">✓</div>
                <div>
                  <h2>Sesión iniciada</h2>
                  <p>{session.user.email}</p>
                </div>
                <button onClick={handleLogout}>Cerrar sesión</button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="account-card login-form">
                <div>
                  <h2>Iniciar sesión</h2>
                  <p>Ingresa para guardar tus paradas favoritas.</p>
                  {import.meta.env.DEV && (
                    <p className="demo-hint">Modo demo local: usa las credenciales precargadas.</p>
                  )}
                </div>
                <label htmlFor="login-email">Email</label>
                <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
                <label htmlFor="login-password">Contraseña</label>
                <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
                <button type="submit" disabled={loading}>{loading ? 'Ingresando…' : 'Entrar'}</button>
              </form>
            )}
          </main>
        )}

        <nav className="bottom-nav" aria-label="Navegación principal">
          <button
            type="button"
            aria-current={activeTab === 'horarios' ? 'page' : undefined}
            onClick={() => setActiveTab('horarios')}
            className={activeTab === 'horarios' ? 'nav-active' : ''}
          >
            <span aria-hidden="true">◷</span>
            Horarios
          </button>
          <button
            type="button"
            aria-current={activeTab === 'login' ? 'page' : undefined}
            onClick={() => setActiveTab('login')}
            className={activeTab === 'login' ? 'nav-active' : ''}
          >
            <span aria-hidden="true">○</span>
            {session ? 'Mi cuenta' : 'Ingresar'}
          </button>
        </nav>
      </div>
    </div>
  )
}
