const jsonHeaders = { 'Content-Type': 'application/json' }

Deno.serve(async (request) => {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...jsonHeaders, Allow: 'GET' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const expectedToken = Deno.env.get('KEEPALIVE_TOKEN')

  if (!supabaseUrl || !anonKey || !expectedToken) {
    console.error('Keepalive function is missing required environment variables.')
    return new Response(JSON.stringify({ error: 'Keepalive is not configured' }), {
      status: 500,
      headers: jsonHeaders,
    })
  }

  const suppliedToken = new URL(request.url).searchParams.get('token')
  if (!suppliedToken || suppliedToken !== expectedToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/rest/v1/routes?select=id&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      },
    )

    if (!response.ok) {
      console.error(`Supabase keepalive query failed with HTTP ${response.status}.`)
      return new Response(JSON.stringify({ error: 'Database check failed' }), {
        status: 502,
        headers: jsonHeaders,
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: jsonHeaders,
    })
  } catch (error) {
    console.error('Supabase keepalive request failed:', error)
    return new Response(JSON.stringify({ error: 'Database check failed' }), {
      status: 502,
      headers: jsonHeaders,
    })
  }
})
