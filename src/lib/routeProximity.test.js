import assert from 'node:assert/strict'
import test from 'node:test'
import { findNearbyRouteGroups } from './routeProximity.js'

const position = { latitude: -34.6, longitude: -68.3 }
const metersPerLatitudeDegree = 111_132
const routeAtDistance = (code, groupId, distance) => ({
  code,
  name: `${code} - Recorrido`,
  group_id: groupId,
  group: { display_name: `Línea ${groupId}` },
  geometry: {
    type: 'LineString',
    coordinates: [
      [position.longitude - 0.01, position.latitude + distance / metersPerLatitudeDegree],
      [position.longitude + 0.01, position.latitude + distance / metersPerLatitudeDegree],
    ],
  },
})

test('returns route groups within the 500 metre radius, nearest first', () => {
  const results = findNearbyRouteGroups(position, [
    routeAtDistance('520A', '520', 500),
    routeAtDistance('520B', '520', 120),
    routeAtDistance('511A', '511', 300),
    routeAtDistance('515A', '515', 500),
    routeAtDistance('514A', '514', 501),
  ])

  assert.deepEqual(
    results.map(({ groupId, routeCode, distance }) => [groupId, routeCode, distance]),
    [
      ['520', '520B', 120],
      ['511', '511A', 300],
      ['515', '515A', 500],
    ],
  )
})

test('does not recommend groups without a usable route shape', () => {
  const results = findNearbyRouteGroups(position, [
    { code: '515A-VERANO', group_id: '515', geometry: null },
    {
      code: '576A',
      group_id: '576',
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
    },
  ])

  assert.deepEqual(results, [])
})

test('ignores malformed LineString geometry instead of crashing', () => {
  const results = findNearbyRouteGroups(position, [
    { code: '610A', group_id: '610', geometry: { type: 'LineString' } },
    {
      code: '611A',
      group_id: '611',
      geometry: { type: 'MultiLineString', coordinates: null },
    },
  ])

  assert.deepEqual(results, [])
})
