const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Dosya yükleme konfigürasyonu
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Benzersiz dosya adı ve uzantısı koruyarak kaydetme
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Desteklenen dosya tiplerini kontrol etme
const fileFilter = (req, file, cb) => {
  // İzin verilen MIME tipleri
  const allowedTypes = [
    'image/jpeg', 
    'image/png', 
    'image/gif', 
    'image/svg+xml',
    'video/mp4',
    'video/webm'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF, SVG, MP4 ve WEBM desteklenmektedir.'), false);
  }
};

// Dosya boyutu limiti (50MB)
const limits = {
  fileSize: 50 * 1024 * 1024
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: limits
});

// Medya yükleme endpoint'i
router.post('/upload-media', authorize(['super_admin', 'branch_manager']), upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya yüklenemedi' });
    }

    // Yüklenen dosyanın URL'sini oluştur
    const fileUrl = `/uploads/${req.file.filename}`;
    
    // Log
    console.log(`Dosya yüklendi: ${req.file.originalname} -> ${fileUrl} (${req.file.mimetype})`);
    
    // Dosya türünü belirle
    const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    
    res.json({
      success: true,
      url: fileUrl,
      type: fileType,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('Medya yüklenirken hata:', err);
    res.status(500).json({ error: 'Medya yüklenemedi', message: err.message });
  }
});

// Logo yükleme endpoint'i
router.post('/upload-logo', authorize(['super_admin', 'branch_manager']), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Logo yüklenemedi' });
    }

    // Yüklenen logoyu kaydet
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      url: fileUrl
    });
  } catch (err) {
    console.error('Logo yüklenirken hata:', err);
    res.status(500).json({ error: 'Logo yüklenemedi' });
  }
});

// Eski upload endpoint'i (geriye uyumluluk için)
router.post('/upload', authorize(['super_admin', 'branch_manager']), upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya yüklenemedi' });
    }
    
    // Dosya URL'ini oluştur
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      url: fileUrl,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('Dosya yüklenirken hata:', err.message);
    res.status(500).json({ error: 'Dosya yüklenemedi', details: err.message });
  }
});

// PUBLIC ROUTE - Tema ayarlarını getir (QR menü için)
router.get('/public/settings/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';

    const result = await db.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    res.json(result.rows[0].theme_settings || {});
  } catch (err) {
    console.error('Tema ayarları alınırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları alınamadı' });
  }
});

// PROTECTED ROUTE - Tema ayarlarını getir (Admin panel için)
router.get('/settings/:type/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';

    if (type === 'branch' && req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(id)) {
      return res.status(403).json({ error: 'Bu şubenin tema ayarlarına erişim yetkiniz yok' });
    }

    const result = await db.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    res.json(result.rows[0].theme_settings || {});
  } catch (err) {
    console.error('Tema ayarları alınırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları alınamadı' });
  }
});

// Tema ayarlarını güncelle
router.put('/settings/:type/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { type, id } = req.params;
    const { settings } = req.body;
    const table = type === 'brand' ? 'brands' : 'branches';

    console.log(`Tema ayarları güncelleniyor - Tip: ${type}, ID: ${id}, Tablo: ${table}`);
    console.log('Ayarlar:', JSON.stringify(settings, null, 2));

    // İlgili kaydın var olduğunu kontrol et
    const checkQuery = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);

    if (checkQuery.rows.length === 0) {
      console.log(`HATA: ${id} ID'li ${type} bulunamadı!`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    // Yetkili kontrolü - Branch manager sadece kendi şubesini güncelleyebilir
    if (type === 'branch' && req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(id)) {
      console.log(`HATA: Kullanıcı (ID: ${req.user.id}) yetki hatası - Kendi şubesi: ${req.user.branch_id}, Güncellenmeye çalışılan şube: ${id}`);
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu şubenin tema ayarlarını güncelleme yetkiniz yok' });
    }

    // Mevcut ayarları al
    const currentResult = await client.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    const oldSettings = currentResult.rows[0]?.theme_settings || {};

    // Ayarları güncelle
    const updateResult = await client.query(`
      UPDATE ${table}
      SET theme_settings = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, theme_settings
    `, [settings, id]);

    // Eğer veriler güncellenmediyse (örneğin, ID bulunamadı), hata ver
    if (updateResult.rows.length === 0) {
      console.log(`HATA: ${id} ID'li ${type} güncellenemedi!`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `${type === 'brand' ? 'Marka' : 'Şube'} bulunamadı veya güncellenemedi` });
    }

    // Değişiklik logunu kaydet
    try {
      await client.query(`
        INSERT INTO theme_change_logs 
        (${type}_id, changed_by, old_settings, new_settings)
        VALUES ($1, $2, $3, $4)
      `, [id, req.user.id, oldSettings, settings]);

      console.log(`Tema değişiklik logu kaydedildi - ${type}_id: ${id}, user_id: ${req.user.id}`);
    } catch (logError) {
      // Log kaydı hatası olsa bile işleme devam et
      console.warn('Tema değişiklik logu kaydedilirken hata:', logError.message);
    }

    await client.query('COMMIT');

    console.log('Güncelleme başarılı - Sonuç:', updateResult.rows);

    // Başarılı yanıt
    res.json({
      success: true,
      message: 'Tema ayarları güncellendi',
      settings: updateResult.rows[0].theme_settings
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tema ayarları güncellenirken hata:', err);
    res.status(500).json({ error: 'Tema ayarları güncellenemedi', details: err.message });
  } finally {
    client.release();
  }
});

