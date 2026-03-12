-- Users tablosuna permissions kolonu ekle
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- Index ekle
CREATE INDEX IF NOT EXISTS idx_users_permissions ON users USING GIN (permissions);