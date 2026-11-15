import { t } from './i18n.js'
// Organisers: logged in by a link sent by email (Supabase Auth), so they can
// create shared races and find them again on any phone. Timing itself needs
// no login: the admin and timer links do that.

import { useEffect, useState } from 'react'
import { getSupabase, supabaseConfigured } from './supabase.js'
import { joinWithLink } from './online.js'

export { supabaseConfigured }

// The logged-in organiser ({ email }), null when logged out, undefined while
// it is still being checked.
export function useOrganiser() {
  const [user, setUser] = useState(supabaseConfigured ? undefined : null)
  useEffect(() => {
    if (!supabaseConfigured) return undefined
    let sub = null
    let live = true
    getSupabase().then((sb) => {
      if (!live || !sb) return
      sb.auth.getSession().then(({ data }) => { if (live) setUser(data.session?.user ?? null) })
      sub = sb.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null)).data.subscription
    })
    return () => { live = false; sub?.unsubscribe() }
  }, [])
  return user
}

async function client() {
  const sb = await getSupabase()
  if (!sb) throw new Error(t('This app is not connected to a database.'))
  return sb
}

// Sends the login link. It brings the organiser back to this app.
export async function sendLoginLink(email) {
  const sb = await client()
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: `${window.location.origin}/` },
  })
  if (error) throw new Error(error.message)
}

export async function logOut() {
  const sb = await client()
  await sb.auth.signOut()
}

async function call(fn, args) {
  const sb = await client()
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data
}

// A new shared race: made on the server, then opened on this phone with its
// admin link. Returns the local event.
export async function createSharedRace({ name, date, format }) {
  const made = await call('tk_opprett_lop', { p_navn: name, p_dato: date || null, p_oppsett: format ?? null })
  return joinWithLink(made.id, made.admin_token)
}

// [{ id, name, date, admin_token, runners }]
export const myRaces = () => call('tk_mine_lop', {})

// Opens one of my races on this phone (admin).
export const openMyRace = (race) => joinWithLink(race.id, race.admin_token)

export const deleteSharedRace = (id) => call('tk_slett_lop', { p_event: id })
