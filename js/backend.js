// =====================================================
// "SERVIDOR" LOCAL
// Reproduce las rutas /api/... que antes atendía server.js, con las mismas reglas de negocio,
// pero guardando los datos en el navegador (ver storage.js). Las pantallas siguen llamando api(...).
// =====================================================
const Backend = (() => {
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const fail = (status, message) => { throw new ApiError(status, message); };

  const DEFAULT_USERS = [
    ['admin', 'admin123', 'Administrador', 'admin'],
    ['recepcion', 'recepcion123', 'Recepción', 'recepcion'],
    ['toallero', 'toallero123', 'Toallero', 'toallero']
  ];
  const DUMMY_SALT = '00112233445566778899aabbccddeeff';

  // ---------- Validaciones (iguales a las del servidor) ----------
  function cleanText(value, fieldName, max, required = false) {
    const s = String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (required && !s) throw new Error(`${fieldName} es requerido`);
    if (s.length > max) throw new Error(`${fieldName} no puede exceder ${max} caracteres`);
    return s;
  }

  function toNonNegativeInt(value, fieldName, defaultValue = undefined) {
    if (value === undefined || value === null || value === '') {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`${fieldName} es requerido`);
    }
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${fieldName} debe ser un entero mayor o igual a 0`);
    if (n > 100000) throw new Error(`${fieldName} es demasiado grande`);
    return n;
  }

  function insertHistory(db, userId, action, stayId, oldValues, newValues) {
    db.history.push({
      id: Store.nextId(db, 'history'),
      user_id: userId || null,
      action,
      stay_id: stayId || null,
      old_values: oldValues ? JSON.stringify(oldValues) : null,
      new_values: newValues ? JSON.stringify(newValues) : null,
      created_at_utc: Store.utcNow(),
      created_at_cdmx: Store.cdmxNow()
    });
  }

  // ---------- Sesión y permisos ----------
  function need(roles) {
    const s = Store.getSession();
    if (!s) fail(401, 'No autenticado');
    const u = Store.view().users.find(x => x.id === s.userId);
    if (!u || !u.active) { Store.clearSession(); fail(401, 'No autenticado'); }
    if (roles && !roles.includes(s.role)) fail(403, 'Sin permiso para esta acción');
    return s;
  }

  // ---------- Usuarios iniciales (solo la primera vez) ----------
  let readyError = null;
  const ready = (async () => {
    try {
      if (Store.view().users.length) return;
      const prepared = [];
      for (const [username, pass, full_name, role] of DEFAULT_USERS) {
        const salt = Store.newSalt();
        prepared.push({ username, full_name, role, salt, password_hash: await Store.hashPassword(pass, salt) });
      }
      Store.tx(db => {
        if (db.users.length) return;
        for (const u of prepared) {
          db.users.push({ id: Store.nextId(db, 'users'), ...u, active: 1, created_at_utc: Store.utcNow(), created_at_cdmx: Store.cdmxNow() });
        }
      });
    } catch (e) { readyError = e; }
  })();

  // ---------- Login / logout ----------
  async function login(body) {
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) fail(400, 'Usuario y contraseña requeridos');
    if (username.length > 64 || password.length > 128) fail(401, 'Usuario o contraseña incorrectos');

    const uname = username.trim();
    const userKey = `u|${uname.toLowerCase()}`;
    const ipKey = 'i|navegador';
    const wait = Math.max(Store.lockRemaining(userKey), Store.lockRemaining(ipKey));
    if (wait > 0) fail(429, `Demasiados intentos fallidos. Intenta de nuevo en ${Math.ceil(wait / 60000)} minuto(s).`);

    const user = Store.view().users.find(u => u.username === uname && u.active);
    // Siempre se calcula un hash para no revelar si el usuario existe por el tiempo de respuesta
    const hash = await Store.hashPassword(password, user ? user.salt : DUMMY_SALT);

    if (!user || hash !== user.password_hash) {
      Store.registerFail(userKey, 5);
      Store.registerFail(ipKey, 30);
      Store.tx(db => insertHistory(db, user ? user.id : null, 'LOGIN_FALLIDO', null, null, { username: uname.slice(0, 64) }));
      fail(401, 'Usuario o contraseña incorrectos');
    }

    Store.clearFails(userKey);
    Store.setSession({ userId: user.id, role: user.role, fullName: user.full_name });
    Store.tx(db => insertHistory(db, user.id, 'LOGIN', null, null, null));
    return { role: user.role, fullName: user.full_name };
  }

  function logout() {
    const s = Store.getSession();
    if (s) Store.tx(db => insertHistory(db, s.userId, 'LOGOUT', null, null, null));
    Store.clearSession();
    return { ok: true };
  }

  // ---------- Huéspedes ----------
  const withMovements = (db, stay, limit) => ({
    ...stay,
    movements: db.movements.filter(m => m.stay_id === stay.id).sort((a, b) => b.id - a.id).slice(0, limit)
      .map(m => ({ ...m, username: (db.users.find(u => u.id === m.user_id) || {}).username || null }))
  });

  function listStays(q) {
    const status = ['activo', 'salido', 'todos'].includes(q.get('status')) ? q.get('status') : 'activo';
    const text = (q.get('q') || '').slice(0, 100).toLowerCase();
    return Store.view().stays
      .filter(s => (status === 'todos' || s.status === status) &&
        (!text || [s.guest_name, s.room_number, s.guest_barcode].some(v => String(v ?? '').toLowerCase().includes(text))))
      .sort((a, b) => (a.status === 'activo' ? 0 : 1) - (b.status === 'activo' ? 0 : 1) || b.id - a.id)
      .slice(0, 300);
  }

  function createStay(session, body) {
    return Store.tx(db => {
      const guest_name = cleanText(body.guest_name, 'El nombre del huésped', 100, true);
      const room_number = cleanText(body.room_number, 'El número de habitación', 20, true);
      const towel_limit = toNonNegativeInt(body.towel_limit, 'Límite de toallas');
      const initial_towels = toNonNegativeInt(body.initial_towels, 'Toallas iniciales', 0);
      const cards_count = toNonNegativeInt(body.cards_count, 'Cantidad de tarjetas', 1);

      if (initial_towels > towel_limit) throw new Error('Las toallas iniciales no pueden exceder el límite configurado');
      if (db.stays.some(s => s.room_number === room_number && s.status === 'activo')) {
        throw new Error(`La habitación ${room_number} ya tiene un huésped activo`);
      }

      const guest_barcode = String(body.guest_barcode || '').trim();
      if (!guest_barcode) throw new Error('El código de tarjeta es requerido');
      if (!/^\d{4,20}$/.test(guest_barcode)) throw new Error('El código de tarjeta debe ser numérico y tener entre 4 y 20 dígitos');
      // Un código solo puede estar en uso por un huésped activo; tras el check-out se puede reutilizar
      if (db.stays.some(s => s.guest_barcode === guest_barcode && s.status === 'activo')) {
        throw new Error('Ese código de tarjeta ya está en uso por un huésped activo');
      }

      const utc = Store.utcNow(), cdmx = Store.cdmxNow();
      const stay = {
        id: Store.nextId(db, 'stays'), guest_barcode, guest_name, room_number, cards_count, status: 'activo',
        entry_date_utc: utc, entry_date_cdmx: cdmx, exit_date_utc: null, exit_date_cdmx: null,
        towel_limit, initial_towels, current_towels: initial_towels,
        comment: cleanText(body.comment, 'El comentario', 500), created_by: session.userId, updated_by: session.userId
      };
      db.stays.push(stay);

      if (initial_towels > 0) {
        db.movements.push({
          id: Store.nextId(db, 'movements'), stay_id: stay.id, card_id: null, user_id: session.userId,
          movement_type: 'inicial', quantity: initial_towels, balance_after: initial_towels,
          reason: 'Asignación inicial', created_at_utc: utc, created_at_cdmx: cdmx
        });
      }

      insertHistory(db, session.userId, 'ALTA_HUESPED', stay.id, null,
        { guest_name, room_number, guest_barcode, cards_count, towel_limit, initial_towels, current_towels: initial_towels });
      return stay;
    });
  }

  function updateStay(session, id, body) {
    return Store.tx(db => {
      const stay = db.stays.find(s => s.id === id);
      if (!stay) throw new Error('Huésped no encontrado');

      const oldValues = { guest_name: stay.guest_name, towel_limit: stay.towel_limit, cards_count: stay.cards_count, comment: stay.comment };
      const changes = {};

      if (body.towel_limit !== undefined) {
        const newLimit = toNonNegativeInt(body.towel_limit, 'Límite de toallas');
        if (stay.status === 'activo' && newLimit < stay.current_towels) {
          throw new Error('El nuevo límite no puede ser menor a las toallas que ya tiene el huésped');
        }
        changes.towel_limit = newLimit;
      }
      if (body.cards_count !== undefined) changes.cards_count = toNonNegativeInt(body.cards_count, 'Cantidad de tarjetas');
      if (body.comment !== undefined) changes.comment = cleanText(body.comment, 'El comentario', 500);
      if (body.guest_name !== undefined) changes.guest_name = cleanText(body.guest_name, 'El nombre del huésped', 100, true);
      if (!Object.keys(changes).length) throw new Error('No hay datos para actualizar');

      Object.assign(stay, changes, { updated_by: session.userId });
      insertHistory(db, session.userId, 'ACTUALIZAR_HUESPED', id, oldValues,
        { guest_name: stay.guest_name, towel_limit: stay.towel_limit, cards_count: stay.cards_count, comment: stay.comment });
      return stay;
    });
  }

  function moveTowels(session, id, body) {
    return Store.tx(db => {
      const { action, qty, reason } = body;
      if (!['entrega', 'devolucion'].includes(action)) throw new Error('Acción inválida');

      const quantity = Number(qty);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('La cantidad debe ser un entero mayor a 0');

      const stay = db.stays.find(s => s.id === id);
      if (!stay) throw new Error('Huésped no encontrado');
      if (stay.status !== 'activo') throw new Error('El huésped ya no está activo');

      const delta = action === 'entrega' ? quantity : -quantity;
      const balance = stay.current_towels + delta;

      if (balance < 0) throw new Error('La devolución dejaría la cuenta de toallas en negativo');
      if (action === 'entrega' && balance > stay.towel_limit) {
        throw new Error(`Límite excedido. Solo puede recibir ${stay.towel_limit - stay.current_towels} toalla(s) más.`);
      }

      db.movements.push({
        id: Store.nextId(db, 'movements'), stay_id: id, card_id: null, user_id: session.userId,
        movement_type: action, quantity: delta, balance_after: balance,
        reason: reason ? cleanText(reason, 'El motivo', 200) : null,
        created_at_utc: Store.utcNow(), created_at_cdmx: Store.cdmxNow()
      });

      insertHistory(db, session.userId, action === 'entrega' ? 'ENTREGA_TOALLAS' : 'DEVOLUCION_TOALLAS', id,
        { current_towels: stay.current_towels, towel_limit: stay.towel_limit },
        { current_towels: balance, towel_limit: stay.towel_limit });

      stay.current_towels = balance;
      stay.updated_by = session.userId;
      return stay;
    });
  }

  function checkout(session, id) {
    return Store.tx(db => {
      const stay = db.stays.find(s => s.id === id);
      if (!stay) throw new Error('Huésped no encontrado');
      if (stay.status !== 'activo') throw new Error('El huésped ya salió');
      if (stay.current_towels !== 0) throw new Error(`No se puede hacer check-out. Faltan ${stay.current_towels} toallas por devolver.`);

      Object.assign(stay, { status: 'salido', exit_date_utc: Store.utcNow(), exit_date_cdmx: Store.cdmxNow(), updated_by: session.userId });
      insertHistory(db, session.userId, 'CHECKOUT', id,
        { status: 'activo', current_towels: stay.current_towels }, { status: 'salido', current_towels: stay.current_towels });
      return stay;
    });
  }

  function scan(code) {
    code = String(code || '').trim();
    if (!code) fail(400, 'Código requerido');
    const db = Store.view();
    const stay = db.stays.filter(s => s.guest_barcode === code)
      .sort((a, b) => (a.status === 'activo' ? 0 : 1) - (b.status === 'activo' ? 0 : 1) || b.id - a.id)[0];
    if (!stay) fail(404, 'Tarjeta no encontrada');
    return withMovements(db, stay, 20);
  }

  // ---------- Historial ----------
  function history(q) {
    const limit = Math.min(Number(q.get('limit')) || 200, 1000);
    const stayId = q.get('stay_id') ? Number(q.get('stay_id')) : null;
    const db = Store.view();
    return db.history.filter(h => !stayId || h.stay_id === stayId).sort((a, b) => b.id - a.id).slice(0, limit)
      .map(h => {
        const u = db.users.find(x => x.id === h.user_id) || {};
        const s = db.stays.find(x => x.id === h.stay_id) || {};
        return { ...h, username: u.username || null, full_name: u.full_name || null, guest_name: s.guest_name || null, room_number: s.room_number || null };
      });
  }

  // ---------- Usuarios ----------
  const publicUser = u => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role, active: u.active, created_at_cdmx: u.created_at_cdmx });

  async function createUser(session, body) {
    const { username, password, full_name, role } = body;
    if (!username || !password || !full_name || !role) fail(400, 'Todos los campos son requeridos');
    if (!['admin', 'recepcion', 'toallero'].includes(role)) fail(400, 'Rol inválido');
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(String(username).trim())) {
      fail(400, 'El usuario debe tener de 3 a 32 caracteres (letras, números, punto, guion)');
    }
    const pw = String(password);
    if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
      fail(400, 'La contraseña debe tener al menos 8 caracteres, con letras y números');
    }
    const name = cleanText(full_name, 'El nombre completo', 100, true);
    const uname = String(username).trim();
    if (Store.view().users.some(u => u.username === uname)) fail(400, 'Ese usuario ya existe');

    const salt = Store.newSalt();
    const password_hash = await Store.hashPassword(pw, salt);
    Store.tx(db => {
      if (db.users.some(u => u.username === uname)) throw new Error('Ese usuario ya existe');
      const user = { id: Store.nextId(db, 'users'), username: uname, password_hash, salt, full_name: name, role, active: 1, created_at_utc: Store.utcNow(), created_at_cdmx: Store.cdmxNow() };
      db.users.push(user);
      insertHistory(db, session.userId, 'CREAR_USUARIO', null, null, { userId: user.id, username: uname, role });
    });
    return { ok: true };
  }

  function toggleUser(session, id) {
    return Store.tx(db => {
      const user = db.users.find(u => u.id === id);
      if (!user) fail(404, 'Usuario no encontrado');
      if (user.id === session.userId) fail(400, 'No puedes desactivar tu propio usuario');
      const active = user.active ? 0 : 1;
      insertHistory(db, session.userId, active ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', null,
        { username: user.username, active: user.active }, { username: user.username, active });
      user.active = active;
      return { ok: true };
    });
  }

  // Equivale al aviso "[SEGURIDAD] el usuario sigue con la contraseña por defecto" del servidor
  async function defaultPasswordUsers() {
    const found = [];
    for (const [username, pass] of DEFAULT_USERS) {
      const u = Store.view().users.find(x => x.username === username && x.active);
      if (u && await Store.hashPassword(pass, u.salt) === u.password_hash) found.push(username);
    }
    return found;
  }

  // ---------- Exportar a Excel y limpiar historial ----------
  function exportDatabase(session) {
    const db = Store.view();
    const un = id => (db.users.find(u => u.id === id) || {}).username || '';
    const st = id => db.stays.find(s => s.id === id) || {};

    const blob = Xlsx.build([
      ['Usuarios', ['ID', 'Usuario', 'Nombre', 'Rol', 'Activo', 'Creado (CDMX)'],
        db.users.map(u => [u.id, u.username, u.full_name, u.role, u.active ? 'Sí' : 'No', u.created_at_cdmx])],
      ['Huespedes', ['ID', 'Código', 'Huésped', 'Habitación', 'Tarjetas', 'Estado', 'Entrada (CDMX)', 'Salida (CDMX)', 'Límite toallas',
        'Toallas iniciales', 'Toallas actuales', 'Comentario', 'Creado por (ID)', 'Actualizado por (ID)'],
        db.stays.map(s => [s.id, s.guest_barcode, s.guest_name, s.room_number, s.cards_count, s.status, s.entry_date_cdmx, s.exit_date_cdmx,
          s.towel_limit, s.initial_towels, s.current_towels, s.comment, s.created_by, s.updated_by])],
      ['Movimientos', ['ID', 'Fecha (CDMX)', 'Huésped', 'Habitación', 'Usuario', 'Tipo', 'Cantidad', 'Saldo después', 'Motivo'],
        db.movements.map(m => [m.id, m.created_at_cdmx, st(m.stay_id).guest_name, st(m.stay_id).room_number, un(m.user_id),
          m.movement_type, m.quantity, m.balance_after, m.reason])],
      ['Historial', ['ID', 'Fecha (CDMX)', 'Usuario', 'Acción', 'Huésped', 'Habitación', 'Valores anteriores', 'Valores nuevos'],
        db.history.map(h => [h.id, h.created_at_cdmx, un(h.user_id), h.action, st(h.stay_id).guest_name, st(h.stay_id).room_number, h.old_values, h.new_values])]
    ]);

    // Solo se borra el historial que ya quedó dentro del Excel
    const maxHistoryId = db.history.length ? Math.max(...db.history.map(h => h.id)) : 0;
    const active = db.stays.filter(s => s.status === 'activo').length;
    Store.tx(d => {
      d.history = d.history.filter(h => h.id > maxHistoryId);
      insertHistory(d, session.userId, 'EXPORTAR_BD', null, null,
        { usuarios: d.users.length, huespedes_activos: active, huespedes_checkout: d.stays.length - active });
    });

    return { blob, filename: `toallas-respaldo-${Store.cdmxNow().replace(/[-: ]/g, '').slice(0, 12)}.xlsx` };
  }

  // ---------- Enrutador ----------
  async function handle(url, options = {}) {
    await ready;
    if (readyError) throw readyError;

    const method = (options.method || 'GET').toUpperCase();
    const u = new URL(url, 'http://local');
    const path = u.pathname, q = u.searchParams;
    const body = options.body && typeof options.body === 'object' ? options.body : {};
    let m;

    try {
      if (method === 'POST' && path === '/api/login') return await login(body);
      if (method === 'POST' && path === '/api/logout') return logout();

      if (method === 'GET' && path === '/api/stays') { need(['recepcion', 'admin']); return listStays(q); }
      if (method === 'POST' && path === '/api/stays') return createStay(need(['recepcion', 'admin']), body);
      if ((m = path.match(/^\/api\/stays\/(\d+)$/))) {
        if (method === 'GET') {
          need(['recepcion', 'admin']);
          const db = Store.view(), stay = db.stays.find(s => s.id === Number(m[1]));
          if (!stay) fail(404, 'Huésped no encontrado');
          return withMovements(db, stay, 30);
        }
        if (method === 'PATCH') return updateStay(need(['recepcion', 'admin']), Number(m[1]), body);
      }
      if (method === 'POST' && (m = path.match(/^\/api\/stays\/(\d+)\/towels$/))) return moveTowels(need(['toallero', 'recepcion', 'admin']), Number(m[1]), body);
      if (method === 'POST' && (m = path.match(/^\/api\/stays\/(\d+)\/checkout$/))) return checkout(need(['recepcion', 'admin']), Number(m[1]));
      if (method === 'GET' && (m = path.match(/^\/api\/scan\/(.+)$/))) { need(); return scan(decodeURIComponent(m[1])); }

      if (method === 'GET' && path === '/api/history') { need(['admin', 'recepcion']); return history(q); }

      if (method === 'GET' && path === '/api/users') { need(['admin']); return Store.view().users.map(publicUser); }
      if (method === 'POST' && path === '/api/users') return await createUser(need(['admin']), body);
      if (method === 'POST' && (m = path.match(/^\/api\/users\/(\d+)\/toggle$/))) return toggleUser(need(['admin']), Number(m[1]));
      if (method === 'GET' && path === '/api/security/default-passwords') { need(['admin']); return await defaultPasswordUsers(); }

      if (method === 'POST' && path === '/api/export-db') return exportDatabase(need(['admin']));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(400, e && e.message ? e.message : 'Error inesperado');
    }

    throw new ApiError(404, 'Ruta no encontrada');
  }

  return { handle, ApiError };
})();
