import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import LanguageSwitcher from './LanguageSwitcher'
import { estimatedRoutes } from '../data/estimatedRoutes'
import { translations } from '../lib/translations'

const NEARBY_RADIUS_METERS = 500
const distanceToRoute = (position, coordinates) => {
  const metersPerLatitudeDegree = 111_132
  const metersPerLongitudeDegree =
    111_320 * Math.cos((position.latitude * Math.PI) / 180)
  let closestDistance = Number.POSITIVE_INFINITY

  for (let index = 1; index < coordinates.length; index += 1) {
    const first = coordinates[index - 1]
    const second = coordinates[index]
    const firstX = (first[0] - position.longitude) * metersPerLongitudeDegree
    const firstY = (first[1] - position.latitude) * metersPerLatitudeDegree
    const secondX = (second[0] - position.longitude) * metersPerLongitudeDegree
    const secondY = (second[1] - position.latitude) * metersPerLatitudeDegree
    const segmentX = secondX - firstX
    const segmentY = secondY - firstY
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2
    const projection = segmentLengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            -(firstX * segmentX + firstY * segmentY) / segmentLengthSquared,
          ),
        )
      : 0
    const nearestX = firstX + projection * segmentX
    const nearestY = firstY + projection * segmentY
    closestDistance = Math.min(closestDistance, Math.hypot(nearestX, nearestY))
  }

  return Math.round(closestDistance)
}

const getGeolocationError = (error) => {
  if (error.code === 1) {
    return 'locationPermission'
  }
  if (error.code === 2) {
    return 'locationUnavailable'
  }
  if (error.code === 3) {
    return 'locationTimedOut'
  }
  return 'locationFailed'
}

