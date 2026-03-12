-- Migration: Brand Manager Role Support
-- Bu migration brand_manager rolü için gerekli düzenlemeleri yapar

-- 1. Users tablosuna permissions alanı ekle (eğer yoksa)
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- 2. Rol değişikliklerinde otomatik güncelleme için trigger oluştur
CREATE OR REPLACE FUNCTION sync_user_role_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Eğer rol değişmişse
    IF OLD.role IS DISTINCT FROM NEW.role THEN
        -- Eski role göre temizlik yap
        IF OLD.role = 'branch_manager' THEN
            -- user_branches tablosundan kaldır
            DELETE FROM user_branches WHERE user_id = NEW.id;
        ELSIF OLD.role = 'brand_manager' THEN
            -- user_brands tablosundan kaldır
            DELETE FROM user_brands WHERE user_id = NEW.id;
        END IF;
        
        -- Yeni role göre ekleme yap
        IF NEW.role = 'branch_manager' AND NEW.branch_id IS NOT NULL THEN
            -- user_branches tablosuna ekle
            INSERT INTO user_branches (user_id, branch_id, role, permissions)
            VALUES (NEW.id, NEW.branch_id, 'branch_manager', '{}')
            ON CONFLICT (user_id, branch_id) DO UPDATE
            SET role = 'branch_manager';
        ELSIF NEW.role = 'brand_manager' AND NEW.brand_id IS NOT NULL THEN
            -- user_brands tablosuna ekle
            INSERT INTO user_brands (user_id, brand_id, role)
            VALUES (NEW.id, NEW.brand_id, 'brand_manager')
            ON CONFLICT (user_id, brand_id) DO UPDATE
            SET role = 'brand_manager';
        END IF;
    END IF;
    
    -- Branch veya brand değişikliklerini kontrol et
    IF NEW.role = 'branch_manager' THEN
        IF OLD.branch_id IS DISTINCT FROM NEW.branch_id AND NEW.branch_id IS NOT NULL THEN
            -- Eski branch kaydını sil
            DELETE FROM user_branches WHERE user_id = NEW.id;
            -- Yeni branch kaydını ekle
            INSERT INTO user_branches (user_id, branch_id, role, permissions)
            VALUES (NEW.id, NEW.branch_id, 'branch_manager', '{}')
            ON CONFLICT (user_id, branch_id) DO UPDATE
            SET role = 'branch_manager';
        END IF;
    ELSIF NEW.role = 'brand_manager' THEN
        IF OLD.brand_id IS DISTINCT FROM NEW.brand_id AND NEW.brand_id IS NOT NULL THEN
            -- Eski brand kaydını sil
            DELETE FROM user_brands WHERE user_id = NEW.id;
            -- Yeni brand kaydını ekle
            INSERT INTO user_brands (user_id, brand_id, role)
            VALUES (NEW.id, NEW.brand_id, 'brand_manager')
            ON CONFLICT (user_id, brand_id) DO UPDATE
            SET role = 'brand_manager';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger'ı oluştur
DROP TRIGGER IF EXISTS sync_user_role_changes_trigger ON users;
CREATE TRIGGER sync_user_role_changes_trigger
AFTER UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_role_changes();

-- 3. Mevcut kullanıcıları senkronize et
-- Branch manager'ları user_branches tablosuna ekle
INSERT INTO user_branches (user_id, branch_id, role, permissions)
SELECT id, branch_id, 'branch_manager', '{}'
FROM users
WHERE role = 'branch_manager' AND branch_id IS NOT NULL
ON CONFLICT (user_id, branch_id) DO NOTHING;

-- Brand manager'ları user_brands tablosuna ekle
INSERT INTO user_brands (user_id, brand_id, role)
SELECT id, brand_id, 'brand_manager'
FROM users
WHERE role = 'brand_manager' AND brand_id IS NOT NULL
ON CONFLICT (user_id, brand_id) DO NOTHING;

-- 4. Yeni kullanıcı eklendiğinde de senkronizasyon için trigger
CREATE OR REPLACE FUNCTION sync_new_user_role()
RETURNS TRIGGER AS $$
BEGIN
    -- Yeni kullanıcının rolüne göre ilgili tabloya ekle
    IF NEW.role = 'branch_manager' AND NEW.branch_id IS NOT NULL THEN
        INSERT INTO user_branches (user_id, branch_id, role, permissions)
        VALUES (NEW.id, NEW.branch_id, 'branch_manager', '{}')
        ON CONFLICT (user_id, branch_id) DO NOTHING;
    ELSIF NEW.role = 'brand_manager' AND NEW.brand_id IS NOT NULL THEN
        INSERT INTO user_brands (user_id, brand_id, role)
        VALUES (NEW.id, NEW.brand_id, 'brand_manager')
        ON CONFLICT (user_id, brand_id) DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Insert trigger'ını oluştur
DROP TRIGGER IF EXISTS sync_new_user_role_trigger ON users;
CREATE TRIGGER sync_new_user_role_trigger
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION sync_new_user_role();

-- 5. Brand manager için kategori yönetimi yetkisi
-- permissions tablosuna brand manager izinleri ekle
INSERT INTO permissions (code, name, category) VALUES
('category.view', 'Kategorileri Görüntüle', 'menu'),
('category.edit', 'Kategorileri Düzenle', 'menu'),
('brand.view', 'Marka Bilgilerini Görüntüle', 'brand'),
('brand.edit', 'Marka Bilgilerini Düzenle', 'brand'),
('branch.create', 'Yeni Şube Oluştur', 'branch'),
('branch.edit', 'Şube Bilgilerini Düzenle', 'branch'),
('template.view', 'Şablonları Görüntüle', 'template'),
('template.edit', 'Şablonları Düzenle', 'template')
ON CONFLICT (code) DO NOTHING;

-- Migration tamamlandı