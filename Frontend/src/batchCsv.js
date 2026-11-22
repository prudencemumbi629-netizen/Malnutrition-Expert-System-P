export const MAX_BATCH_ROWS = 25_000
export const MAX_BATCH_FILE_BYTES = 10 * 1024 * 1024

const clinicalColumns = ['muac_mm', 'whz', 'oedema', 'danger_signs']
const labels = ['Normal', 'MAM', 'SAM']

export function batchColumns(schema) {
  return ['record_id', ...schema.features.map(feature => feature.key), ...clinicalColumns, 'nutrition_status']
}

export function parseCsv(source) {
  const text = source.replace(/^\uFEFF/, '')
  const records = []
  let fields = []
  let field = ''
  let quoted = false
  let closed = false
  let line = 1
  let recordLine = 1

  function endRecord() {
    fields.push(field)
    if (fields.some(value => value.trim())) {
      if (records.length > MAX_BATCH_ROWS) throw new Error(`Use at most ${MAX_BATCH_ROWS.toLocaleString()} records per file.`)
      records.push({ line: recordLine, fields })
    }
    fields = []
    field = ''
    closed = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const newline = character === '\n' || character === '\r'
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          closed = true
        }
      } else if (newline) {
        if (character === '\r' && text[index + 1] === '\n') index += 1
        field += '\n'
        line += 1
      } else {
        field += character
      }
    } else if (character === ',') {
      fields.push(field)
      field = ''
      closed = false
    } else if (newline) {
      endRecord()
      if (character === '\r' && text[index + 1] === '\n') index += 1
      line += 1
      recordLine = line
    } else if (closed || (character === '"' && field)) {
      throw new Error(`Invalid CSV quoting on line ${line}.`)
    } else if (character === '"') {
      quoted = true
    } else {
      field += character
    }
  }
  if (quoted) throw new Error(`The quoted value starting in the record on line ${recordLine} is incomplete.`)
  endRecord()
  return records
}

function numberValue(value, label, integer = false) {
  const pattern = integer ? /^[+-]?\d+$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
  const parsed = Number(value)
  if (!pattern.test(value) || !Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed))) {
    throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'}.`)
  }
  return parsed
}

function screeningInputs(get, schema) {
  return Object.fromEntries(schema.features.flatMap(feature => {
    const value = get(feature.key)
    if (!value) {
      if (feature.required) throw new Error(`Provide ${feature.key} (${feature.label}).`)
      return []
    }
    const option = feature.options?.find(item => item.label.toLowerCase() === value.toLowerCase())
    return [[feature.key, option?.value ?? numberValue(value, feature.key, true)]]
  }))
}

function clinicalInputs(get, schema) {
  const clinical = {}
  if (get('muac_mm')) {
    const muac = numberValue(get('muac_mm'), 'MUAC in mm')
    if (muac <= 0) throw new Error('MUAC must be positive.')
    clinical.muacCm = muac / 10
  }
  if (get('whz')) clinical.whz = numberValue(get('whz'), 'WHZ')
  const oedema = get('oedema').toLowerCase()
  if (oedema) {
    if (!['yes', 'no', 'true', 'false', '1', '0'].includes(oedema)) {
      throw new Error('Use yes or no for oedema.')
    }
    clinical.oedema = ['yes', 'true', '1'].includes(oedema)
  }
  const signs = get('danger_signs').toLowerCase()
  if (signs) {
    clinical.dangerSigns = signs === 'none' ? [] : signs.split(';').map(sign => sign.trim())
    const allowed = new Set(schema.dangerSigns.map(sign => sign.key))
    if (clinical.dangerSigns.some(sign => !allowed.has(sign)) ||
        new Set(clinical.dangerSigns).size !== clinical.dangerSigns.length) {
      throw new Error('Use distinct recognized danger-sign codes separated by semicolons, or none.')
    }
  }
  return clinical
}

export function prepareBatch(text, schema) {
  const [header, ...records] = parseCsv(text)
  if (!header || !records.length) throw new Error('Add a header and at least one record.')
  const columns = header.fields.map(field => field.trim())
  const indexes = new Map(columns.map((name, index) => [name, index]))
  if (indexes.size !== columns.length) throw new Error('The file contains duplicate column names.')
  const recognized = new Set(batchColumns(schema))
  if (columns.some(column => !recognized.has(column))) {
    throw new Error('The file contains an unrecognized column. Use the CSV template for supported columns.')
  }
  const required = ['record_id', ...schema.features.filter(feature => feature.required).map(feature => feature.key)]
  const missing = required.filter(name => !indexes.has(name))
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}.`)

  const idIndex = indexes.get('record_id')
  const idCounts = new Map()
  for (const { fields } of records) {
    const id = fields[idIndex]?.trim()
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }

  return records.map(({ line, fields }) => {
    const get = name => fields[indexes.get(name)]?.trim() ?? ''
    const recordId = get('record_id').slice(0, 128)
    const row = { line, recordId, actual: get('nutrition_status') }
    try {
      if (fields.length !== columns.length) throw new Error('The row has the wrong number of columns.')
      if (!recordId || get('record_id').length > 128) throw new Error('Provide a record ID of 1–128 characters.')
      if (idCounts.get(recordId) > 1) throw new Error('Record ID must be unique in the file.')
      if (row.actual && !labels.includes(row.actual)) throw new Error('Nutrition status must be Normal, MAM, or SAM.')
      row.payload = { screeningInputs: screeningInputs(get, schema), clinicalInputs: clinicalInputs(get, schema) }
    } catch (error) {
      row.error = error.message
    }
    return row
  })
}

export function csvCell(value) {
  const text = String(value ?? '')
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  const safe = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) ? "'" + text : text
  return '"' + safe.replaceAll('"', '""') + '"'
}
