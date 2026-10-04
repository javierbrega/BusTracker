const metersPerLatitudeDegree = 111_132

const distanceToSegment = (position, first, second) => {
  const metersPerLongitudeDegree =
    111_320 * Math.cos((position.latitude * Math.PI) / 180)
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

  return Math.hypot(firstX + projection * segmentX, firstY + projection * segmentY)
}

const getGeometryLines = (geometry) => {
  if (!geometry || typeof geometry !== 'object') return []

  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates) ? [geometry.coordinates] : []
  }

  if (geometry.type === 'MultiLineString') {
    return Array.isArray(geometry.coordinates)
      ? geometry.coordinates.filter(Array.isArray)
      : []
  }

  return []
}

const distanceToGeometry = (position, geometry) => {
  if (
    !position ||
    !Number.isFinite(position.latitude) ||
    !Number.isFinite(position.longitude)
  ) {
    return Number.POSITIVE_INFINITY
  }

  let closestDistance = Number.POSITIVE_INFINITY

  for (const line of getGeometryLines(geometry)) {
    if (!Array.isArray(line)) continue

    for (let index = 1; index < line.length; index += 1) {
      const first = line[index - 1]
      const second = line[index]
      if (
        !Array.isArray(first) ||
        !Array.isArray(second) ||
        !Number.isFinite(first[0]) ||
        !Number.isFinite(first[1]) ||
        !Number.isFinite(second[0]) ||
        !Number.isFinite(second[1])
      ) {
        continue
      }
      closestDistance = Math.min(
        closestDistance,
        distanceToSegment(position, first, second),
      )
    }
  }

  return closestDistance
}

export const findNearbyRouteGroups = (position, routes, radiusMeters = 500) => {
  if (
    !position ||
    !Number.isFinite(position.latitude) ||
    !Number.isFinite(position.longitude) ||
    !Array.isArray(routes)
  ) {
    return []
  }

  const nearestByGroup = new Map()

  for (const route of routes) {
    if (!route?.geometry) continue
    const distance = distanceToGeometry(position, route.geometry)
    if (distance > radiusMeters + 1e-6) continue

    const groupId = route.group_id ?? route.code
    const current = nearestByGroup.get(groupId)
    if (!current || distance < current.distance) {
      nearestByGroup.set(groupId, {
        groupId,
        groupName: route.group?.display_name ?? route.name,
        routeCode: route.code,
        distance: Math.round(distance),
      })
    }
  }

  return [...nearestByGroup.values()].sort(
    (first, second) => first.distance - second.distance,
  )
}
