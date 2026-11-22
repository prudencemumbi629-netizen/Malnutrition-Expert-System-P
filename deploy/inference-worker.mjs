import { DurableObject } from 'cloudflare:workers'

const portNumber = 8000
const encoder = new TextEncoder()

async function matchesSecret(value, secret) {
  if (!value || !secret) return false
  const [received, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(value)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${secret}`)),
  ])
  return crypto.subtle.timingSafeEqual(received, expected)
}

export class InferenceContainer extends DurableObject {
  async fetch(request) {
    const container = this.ctx.container
    const port = container.getTcpPort(portNumber)
    await this.ctx.blockConcurrencyWhile(async () => {
      if (container.running) return
      await container.setInactivityTimeout(300_000)
      container.start({ enableInternet: false })
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          const response = await port.fetch('http://container/health')
          await response.body?.cancel()
          if (response.ok) return
        } catch {
          // The health endpoint can be unavailable while Python imports the model.
        }
        await scheduler.wait(200)
      }
      throw new Error('Inference container is not ready')
    })
    return port.fetch(request)
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (!await matchesSecret(request.headers.get('Authorization'), env.FYM_INFERENCE_TOKEN)) {
      return new Response(null, { status: 401 })
    }
    const isSchema = pathname === '/api/schema' && request.method === 'GET'
    const isAssessment = pathname === '/api/assess' && request.method === 'POST'
    if (!isSchema && !isAssessment) return new Response(null, { status: 404 })

    try {
      const body = isAssessment ? await request.arrayBuffer() : undefined
      if (body && body.byteLength > 16_384) return new Response(null, { status: 413 })
      const forwarded = new Request(new URL(pathname, 'http://container'), {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      return await env.INFERENCE.getByName('active').fetch(forwarded)
    } catch {
      return Response.json({ error: 'Inference unavailable.' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      })
    }
  },
}