export default function RouteMap({
  selectedRoute,
  onSelectRoute,
  isDarkMode,
  language,
  onLanguageChange,
}) {
  const t = translations[language]
  const mapElement = useRef(null)
  const mapInstance = useRef(null)
  const zoomControl = useRef(null)
  const routeLayers = useRef({})
  const endpointLayer = useRef(null)
  const userMarker = useRef(null)
  const [locationStatus, setLocationStatus] = useState('idle')
  const [locationMessage, setLocationMessage] = useState('')
  const [nearbyRoutes, setNearbyRoutes] = useState([])

  useEffect(() => {
    const map = L.map(mapElement.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([-34.64, -68.1], 9)

    zoomControl.current = L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    }).addTo(map)

    Object.entries(estimatedRoutes).forEach(([code, route]) => {
      const coordinates = route.coordinates.map(([longitude, latitude]) => [
        latitude,
        longitude,
      ])
      routeLayers.current[code] = L.polyline(coordinates, {
        color: '#45546b',
        weight: 4,
        opacity: 0.48,
        dashArray: '10 8',
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map)
    })

    endpointLayer.current = L.layerGroup().addTo(map)
    mapInstance.current = map

    return () => {
      map.remove()
      mapInstance.current = null
      zoomControl.current = null
    }
  }, [])

  useEffect(() => {
    const container = zoomControl.current?.getContainer()
    container?.querySelector('.leaflet-control-zoom-in')?.setAttribute('title', t.zoomIn)
    container?.querySelector('.leaflet-control-zoom-out')?.setAttribute('title', t.zoomOut)
  }, [language, t.zoomIn, t.zoomOut])

  useEffect(() => {
    const map = mapInstance.current
    if (!map) return

    Object.entries(routeLayers.current).forEach(([code, layer]) => {
      const isSelected = code === selectedRoute
      layer.setStyle({
        color: isSelected ? '#ef7138' : '#45546b',
        weight: isSelected ? 6 : 4,
        opacity: isSelected ? 0.95 : 0.48,
      })
    })

    const route = estimatedRoutes[selectedRoute]
    const coordinates = route.coordinates.map(([longitude, latitude]) => [
      latitude,
      longitude,
    ])
    const bounds = L.latLngBounds(coordinates)
    map.fitBounds(bounds, { padding: [42, 42], maxZoom: 11 })

    endpointLayer.current.clearLayers()
    const endpoints = [
      { coordinates: route.coordinates[0], label: `${t.startLabel} · ${route.start}` },
      {
        coordinates: route.coordinates[route.coordinates.length - 1],
        label: `${t.endLabel} · ${route.end}`,
      },
    ]

    endpoints.forEach(({ coordinates: [longitude, latitude], label }) => {
      L.circleMarker([latitude, longitude], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#ef7138',
        fillOpacity: 1,
      })
        .bindTooltip(label, { direction: 'top', offset: [0, -8] })
        .addTo(endpointLayer.current)
    })
  }, [language, selectedRoute, t])

  useEffect(() => {
    userMarker.current?.setTooltipContent(t.currentLocation)
  }, [language, t])

  const findNearbyRoutes = () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationStatus('error')
      setLocationMessage('secureLocationRequired')
      return
    }

    setLocationStatus('loading')
    setLocationMessage('')
    setNearbyRoutes([])

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = {
          latitude: coords.latitude,
          longitude: coords.longitude,
        }
        const distances = Object.entries(estimatedRoutes)
          .map(([code, route]) => ({
            code,
            distance: distanceToRoute(position, route.coordinates),
          }))
          .sort((first, second) => first.distance - second.distance)

        setNearbyRoutes(
          distances.filter(({ distance }) => distance <= NEARBY_RADIUS_METERS),
        )
        setLocationStatus('ready')
        setLocationMessage(
          distances.some(({ distance }) => distance <= NEARBY_RADIUS_METERS)
            ? ''
            : 'noEstimatedRouteNearby',
        )

        const map = mapInstance.current
        if (map) {
          const location = L.latLng(position.latitude, position.longitude)
          map.setView(location, 13)
          if (userMarker.current) userMarker.current.remove()
          userMarker.current = L.circleMarker(location, {
            radius: 8,
            color: '#fff',
            weight: 3,
            fillColor: '#2674e8',
            fillOpacity: 1,
          })
            .bindTooltip(t.currentLocation, { direction: 'top', offset: [0, -8] })
            .addTo(map)
        }
      },
      (error) => {
        setLocationStatus('error')
        setLocationMessage(getGeolocationError(error))
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  return (
    <main className={`route-map-page ${isDarkMode ? 'map-dark' : ''}`}>
      <header className="route-map-header">
        <a className="map-back-link" href="/" aria-label={t.mapBack}>
          <span aria-hidden="true">←</span>
        {t.mapBack}
        </a>
        <div className="map-title">
        <span>{t.mapEyebrow}</span>
        <h1>{t.mapTitle}</h1>
        </div>
        <LanguageSwitcher
        language={language}
        onChange={onLanguageChange}
        labels={t}
        className="map-language-switcher"
        />
      </header>

      <section className="route-map-controls" aria-label={t.mapOptions}>
        <div className="map-route-switch" role="group" aria-label={t.routeDirection}>
          {Object.keys(estimatedRoutes).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={selectedRoute === code}
              className={selectedRoute === code ? 'map-route-selected' : ''}
              onClick={() => onSelectRoute(code)}
            >
              {code}
            </button>
          ))}
        </div>
        <p className="map-route-description">
          {selectedRoute === '520A' ? t.route520A : t.route520B} · {t.via} Goudge {t.and} La Llave
        </p>
        <button
          type="button"
          className="nearby-button"
          onClick={findNearbyRoutes}
          disabled={locationStatus === 'loading'}
        >
          <span aria-hidden="true">⌖</span>
          {locationStatus === 'loading'
            ? t.searchingLocation
            : t.nearbyMe}
        </button>
      </section>

      <div
        className="route-map-canvas"
        ref={mapElement}
        role="region"
        aria-label={t.mapRouteAria}
      />

      <aside className="route-map-info">
        {locationStatus === 'ready' && nearbyRoutes.length > 0 && (
          <div className="nearby-results" role="status">
            <strong>
              {nearbyRoutes.length === 1 ? t.mapNearby : t.mapNearbyPlural}
            </strong>
            {nearbyRoutes.map(({ code, distance }) => (
              <button
                key={code}
                type="button"
                onClick={() => onSelectRoute(code)}
                className={code === selectedRoute ? 'nearby-line-selected' : ''}
              >
                {code} · {t.distanceAway.replace('{distance}', distance)}
              </button>
            ))}
          </div>
        )}
        {locationMessage && (
          <p
            className={`map-location-message ${locationStatus === 'error' ? 'map-location-error' : ''}`}
            role={locationStatus === 'error' ? 'alert' : 'status'}
          >
            {t[locationMessage] ?? locationMessage}
          </p>
        )}
        <p className="map-estimate-note">
          {t.estimatedRoute}
        </p>
      </aside>
    </main>
  )
}
