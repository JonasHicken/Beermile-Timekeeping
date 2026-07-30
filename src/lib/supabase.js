// Lazily loads the Supabase client, mirroring the main site's pattern. The app
// works fully OFFLINE without this — Supabase is only used to PUBLISH results to
// the public live page. Returns the singleton client, or null if env is unset.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

let clientPromise = null

export function getSupabase() {
  if (!url || !key) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, key),
    )
  }
  return clientPromise
}

export const supabaseConfigured = Boolean(url && key)
