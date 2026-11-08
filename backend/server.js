import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const app = express();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});
pool.on('error', (error) => {
  console.error(`[${new Date().toISOString()}] Error inesperado del pool de PostgreSQL`, error);
});
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(rootDir, 'front_end');
const production = process.env.NODE_ENV === 'production';
const cookieName = 'aesthetic_session';
const sessionDurationSeconds = 60 * 60 * 8;
const allowedServices = [
  'Instalación de aire acondicionado',
  'Secado de carros',
  'Limpieza de oficinas',
];
const allowedStatuses = ['received', 'in_progress', 'resolved', 'closed'];

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatorio.');
}
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
      },
    },
  }),
);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return res.status(403).json({ error: 'La solicitud no tiene un origen válido.' });
  try {
    const originUrl = new URL(origin);
    if (originUrl.origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ error: 'La solicitud no tiene un origen válido.' });
    }
  } catch {
    return res.status(403).json({ error: 'La solicitud no tiene un origen válido.' });
  }
  return next();
});
app.use(express.json({ limit: '7mb' }));

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function normalizeEmail(value) {
  if (typeof value !== 'string') fail(400, 'Escribe un correo válido.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'Escribe un correo válido.');
  }
  return email;
}

function cleanText(value, label, maxLength) {
  if (typeof value !== 'string') fail(400, `${label} es obligatorio.`);
  const text = value.trim();
  if (!text || text.length > maxLength) {
    fail(400, `${label} debe tener entre 1 y ${maxLength} caracteres.`);
  }
  return text;
}

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    fail(400, 'El identificador no es válido.');
  }
  return value;
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const [algorithm, salt, storedKey] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !storedKey) return false;
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(storedKey, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}

function hashSessionToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash('sha256').update(token).digest('hex');
}

