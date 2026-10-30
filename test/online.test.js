import { beforeEach, describe, expect, it, vi } from 'vitest'

// online.js against a stand-in for the server: every rpc call is recorded and
// answered by `server`, which a test sets up. What is tested here is the
// phone's side of the admin and timer links; the server's own rules live in
// the site's schema (PART 18).
let calls
let server
vi.mock('../src/lib/supabase.js', () => ({
  supabaseConfigured: true,
  getSupabase: async () => ({
    rpc: async (name, args) => {
      calls.push({ name, args })
      return server(name, args)
    },
  }),
}))

let S, O
beforeEach(async () => {
  // The link is built from the page's address, which tests do not have.
  globalThis.window = { location: { origin: 'https://timing.example' }, addEventListener() {}, removeEventListener() {} }
  localStorage.clear()
  vi.resetModules()
  calls = []
  server = () => ({ data: null, error: { message: 'no server', hint: null } })
  S = await import('../src/lib/store.js')
  O = await import('../src/lib/online.js')
})

const EVENT = { id: 'ev-1', name: 'Shared', num_laps: 4 }
const refuse = (hint) => ({ data: null, error: { message: hint, hint } })
const ok = (data) => ({ data: { naa: Date.now(), ...data }, error: null })

describe('getting in with a timer link', () => {
  it('asks for the name, and lets the timer in with one on the list', async () => {
    server = (name, args) => (args.p_tidtaker?.toLowerCase() === 'selma'
      ? ok({ rolle: 'timer', meg: 'Selma', event: EVENT, runners: [], heats: [], crossings: [] })
      : refuse(args.p_tidtaker ? 'feil_navn' : 'trenger_navn'))

    const first = await O.joinWithLink('ev-1', 'timer-token').catch((e) => e)
    expect(O.isNameError(first)).toBe('trenger_navn')
    expect(S.getEvent(S.getState(), 'ev-1')).toBeFalsy() // nothing stored without a name

    const wrong = await O.joinWithLink('ev-1', 'timer-token', 'Sigrid').catch((e) => e)
    expect(O.isNameError(wrong)).toBe('feil_navn')

    const ev = await O.joinWithLink('ev-1', 'timer-token', 'selma')
    expect(ev.online).toMatchObject({ role: 'timer', me: 'Selma', token: 'timer-token' })
    expect(calls.at(-1).args).toMatchObject({ p_event: 'ev-1', p_token: 'timer-token', p_tidtaker: 'selma' })
  })

  it('tells "no timers added yet" apart from a wrong name, and a dead link from both', async () => {
    server = () => refuse('ingen_tidtakere')
    expect(O.isNameError(await O.joinWithLink('ev-1', 't', 'x').catch((e) => e))).toBe('ingen_tidtakere')
    server = () => refuse('ingen_tilgang')
    const dead = await O.joinWithLink('ev-1', 't', 'x').catch((e) => e)
    expect(O.isAccessError(dead)).toBe(true)
    expect(O.isNameError(dead)).toBeNull()
  })

  it('a phone that joined before names were codes forgets the list of names', async () => {
    S.adoptOnlineEvent({ rolle: 'timer', tidtakere: ['Sigurd', 'Selma'], event: EVENT, runners: [], heats: [] }, 'timer-token')
    server = () => ok({ rolle: 'timer', meg: 'Selma', event: EVENT, runners: [], heats: [], crossings: [] })
    await O.joinWithLink('ev-1', 'timer-token', 'Selma')
    expect(S.getEvent(S.getState(), 'ev-1').online.timers).toEqual([])
  })
})

describe('the admin link', () => {
  const adminData = (runners = []) => ok({
    rolle: 'admin', tidtakere: ['Sigurd', 'Selma'], tidtakertoken: 'timer-token', event: EVENT,
    runners, heats: [{ id: 'h-1', name: 'Heat 1', order: 0, status: 'pending' }], crossings: [],
  })

  it('race admin calls carry the admin token, and the event is fetched again after', async () => {
    let assigned = null
    server = (name, args) => {
      if (name === 'tk_admin_tidtakere') { assigned = args.p_tildeling[0].tidtaker; return ok({}) }
      return adminData([{ id: 'r-1', bib: '301', heat_id: 'h-1', tidtaker: assigned }])
    }
    await O.joinWithLink('ev-1', 'admin-token')
    await O.saveTimers('ev-1', { assignment: [{ runnerId: 'r-1', timer: 'Selma' }] })

    const admin = calls.find((c) => c.name === 'tk_admin_tidtakere')
    expect(admin.args).toMatchObject({ p_event: 'ev-1', p_token: 'admin-token', p_tidtakere: null, p_tildeling: [{ runner_id: 'r-1', tidtaker: 'Selma' }] })
    expect(calls.at(-1).name).toBe('tk_hent')
    expect(S.getRunner(S.getState(), 'r-1').timer).toBe('Selma')
    expect(O.timerLink(S.getEvent(S.getState(), 'ev-1'))).toMatch(/\/join\/ev-1#timer-token$/)
  })

  it('a refusal for not being admin is its own error, and a taken bib keeps its hint', async () => {
    server = (name) => (name === 'tk_hent' ? adminData() : refuse('ikke_admin'))
    await O.joinWithLink('ev-1', 'admin-token')
    await expect(O.adminCall('ev-1', 'tk_admin_fordel_heat', { p_fordeling: [] })).rejects.toBeInstanceOf(O.NotAdminError)

    server = (name) => (name === 'tk_hent' ? adminData()
      : { data: null, error: { message: 'taken', hint: 'opptatt', details: 'Ola' } })
    const taken = await O.adminCall('ev-1', 'tk_admin_sett_startnummer', { p_fra: 1, p_til: 2 }).catch((e) => e)
    expect(taken).toMatchObject({ hint: 'opptatt', detail: 'Ola' })
  })
})
