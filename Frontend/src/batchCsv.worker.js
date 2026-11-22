import { prepareBatch } from './batchCsv.js'

self.onmessage = async ({ data: { file, schema } }) => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
    self.postMessage({ rows: prepareBatch(text, schema) })
  } catch (error) {
    self.postMessage({ error: error.message })
  }
}