// Marka tema ayarları - Geriye uyumlu yollar (eski endpointler)
router.get('/brand/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(
      'SELECT theme_settings FROM brands WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    res.json(result.rows[0].theme_settings || {});
  } catch (err) {
    console.error('Marka tema ayarları alınırken hata:', err.message);
    res.status(500).json({ error: 'Marka tema ayarları getirilemedi' });
  }
});

router.put('/brand/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const themeSettings = req.body;
    
    const result = await db.query(
      'UPDATE brands SET theme_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, theme_settings',
      [themeSettings, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Marka tema ayarları güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Marka tema ayarları güncellenemedi' });
  }
});

// Şube tema ayarları - Geriye uyumlu yollar (eski endpointler)
router.get('/branch/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Branch manager sadece kendi şubesinin tema ayarlarını görebilir
    if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(id)) {
      return res.status(403).json({ error: 'Bu şubenin tema ayarlarını görüntüleme yetkiniz yok' });
    }
    
    const result = await db.query(
      'SELECT theme_settings FROM branches WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    res.json(result.rows[0].theme_settings || {});
  } catch (err) {
    console.error('Şube tema ayarları alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube tema ayarları getirilemedi' });
  }
});

router.put('/branch/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const themeSettings = req.body;
    
    // Branch manager sadece kendi şubesinin tema ayarlarını güncelleyebilir
    if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(id)) {
      return res.status(403).json({ error: 'Bu şubenin tema ayarlarını güncelleme yetkiniz yok' });
    }
    
    const result = await db.query(
      'UPDATE branches SET theme_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, theme_settings',
      [themeSettings, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube tema ayarları güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Şube tema ayarları güncellenemedi' });
  }
});

// Tema şablonlarını getir
router.get('/templates', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM theme_templates ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Tema şablonları alınırken hata:', err);
    res.status(500).json({ error: 'Tema şablonları alınamadı' });
  }
});

