-- Brand Owner rolü ekle
ALTER TYPE user_role ADD VALUE 'brand_owner' AFTER 'super_admin';

-- Mevcut branch_manager'ları analiz et ve güncelle
UPDATE users 
SET role = 'brand_owner' 
WHERE role = 'branch_manager' 
AND brand_id IS NOT NULL 
AND branch_id IS NULL;

-- Role hierarchy güncellemesi
UPDATE users 
SET role_hierarchy = CASE 
  WHEN role = 'super_admin' THEN 'super_admin'
  WHEN role = 'brand_owner' THEN 'brand_admin'
  WHEN role = 'branch_manager' THEN 'branch_manager'
  ELSE 'staff'
END;

-- Yeni permission'lar ekle
INSERT INTO permissions (code, name, category) VALUES
-- Brand Owner izinleri
('brand.edit', 'Marka Bilgilerini Düzenle', 'brand'),
('branch.create', 'Yeni Şube Oluştur', 'branch'),
('branch.delete', 'Şube Sil', 'branch'),
('template.create', 'Şablon Oluştur', 'template'),
('user.create', 'Kullanıcı Oluştur', 'user'),
('report.brand', 'Marka Raporları', 'report'),

-- Branch Manager izinleri
('stock.manage', 'Stok Yönetimi', 'stock'),
('price.edit', 'Fiyat Güncelleme', 'price'),
('campaign.local', 'Yerel Kampanya', 'campaign')
ON CONFLICT (code) DO NOTHING;