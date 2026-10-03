import { timingSafeEqual } from 'node:crypto'

const sendJson = (response, status, body) => {
  response.setHeader('Cache-Control', 'no-store')
  return response.status(status).json(body)
}

const matchesToken = (supplied, expected) => {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return sendJson(response, 405, { error: 'Method not allowed' })
  }

  const expectedToken = process.env.KEEPALIVE_TOKEN
  if (!expectedToken) {
    return sendJson(response, 503, { error: 'Keepalive is not configured' })
  }

  const requestUrl = new URL(request.url, `https://${request.headers.host ?? 'localhost'}`)
  const suppliedToken = requestUrl.searchParams.get('token') ?? ''
  if (!suppliedToken || !matchesToken(suppliedToken, expectedToken)) {
    return sendJson(response, 401, { error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    console.error('Keepalive is missing Supabase environment variables.')
    return sendJson(response, 503, { error: 'Keepalive is not configured' })
  }

  let databaseUrl
  try {
    databaseUrl = new URL(supabaseUrl)
  } catch (error) {
    console.error('Keepalive has an invalid Supabase URL:', error)
    return sendJson(response, 503, { error: 'Keepalive is not configured' })
  }

  if (databaseUrl.protocol !== 'https:' || !databaseUrl.hostname.endsWith('.supabase.co')) {
    console.error('Keepalive Supabase URL must use an https://*.supabase.co host.')
    return sendJson(response, 503, { error: 'Keepalive is not configured' })
  }

  try {
    const databaseResponse = await fetch(
      new URL('/rest/v1/routes?select=id&limit=1', databaseUrl),
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    )

    if (!databaseResponse.ok) {
      console.error(`Keepalive Supabase query failed with HTTP ${databaseResponse.status}.`)
      return sendJson(response, 502, { error: 'Database check failed' })
    }

    return sendJson(response, 200, { ok: true })
  } catch (error) {
    console.error('Keepalive Supabase request failed:', error)
    return sendJson(response, 502, { error: 'Database check failed' })
  }
}
