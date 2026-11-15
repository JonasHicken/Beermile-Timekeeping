// Sending a race's results to a website's records list.
//
// A race linked to a website (it set `eksport` on the race through the admin
// link) can send its finishing times there. The site is another database: the
// app calls a function on it, with the site's own publishable address and key
// and this race's code and key on that site. Nothing about the site is in this
// app's code; it all comes from the race, and only the admin link sees it.
//
//   eksport = { navn, url, key, kode, nokkel }
//
// The site's function (privat_lop_motta_resultater) puts the times in its
// approval queue, unverified, so nothing is public until the site's admin
// approves each one. Sending again updates rows still waiting, never an
// approved one.

const clients = {}

async function client(eksport) {
  if (!clients[eksport.url]) {
    clients[eksport.url] = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(eksport.url, eksport.key, { auth: { persistSession: false, autoRefreshToken: false } }))
  }
  return clients[eksport.url]
}

// rows: recordRows(...) -> { sendt, oppdatert, godkjent } (godkjent: rows the
// site has approved already, so left as they were).
export async function sendToRecords(eksport, rows) {
  if (!eksport?.url || !eksport?.key) throw new Error('This race is not linked to a website.')
  const sb = await client(eksport)
  const { data, error } = await sb.rpc('privat_lop_motta_resultater', {
    p_kode: eksport.kode, p_nokkel: eksport.nokkel, p_rader: rows,
  })
  if (error) throw new Error(error.message)
  return data ?? {}
}
