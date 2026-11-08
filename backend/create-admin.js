import 'dotenv/config';
import pg from 'pg';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Administrador';

if (!process.env.DATABASE_URL || !email || !password) {
  console.error('Define DATABASE_URL, ADMIN_EMAIL y ADMIN_PASSWORD en el entorno.');
  process.exitCode = 1;
} else if (password.length < 12) {
  console.error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });

  try {
    const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
    await pool.query(await readFile(schemaPath, 'utf8'));

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      throw new Error('Ya existe una cuenta con ese correo.');
    }

    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64);
    const passwordHash = `scrypt$${salt}$${key.toString('hex')}`;
    await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [name, email, passwordHash, 'admin'],
    );
    console.log(`Administrador creado: ${email}`);
  } catch (error) {
    console.error(`No se pudo crear el administrador: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
