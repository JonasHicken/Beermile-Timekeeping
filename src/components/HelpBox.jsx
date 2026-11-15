import { useState } from 'react'

const KEY = 'bmtk:help-open'

// The home page's short guide for someone opening the app for the first time.
// Open until it has been closed once on this phone; it stays closed after.
export default function HelpBox() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(KEY) !== '0' } catch { return true }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* not remembered */ }
  }

  return (
    <div className="card help-box" style={{ marginTop: 16 }}>
      <button className="help-head" onClick={toggle} aria-expanded={open}>
        <span className="grow">New here? How the app works</span>
        <span aria-hidden>{open ? '–' : '+'}</span>
      </button>
      {open && (
        <div className="stack help-body" style={{ gap: 14 }}>
          <section>
            <h3>Time a race in four steps</h3>
            <ol>
              <li><b>New event:</b> pick the distance (400 m to 5000 m, Beermile, or Custom). The timing points are filled in for you; change them if your course is different.</li>
              <li><b>Start list:</b> add runners by hand, or import a spreadsheet (.xlsx or .csv) or pasted rows. Give everyone a bib.</li>
              <li><b>Heats:</b> split the runners into heats that start together.</li>
              <li><b>Race day:</b> open a heat, press <b>Start</b>, and tap a runner’s tile each time they pass a timing point. Results and splits fill in by themselves.</li>
            </ol>
            <p className="muted tiny">Everything is saved on this phone as you go, and timing keeps working without signal.</p>
          </section>

          <section>
            <h3>Several phones: a shared race</h3>
            <p>
              On its own the app times on one phone. Log in as an organiser (below: you get a link by email, no password) and
              tick <b>Shared race</b> when you make the event. You get an admin link for yourself and a timer link to send to helpers:
            </p>
            <ul>
              <li>several timers on one race, each timing their own runners;</li>
              <li>everything backed up on the server, so a lost phone loses nothing that was sent;</li>
              <li>you start the heats, the timers just tap; changes reach every phone in seconds.</li>
            </ul>
            <p className="muted tiny">
              Shared races are kept on a free Supabase database and deleted three months after the race. Running your own copy of
              the app? Connect your own Supabase project: step by step in the README, under “Connecting a database”.
            </p>
          </section>

          <section>
            <h3>Live results on a web page</h3>
            <p>
              A shared race can show its results live while it runs. In <b>Race admin › Setup</b>, turn on <b>Results on the race
              page</b>. A website linked to the race (like a club’s race page) then shows them as they come in. Turn it off to keep
              results to the timing phones.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
