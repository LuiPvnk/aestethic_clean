CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'collaborator', 'client')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_expiration
  ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES users(id),
  service TEXT NOT NULL CHECK (
    service IN ('Instalación de aire acondicionado', 'Secado de carros', 'Limpieza de oficinas')
  ),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'in_progress', 'resolved', 'closed')
  ),
  resolution_note TEXT,
  photo BYTEA,
  photo_mime TEXT CHECK (photo_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((photo IS NULL) = (photo_mime IS NULL))
);

CREATE INDEX IF NOT EXISTS service_requests_client_created
  ON service_requests (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_requests_status_created
  ON service_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  service TEXT CHECK (
    service IS NULL OR service IN ('Instalación de aire acondicionado', 'Secado de carros', 'Limpieza de oficinas')
  ),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_by BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'income' AND service IS NOT NULL) OR (kind = 'expense' AND service IS NULL))
);

CREATE INDEX IF NOT EXISTS daily_entries_date
  ON daily_entries (entry_date DESC, created_at DESC);
