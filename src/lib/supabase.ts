import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

// Implicit flow: the default magic-link email (and the custom token-hash template) both work even when
// the link is opened in a different browser from the one that requested it (e.g. WhatsApp in-app browser).
export const supabase = createClient(url, key, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Absolute URL of the app root, e.g. https://jon.doblados.net/pickleme/ */
export const APP_URL = new URL(import.meta.env.BASE_URL, window.location.origin).toString()
