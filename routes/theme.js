// routes/theme.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

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
    
    if (type === 'branch' && req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(id)) {
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
      RETURNING theme_settings
    `, [settings, id]);
    
    // Değişiklik logunu kaydet
    await client.query(`
      INSERT INTO theme_change_logs 
      (${type}_id, changed_by, old_settings, new_settings)
      VALUES ($1, $2, $3, $4)
    `, [id, req.user.id, oldSettings, settings]);
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Tema ayarları güncellendi',
      settings: updateResult.rows[0].theme_settings
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tema ayarları güncellenirken hata:', err);
    res.status(500).json({ error: 'Tema ayarları güncellenemedi' });
  } finally {
    client.release();
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

module.exports = router;