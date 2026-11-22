import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
export const hostedMode = Boolean(supabaseUrl || publishableKey)

let client
let configurationError
if (hostedMode) {
  try {
    if (!supabaseUrl || !publishableKey) throw new Error('Incomplete Supabase configuration')
    if (!import.meta.env.DEV && new URL(supabaseUrl).protocol !== 'https:') {
      throw new Error('Hosted Supabase must use HTTPS')
    }
    client = createClient(supabaseUrl, publishableKey)
  } catch {
    configurationError = 'The hosted app needs a valid Supabase URL and publishable key.'
  }
}

export const supabase = client
export const supabaseConfigurationError = configurationError
