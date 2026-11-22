const allowedOrigins = new Set(
  (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '').split(',').map((origin) => origin.trim()),
)
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const inferenceOrigin = Deno.env.get('FYM_INFERENCE_ORIGIN')
const inferenceToken = Deno.env.get('FYM_INFERENCE_TOKEN')
const maxBytes = 16_384

async function readPayload(request) {
  if (!request.body) return null
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return JSON.parse(text + decoder.decode())
    bytes += value.length
    if (bytes > maxBytes) {
      await reader.cancel()
      throw new RangeError('Request is too large.')
    }
    text += decoder.decode(value, { stream: true })
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' })
  const json = (value, status = 200) => Response.json(value, { status, headers })
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin is not allowed.' }, 403)
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info')
    return new Response(null, { status: 204, headers })
  }
  if (!['GET', 'POST'].includes(request.method)) {
    headers.set('Allow', 'GET, POST, OPTIONS')
    return json({ error: 'Method is not allowed.' }, 405)
  }
  const authorization = request.headers.get('Authorization')
  const apiKey = request.headers.get('apikey')
  if (!authorization?.startsWith('Bearer ') || !apiKey) return json({ error: 'Sign in first.' }, 401)
  if (!supabaseUrl || !inferenceOrigin || !inferenceToken) {
    return json({ error: 'The inference service has not been configured.' }, 503)
  }

  let payload
  if (request.method === 'POST') {
    if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      return json({ error: 'Send an application/json request.' }, 415)
    }
    try {
      payload = await readPayload(request)
    } catch (error) {
      return error instanceof RangeError
        ? json({ error: 'The request is too large.' }, 413)
        : json({ error: 'The request contains invalid JSON.' }, 400)
    }
    if (!object(payload) || !object(payload.screeningInputs)) {
      return json({ error: 'Provide screening inputs.' }, 400)
    }
  }

  try {
    const fetchSupabase = (path, options = {}) => fetch(new URL(path, supabaseUrl), {
      ...options,
      headers: { apikey: apiKey, Authorization: authorization, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    const auth = await fetchSupabase('/auth/v1/user')
    if (auth.status === 401 || auth.status === 403) return json({ error: 'Sign in first.' }, 401)
    if (!auth.ok) throw new Error('Auth unavailable')
    const user = await auth.json()
    if (!user.id) return json({ error: 'Sign in first.' }, 401)

    const memberPath = `/rest/v1/demo_members?select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    const isMember = await fetchSupabase(memberPath)
    if (!isMember.ok) throw new Error('Membership unavailable')
    if (!(await isMember.json()).length) return json({ error: 'Demo access is required.' }, 403)

    const rate = await fetchSupabase('/rest/v1/rpc/take_assessment_request', {
      method: 'POST', body: '{}',
    })
    if (!rate.ok) throw new Error('Rate limit unavailable')
    if ((await rate.json()) !== true) {
      headers.set('Retry-After', '60')
      return json({ error: 'Too many requests. Try again shortly.' }, 429)
    }

    const releases = await fetchSupabase('/rest/v1/assessment_releases?select=model_version&active=eq.true')
    if (!releases.ok) throw new Error('Release lookup unavailable')
    const [release] = await releases.json()
    if (!release) return json({ error: 'No model release is active.' }, 503)

    const path = request.method === 'GET' ? '/api/schema' : '/api/assess'
    const checking = request.method === 'GET'
    const signal = AbortSignal.timeout(checking ? 85_000 : 25_000)
    const upstream = new URL(path, inferenceOrigin)
    const options = {
      method: request.method,
      headers: {
        Authorization: `Bearer ${inferenceToken}`,
        'Content-Type': 'application/json',
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      redirect: 'error',
      signal,
    }
    let inference = await fetch(upstream, options)
    while (checking && !signal.aborted && (
      [502, 503, 504].includes(inference.status)
      || (inference.ok && !inference.headers.get('Content-Type')?.startsWith('application/json'))
    )) {
      await inference.body?.cancel()
      await new Promise(resolve => setTimeout(resolve, 3000))
      inference = await fetch(upstream, options)
    }
    if ([400, 422].includes(inference.status)) {
      return json({ error: 'Check the assessment inputs and try again.' }, inference.status)
    }
    if (!inference.ok) throw new Error('Inference unavailable')
    const result = await inference.json()
    const version = request.method === 'GET' ? result.modelVersion : result.versions?.model
    if (version !== release.model_version) throw new Error('Release mismatch')
    return json(result)
  } catch {
    return json({ error: 'The assessment service is unavailable. Try again shortly.' }, 503)
  }
})