// Tema şablonu oluştur
router.post('/templates', authorize(['super_admin']), async (req, res) => {
  try {
    const { name, description, settings, is_default } = req.body;

    if (is_default) {
      // Mevcut varsayılanı kaldır
      await db.query('UPDATE theme_templates SET is_default = false WHERE is_default = true');
    }

    const result = await db.query(`
      INSERT INTO theme_templates (name, description, settings, is_default)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, description, settings, is_default || false]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Tema şablonu oluşturulurken hata:', err);
    res.status(500).json({ error: 'Tema şablonu oluşturulamadı' });
  }
});

// Tema şablonunu uygula
router.post('/apply-template/:templateId/:type/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { templateId, type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';
    
    // Branch manager yetki kontrolü
    if (type === 'branch' && req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu şubeye tema şablonu uygulama yetkiniz yok' });
    }

    // Şablonu al
    const templateResult = await client.query('SELECT settings FROM theme_templates WHERE id = $1', [templateId]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tema şablonu bulunamadı' });
    }

    // Ayarları uygula
    const settings = templateResult.rows[0].settings;

    await client.query(`
      UPDATE ${table}
      SET theme_settings = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [settings, id]);

    // Log kaydet
    await client.query(`
      INSERT INTO theme_change_logs 
      (${type}_id, changed_by, old_settings, new_settings)
      VALUES ($1, $2, $3, $4)
    `, [id, req.user.id, {}, settings]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Tema şablonu uygulandı',
      settings
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tema şablonu uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema şablonu uygulanamadı' });
  } finally {
    client.release();
  }
});

// Tema değişiklik geçmişini getir
router.get('/change-logs/:type/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    
    // Branch manager yetki kontrolü
    if (type === 'branch' && req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(id)) {
      return res.status(403).json({ error: 'Bu şubenin tema değişiklik geçmişini görme yetkiniz yok' });
    }

    const result = await db.query(`
      SELECT 
        tcl.*,
        u.username as changed_by_username
      FROM theme_change_logs tcl
      LEFT JOIN users u ON tcl.changed_by = u.id
      WHERE tcl.${type}_id = $1
      ORDER BY tcl.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    res.json(result.rows);
  } catch (err) {
    console.error('Tema değişiklik logları alınırken hata:', err);
    res.status(500).json({ error: 'Değişiklik logları alınamadı' });
  }
});

// Markanın tema ayarlarını şubelerine uygula
router.post('/apply-brand-theme/:brandId', authorize(['super_admin']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const { brandId } = req.params;
    const { applyToAll = false, branchIds = [] } = req.body;
    
    // Markanın mevcut tema ayarlarını al
    const brandThemeResult = await client.query(
      'SELECT theme_settings FROM brands WHERE id = $1',
      [brandId]
    );
    
    if (brandThemeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    const brandThemeSettings = brandThemeResult.rows[0].theme_settings;
    
    if (!brandThemeSettings) {
      return res.status(400).json({ error: 'Markaya ait tema ayarları bulunamadı' });
    }
    
    // Hedef şubeleri belirle
    let targetBranchIds = [];
    
    if (applyToAll) {
      // Tüm şubelerin ID'lerini al
      const branchesResult = await client.query(
        'SELECT id FROM branches WHERE brand_id = $1',
        [brandId]
      );
      targetBranchIds = branchesResult.rows.map(branch => branch.id);
    } else {
      // Sadece belirtilen şubeleri kullan
      targetBranchIds = branchIds;
    }
    
    if (targetBranchIds.length === 0) {
      return res.status(400).json({ 
        error: 'Tema ayarlarını uygulanacak şube bulunamadı',
        message: 'Lütfen şubeleri seçin veya tüm şubelere uygula seçeneğini işaretleyin'
      });
    }
    
    // Her bir şubeye tema ayarlarını uygula
    for (const branchId of targetBranchIds) {
      await client.query(
        'UPDATE branches SET theme_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [brandThemeSettings, branchId]
      );
      
      // Tema değişiklik logu ekle
      await client.query(`
        INSERT INTO theme_change_logs 
        (branch_id, changed_by, old_settings, new_settings, change_source)
        VALUES ($1, $2, (SELECT theme_settings FROM branches WHERE id = $1), $3, 'brand_theme_sync')
      `, [branchId, req.user.id, brandThemeSettings]);
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: `Tema ayarları ${targetBranchIds.length} şubeye başarıyla uygulandı`,
      applied_to: targetBranchIds
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marka tema ayarları şubelere uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları uygulanamadı', details: err.message });
  } finally {
    client.release();
  }
});

// Yeni endpoint: Default ayarları al ve şubeye uygula
router.post('/apply-brand-defaults/:branchId', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const { branchId } = req.params;
    
    // Branch manager yetki kontrolü
    if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(branchId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu şubeye marka varsayılanlarını uygulama yetkiniz yok' });
    }
    
    // Şubenin marka bilgisini al
    const branchResult = await client.query(
      'SELECT brand_id FROM branches WHERE id = $1',
      [branchId]
    );
    
    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    const brandId = branchResult.rows[0].brand_id;
    
    if (!brandId) {
      return res.status(400).json({ error: 'Bu şube herhangi bir markaya ait değil' });
    }
    
    // Markanın tema ayarlarını al
    const brandThemeResult = await client.query(
      'SELECT theme_settings FROM brands WHERE id = $1',
      [brandId]
    );
    
    if (brandThemeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    const brandThemeSettings = brandThemeResult.rows[0].theme_settings;
    
    if (!brandThemeSettings) {
      return res.status(400).json({ error: 'Markaya ait tema ayarları bulunamadı' });
    }
    
    // Şubenin mevcut tema ayarlarını kaydet (log için)
    const currentSettings = await client.query(
      'SELECT theme_settings FROM branches WHERE id = $1',
      [branchId]
    );
    
    // Tema ayarlarını şubeye uygula
    await client.query(
      'UPDATE branches SET theme_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [brandThemeSettings, branchId]
    );
    
    // Tema değişiklik logu ekle
    await client.query(`
      INSERT INTO theme_change_logs 
      (branch_id, changed_by, old_settings, new_settings, change_source)
      VALUES ($1, $2, $3, $4, 'brand_default_applied')
    `, [branchId, req.user.id, currentSettings.rows[0].theme_settings, brandThemeSettings]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Marka varsayılan tema ayarları şubeye başarıyla uygulandı',
      branch_id: branchId,
      brand_id: brandId
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marka varsayılan ayarları şubeye uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları uygulanamadı', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;