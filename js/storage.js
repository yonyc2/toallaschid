// =====================================================
// ALMACENAMIENTO LOCAL (sustituye a la base de datos SQLite del servidor)
// Todo se guarda en localStorage del navegador, en una sola clave.
// =====================================================
const Store = (() => {
  const DB_KEY = 'toallas_db_v2';
  const SESSION_KEY = 'toallas_session';
  const LOCKS_KEY = 'toallas_locks';
  const CHANNEL = 'toallas-updates';
  const PBKDF2_ITER = 150000;

  const emptyDb = () => ({ users: [], stays: [], movements: [], history: [], seq: { users: 0, stays: 0, movements: 0, history: 0 } });

  function read() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { return null; }
  }

  // Ejecuta fn(db) sobre una copia fresca de los datos (así varias pestañas siempre ven lo último).
  // Si fn lanza un error NO se guarda nada (equivale a una transacción).
  function tx(fn) {
    const db = read() || emptyDb();
    const result = fn(db);
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      throw new Error('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado');
    }
    notify();
    return result;
  }

  const view = () => read() || emptyDb();           // solo lectura
  const nextId = (db, table) => ++db.seq[table];
  const replaceAll = data => { localStorage.setItem(DB_KEY, JSON.stringify(data)); notify(); };
  const exists = () => !!read();

  // ---- Tiempo (igual que el servidor) ----
  const utcNow = () => new Date().toISOString();
  const cdmxNow = () =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());

  // ---- Contraseñas: PBKDF2-SHA256 con sal aleatoria ----
  const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const fromHex = hex => Uint8Array.from(hex.match(/../g) || [], h => parseInt(h, 16));

  function needCrypto() {
    if (!(window.crypto && crypto.subtle)) {
      throw new Error('Este navegador bloqueó la criptografía. Abre la aplicación como archivo local en Chrome o Edge.');
    }
  }
  const newSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

  async function hashPassword(password, saltHex) {
    needCrypto();
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256);
    return toHex(bits);
  }

  // ---- Sesión (8 horas renovables, compartida entre pestañas como una cookie) ----
  const SESSION_MS = 8 * 60 * 60 * 1000;
  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (!s || s.expires < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
      s.expires = Date.now() + SESSION_MS;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      return s;
    } catch (e) { return null; }
  }
  const setSession = s => localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, expires: Date.now() + SESSION_MS }));
  const clearSession = () => localStorage.removeItem(SESSION_KEY);

  // ---- Bloqueo por intentos fallidos (se conserva aunque recargues la página) ----
  const LOCK_MS = 15 * 60 * 1000;
  const readLocks = () => { try { return JSON.parse(localStorage.getItem(LOCKS_KEY)) || {}; } catch (e) { return {}; } };
  const writeLocks = l => localStorage.setItem(LOCKS_KEY, JSON.stringify(l));

  function lockRemaining(key) {
    const l = readLocks(), e = l[key];
    if (!e || !e.lockedUntil) return 0;
    if (e.lockedUntil <= Date.now()) { delete l[key]; writeLocks(l); return 0; }
    return e.lockedUntil - Date.now();
  }
  function registerFail(key, max) {
    const l = readLocks(), e = l[key] || { count: 0 };
    e.count += 1; e.last = Date.now();
    if (e.count >= max) { e.lockedUntil = Date.now() + LOCK_MS; e.count = 0; }
    l[key] = e; writeLocks(l);
  }
  function clearFails(key) { const l = readLocks(); delete l[key]; writeLocks(l); }

  // ---- Aviso a otras pestañas (sustituye a Socket.IO en el mismo navegador) ----
  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL); } catch (e) { /* no disponible */ }
  function notify() { try { channel && channel.postMessage('updated'); } catch (e) { /* ignore */ } }
  function onUpdate(cb) {
    if (channel) channel.addEventListener('message', cb);
    window.addEventListener('storage', e => { if (e.key === DB_KEY) cb(); });
  }

  return {
    tx, view, nextId, replaceAll, exists, utcNow, cdmxNow, newSalt, hashPassword,
    getSession, setSession, clearSession, lockRemaining, registerFail, clearFails, onUpdate, emptyDb
  };
})();
