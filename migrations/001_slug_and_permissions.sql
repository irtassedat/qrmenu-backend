-- 1. SLUG SİSTEMİ
-- Brand ve Branch için slug alanları
ALTER TABLE brands ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS full_slug VARCHAR(200) UNIQUE;

-- Mevcut kayıtlar için slug oluştur
UPDATE brands SET slug = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', '-'), 'ğ', 'g'), 'ü', 'u'), 'ş', 's'), 'ı', 'i'), 'ç', 'c'));
UPDATE branches SET slug = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', '-'), 'ğ', 'g'), 'ü', 'u'), 'ş', 's'), 'ı', 'i'), 'ç', 'c'));

-- Full slug oluştur
UPDATE branches b SET full_slug = 
  (SELECT br.slug || '/' || b.slug FROM brands br WHERE br.id = b.brand_id);

-- Indeksler
CREATE INDEX IF NOT EXISTS idx_brands_slug ON brands(slug);
CREATE INDEX IF NOT EXISTS idx_branches_slug ON branches(slug);
CREATE INDEX IF NOT EXISTS idx_branches_full_slug ON branches(full_slug);

-- 2. YETKİLENDİRME SİSTEMİ
-- User-Brand ilişki tablosu
CREATE TABLE IF NOT EXISTS user_brands (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'brand_manager',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, brand_id)
);

-- User-Branch ilişki tablosu
CREATE TABLE IF NOT EXISTS user_branches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES branches(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'branch_manager',
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, branch_id)
);

-- Yeni roller için users tablosunu güncelle
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_hierarchy VARCHAR(50) DEFAULT 'staff';
-- Olası değerler: 'super_admin', 'brand_admin', 'branch_manager', 'staff'

-- İzin tanımları tablosu
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) -- 'menu', 'order', 'report', 'settings'
);

-- Temel izinleri ekle
INSERT INTO permissions (code, name, category) VALUES
('menu.view', 'Menüyü Görüntüle', 'menu'),
('menu.edit', 'Menüyü Düzenle', 'menu'),
('order.view', 'Siparişleri Görüntüle', 'order'),
('order.manage', 'Siparişleri Yönet', 'order'),
('report.view', 'Raporları Görüntüle', 'report'),
('settings.edit', 'Ayarları Düzenle', 'settings')
ON CONFLICT (code) DO NOTHING;

-- Örnek veri ekle (test için)
-- Super Admin'e tüm brand'leri bağla
INSERT INTO user_brands (user_id, brand_id, role)
SELECT 1, id, 'super_admin' FROM brands
ON CONFLICT DO NOTHING;