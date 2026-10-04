import assert from 'node:assert/strict'
import test from 'node:test'
import { getLocalizedServiceDescription, translations } from './translations.js'

test('Spanish and English dictionaries have matching keys', () => {
  assert.deepEqual(
    Object.keys(translations.en).sort(),
    Object.keys(translations.es).sort(),
  )
})

test('service descriptions are translated while Spanish remains unchanged', () => {
  const description = 'Lunes a viernes, sábados y feriados'

  assert.equal(
    getLocalizedServiceDescription(description, 'en'),
    'Monday to Friday, Saturdays and holidays',
  )
  assert.equal(getLocalizedServiceDescription(description, 'es'), description)
})
