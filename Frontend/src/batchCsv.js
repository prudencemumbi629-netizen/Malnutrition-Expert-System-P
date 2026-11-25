export const MAX_BATCH_ROWS = 25_000
export const MAX_BATCH_FILE_BYTES = 10 * 1024 * 1024

const clinicalColumns = ['muac_mm', 'whz', 'oedema', 'danger_signs']
const labels = ['Normal', 'MAM', 'SAM']
const missingValues = new Set(['', 'na', 'n/a', 'null', 'missing', 'not recorded', '-'])
const headerAliases = {
  record_id: ['record id', 'case id'],
  b19: ['age in months', 'age months'],
  b4: ['sex', 'child sex'],
  muac_mm: ['muac (mm)', 'mid-upper arm circumference (mm)'],
  muac_cm: ['muac (cm)', 'mid-upper arm circumference (cm)'],
  whz: ['weight-for-height z-score', 'weight for height z score'],
  oedema: ['edema', 'bilateral pitting oedema', 'bilateral pitting edema'],
  danger_signs: ['danger signs', 'emergency danger signs'],
  nutrition_status: ['nutrition status', 'nutritional status', 'known outcome'],
}

const normalizeHeader = value => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ')

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
  const normalized = value.replace(/^−/, '-')
  const parsed = Number(normalized)
  if (!pattern.test(normalized) || !Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed))) {
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
  const mm = get('muac_mm')
  const cm = get('muac_cm')
  if (mm && cm) throw new Error('Provide MUAC in only one unit per row.')
  if (mm || cm) {
    const muac = numberValue(mm || cm, mm ? 'MUAC in mm' : 'MUAC in cm')
    if (muac <= 0) throw new Error('MUAC must be positive.')
    clinical.muacCm = mm ? muac / 10 : muac
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
  const aliases = new Map()
  for (const key of [...batchColumns(schema), 'muac_cm']) {
    for (const name of [key, ...(headerAliases[key] ?? [])]) aliases.set(normalizeHeader(name), key)
  }
  for (const feature of schema.features) {
    const name = normalizeHeader(feature.label)
    if (name && !aliases.has(name)) aliases.set(name, feature.key)
  }
  const indexes = new Map()
  header.fields.forEach((name, index) => {
    const key = aliases.get(normalizeHeader(name))
    if (!key) return
    if (indexes.has(key)) throw new Error(`Multiple columns map to ${key}. Keep one column for this field.`)
    indexes.set(key, index)
  })
  const required = schema.features.filter(feature => feature.required).map(feature => feature.key)
  const missing = required.filter(name => !indexes.has(name))
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}.`)

  const idIndex = indexes.get('record_id')
  const idCounts = new Map()
  for (const { fields } of records) {
    const id = fields[idIndex]?.trim()
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }

  return records.map(({ line, fields }) => {
    const get = name => {
      const value = fields[indexes.get(name)]?.trim() ?? ''
      return missingValues.has(value.toLowerCase()) ? '' : value
    }
    const suppliedId = fields[idIndex]?.trim() ?? ''
    const recordId = idIndex === undefined ? `row-${line}` : suppliedId.slice(0, 128)
    const outcome = get('nutrition_status')
    const row = { line, recordId, actual: labels.find(label => label.toLowerCase() === outcome.toLowerCase()) ?? '' }
    try {
      if (fields.length !== header.fields.length) throw new Error('The row has the wrong number of columns.')
      if (!recordId || suppliedId.length > 128) throw new Error('Provide a record ID of 1–128 characters.')
      if (idCounts.get(recordId) > 1) throw new Error('Record ID must be unique in the file.')
      if (outcome && !row.actual) throw new Error('Nutrition status must be Normal, MAM, or SAM.')
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