async function setSessionCookie(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO user_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))`,
    [tokenHash, userId, sessionDurationSeconds],
  );
  await pool.query('DELETE FROM user_sessions WHERE expires_at < NOW()');
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionDurationSeconds * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
  });
}

function requireUser(req, res, next) {
  Promise.resolve().then(async () => {
    const cookie = (req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    const token = cookie?.slice(cookieName.length + 1);
    const tokenHash = hashSessionToken(token);
    if (!tokenHash) return res.status(401).json({ error: 'Inicia sesión para continuar.' });

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash],
    );
    if (result.rowCount === 0) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'La sesión ya no es válida.' });
    }
    req.user = result.rows[0];
    req.sessionTokenHash = tokenHash;
    return next();
  }).catch(next);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
    }
    return next();
  };
}

function parsePhoto(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(400, 'La foto no tiene un formato válido.');
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail(400, 'La foto debe estar en formato JPG, PNG o WebP.');
  const photo = Buffer.from(match[2], 'base64');
  if (photo.length === 0 || photo.length > 5 * 1024 * 1024) {
    fail(400, 'La foto no puede superar los 5 MB.');
  }

  const isJpeg = match[1] === 'image/jpeg' && photo.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng =
    match[1] === 'image/png' &&
    photo.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp =
    match[1] === 'image/webp' &&
    photo.subarray(0, 4).toString() === 'RIFF' &&
    photo.subarray(8, 12).toString() === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) fail(400, 'El contenido de la foto no coincide con su formato.');
  return { photo, mime: match[1] };
}

function publicRequest(row) {
  return {
    id: row.id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    service: row.service,
    description: row.description,
    status: row.status,
    resolutionNote: row.resolution_note,
    hasPhoto: Boolean(row.photo_mime),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', loginLimiter, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 'El nombre', 120);
  const email = normalizeEmail(req.body.email);
  const passwordHash = await hashPassword(req.body.password);
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, passwordHash, 'client'],
    );
    await setSessionCookie(res, result.rows[0].id);
    return res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') fail(409, 'Ya existe una cuenta con ese correo.');
    throw error;
  }
}));

app.post('/api/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const result = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = $1',
    [email],
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(req.body.password, user.password_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }
  await setSessionCookie(res, user.id);
  return res.json({
    user: { id: Number(user.id), name: user.name, email: user.email, role: user.role },
  });
}));

app.post('/api/auth/logout', requireUser, asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [req.sessionTokenHash]);
  clearSessionCookie(res);
  res.status(204).end();
}));

app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: req.user }));

app.post('/api/users', requireUser, requireRole('admin'), asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 'El nombre', 120);
  const email = normalizeEmail(req.body.email);
  const role = req.body.role;
  if (!['admin', 'collaborator'].includes(role)) fail(400, 'El rol solicitado no es válido.');
  const passwordHash = await hashPassword(req.body.password);
  try {
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
      [name, email, passwordHash, role],
    );
    return res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') fail(409, 'Ya existe una cuenta con ese correo.');
    throw error;
  }
}));

app.get('/api/users', requireUser, requireRole('admin'), asyncRoute(async (_req, res) => {
  const result = await pool.query(
    "SELECT id, name, email, role, created_at FROM users WHERE role IN ('admin', 'collaborator') ORDER BY created_at DESC",
  );
  return res.json({ users: result.rows });
}));

app.post('/api/requests', requireUser, requireRole('client'), asyncRoute(async (req, res) => {
  const service = req.body.service;
  if (!allowedServices.includes(service)) fail(400, 'Selecciona uno de los servicios disponibles.');
  const description = cleanText(req.body.description, 'La descripción', 3000);
  const image = parsePhoto(req.body.photo);
  const result = await pool.query(
    `INSERT INTO service_requests (client_id, service, description, photo, photo_mime)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, service, description, status, resolution_note, photo_mime, created_at, updated_at`,
    [req.user.id, service, description, image?.photo ?? null, image?.mime ?? null],
  );
  return res.status(201).json({ request: publicRequest({ ...result.rows[0], client_name: req.user.name, client_email: req.user.email }) });
}));

app.get('/api/requests', requireUser, asyncRoute(async (req, res) => {
  const result = req.user.role === 'client'
    ? await pool.query(
        `SELECT r.id, u.name AS client_name, u.email AS client_email, r.service, r.description,
                r.status, r.resolution_note, r.photo_mime, r.created_at, r.updated_at
         FROM service_requests r JOIN users u ON u.id = r.client_id
         WHERE r.client_id = $1 ORDER BY r.created_at DESC`,
        [req.user.id],
      )
    : await pool.query(
        `SELECT r.id, u.name AS client_name, u.email AS client_email, r.service, r.description,
                r.status, r.resolution_note, r.photo_mime, r.created_at, r.updated_at
         FROM service_requests r JOIN users u ON u.id = r.client_id
         ORDER BY r.created_at DESC`,
      );
  return res.json({ requests: result.rows.map(publicRequest) });
}));

app.get('/api/requests/:id/photo', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'SELECT client_id, photo, photo_mime FROM service_requests WHERE id = $1',
    [parseId(req.params.id)],
  );
  const row = result.rows[0];
  if (!row?.photo) return res.status(404).json({ error: 'No se encontró la foto.' });
  if (req.user.role === 'client' && Number(row.client_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'No tienes permiso para ver esta foto.' });
  }
  res.set('Cache-Control', 'private, no-store');
  res.type(row.photo_mime).send(row.photo);
}));

app.patch('/api/requests/:id/status', requireUser, requireRole('admin', 'collaborator'), asyncRoute(async (req, res) => {
  const status = req.body.status;
  if (!allowedStatuses.includes(status)) fail(400, 'El estado solicitado no es válido.');
  if (req.user.role === 'collaborator' && !['in_progress', 'resolved'].includes(status)) {
    fail(403, 'Los colaboradores solo pueden marcar un servicio en proceso o resuelto.');
  }
  const resolutionNote = typeof req.body.resolutionNote === 'string' && req.body.resolutionNote.trim()
    ? cleanText(req.body.resolutionNote, 'La nota de resolución', 1000)
    : null;
  const result = await pool.query(
    `UPDATE service_requests
     SET status = $1, resolution_note = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, service, description, status, resolution_note, photo_mime, created_at, updated_at`,
    [status, resolutionNote, parseId(req.params.id)],
  );
  if (result.rowCount === 0) fail(404, 'No se encontró la solicitud.');
  return res.json({ request: result.rows[0] });
}));

app.post('/api/reports', requireUser, requireRole('admin'), asyncRoute(async (req, res) => {
  const { date, kind, amount, service } = req.body;
  const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00Z`)
    : null;
  if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    fail(400, 'Selecciona una fecha válida.');
  }
  if (!['income', 'expense'].includes(kind)) fail(400, 'Selecciona ingreso o gasto.');
  const parsedAmount = Number(amount);
  const cents = Math.round(parsedAmount * 100);
  if (!Number.isFinite(parsedAmount) || cents <= 0 || cents > 999999999999) {
    fail(400, 'El valor debe ser un monto mayor a cero.');
  }
  if (kind === 'income' && !allowedServices.includes(service)) {
    fail(400, 'Selecciona el servicio relacionado con el ingreso.');
  }
  const category = cleanText(req.body.category, 'La categoría', 100);
  const description = cleanText(req.body.description, 'El detalle', 1000);
  const result = await pool.query(
    `INSERT INTO daily_entries (entry_date, kind, service, category, description, amount, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, entry_date, kind, service, category, description, amount, created_at`,
    [date, kind, kind === 'income' ? service : null, category, description, (cents / 100).toFixed(2), req.user.id],
  );
  return res.status(201).json({ entry: result.rows[0] });
}));

app.get('/api/reports', requireUser, requireRole('admin'), asyncRoute(async (req, res) => {
  const date = req.query.date === undefined ? null : req.query.date;
  if (date !== null) {
    const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(`${date}T00:00:00Z`)
      : null;
    if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
      fail(400, 'La fecha del reporte no es válida.');
    }
  }
  const entries = await pool.query(
    `SELECT e.id, e.entry_date, e.kind, e.service, e.category, e.description, e.amount,
            e.created_at, u.name AS created_by
     FROM daily_entries e JOIN users u ON u.id = e.created_by
     WHERE ($1::date IS NULL OR e.entry_date = $1::date)
     ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 200`,
    [date],
  );
  const totals = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0) AS income,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0) AS expenses
     FROM daily_entries
     WHERE ($1::date IS NULL OR entry_date = $1::date)`,
    [date],
  );
  return res.json({ entries: entries.rows, totals: totals.rows[0], date });
}));

app.use('/imagenes', express.static(path.join(rootDir, 'imagenes'), { maxAge: production ? '1h' : 0 }));
app.use(express.static(frontendDir, { extensions: ['html'], maxAge: production ? '1h' : 0 }));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No se encontró esta ruta.' });
  return res.status(404).send('Página no encontrada.');
});

app.use((error, req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, error);
  if (res.headersSent) return;
  return res.status(status).json({
    error: status >= 500 ? 'Ocurrió un error interno. Inténtalo más tarde.' : error.message,
  });
});

async function start() {
  const schema = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
  await pool.query(schema);
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => console.log(`Aesthetic Clean listo en el puerto ${port}.`));
  const shutdown = () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(async (error) => {
  console.error('No se pudo iniciar el servidor:', error);
  await pool.end();
  process.exitCode = 1;
});
