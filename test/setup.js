// The store and clock read localStorage at import time. Node has no usable one
// by default, so each test file gets a plain in-memory stand-in.
const mem = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    // Clearing keeps the language: the tests read the English texts
    // (i18n.test.js checks the Norwegian ones).
    clear: () => { mem.clear(); mem.set('bmtk:lang', 'en') },
  },
})

mem.set('bmtk:lang', 'en')
