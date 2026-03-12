-- Kullanıcı limitlerini yönetmek için tablo oluşturma
CREATE TABLE IF NOT EXISTS user_limits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    limit_type VARCHAR(50) NOT NULL,
    limit_value INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(user_id, limit_type)
);

CREATE INDEX IF NOT EXISTS idx_user_limit ON user_limits(user_id, limit_type);

-- Varsayılan limitler için sistem ayarları tablosu
CREATE TABLE IF NOT EXISTS system_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Varsayılan sistem ayarları
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('default_branch_limit', '5', 'Yeni kullanıcılar için varsayılan şube limiti'),
('default_user_limit', '50', 'Brand owner için varsayılan kullanıcı limiti'),
('default_product_limit', '500', 'Brand owner için varsayılan ürün limiti')
ON CONFLICT (setting_key) DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    updated_at = CURRENT_TIMESTAMP;