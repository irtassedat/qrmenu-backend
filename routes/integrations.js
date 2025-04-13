const express = require('express');
const router = express.Router();
const db = require('../db');


// ...
router.get('/', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM integration_templates ORDER BY name ASC');
      res.json(result.rows);
    } catch (err) {
      console.error('Entegrasyonlar yüklenirken hata:', err.message);
      res.status(500).json({ error: 'Entegrasyonlar yüklenemedi' });
    }
  });
  
  // POST /api/integrations - Yeni entegrasyon ekle
  router.post('/', async (req, res) => {
    try {
      const { name, type, description, is_active, config } = req.body;
      
      // Temel doğrulama
      if (!name || !type) {
        return res.status(400).json({ error: 'Entegrasyon adı ve tipi zorunludur' });
      }
      
      // Entegrasyonu ekle
      const result = await db.query(`
        INSERT INTO integration_templates (name, type, description, is_active, config)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        name,
        type,
        description || null,
        is_active !== false, // undefined ise true kabul et
        config ? JSON.stringify(config) : '{}'
      ]);
      
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error('Entegrasyon eklenirken hata:', err.message);
      res.status(500).json({ error: 'Entegrasyon eklenemedi' });
    }
  });
  
  // PUT /api/integrations/:id - Entegrasyonu güncelle
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, type, description, is_active, config } = req.body;
      
      // Temel doğrulama
      if (!name || !type) {
        return res.status(400).json({ error: 'Entegrasyon adı ve tipi zorunludur' });
      }
      
      // Entegrasyonu güncelle
      const result = await db.query(`
        UPDATE integration_templates 
        SET name = $1, type = $2, description = $3, is_active = $4, config = $5, updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
      `, [
        name,
        type,
        description || null,
        is_active !== false, // undefined ise true kabul et
        config ? JSON.stringify(config) : '{}',
        id
      ]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Entegrasyon bulunamadı' });
      }
      
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Entegrasyon güncellenirken hata:', err.message);
      res.status(500).json({ error: 'Entegrasyon güncellenemedi' });
    }
  });
  
  // DELETE /api/integrations/:id - Entegrasyonu sil
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // Entegrasyonu sil
      await db.query('DELETE FROM integration_templates WHERE id = $1', [id]);
      
      res.json({ message: 'Entegrasyon başarıyla silindi' });
    } catch (err) {
      console.error('Entegrasyon silinirken hata:', err.message);
      res.status(500).json({ error: 'Entegrasyon silinemedi' });
    }
  });

// POST /api/branches/:id/integrations - Şubeye entegrasyon ekle/güncelle
router.post('/:id/integrations', async (req, res) => {
  try {
    const { id } = req.params;
    const { integration_ids } = req.body;
    
    // Şubenin var olup olmadığını kontrol et
    const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [id]);
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    // Tüm entegrasyonları kaldır
    await db.query('DELETE FROM branch_integrations WHERE branch_id = $1', [id]);
    
    // Yeni entegrasyonları ekle
    if (Array.isArray(integration_ids) && integration_ids.length > 0) {
      // Toplu ekleme için SQL hazırla
      const values = integration_ids.map((integration_id, index) => 
        `($1, $${index + 2}, true, '{}'::jsonb)`
      ).join(', ');
      
      const queryParams = [id, ...integration_ids];
      
      await db.query(`
        INSERT INTO branch_integrations (branch_id, integration_id, is_active, config)
        VALUES ${values}
      `, queryParams);
    }
    
    // Güncel entegrasyonları getir
    const result = await db.query(`
      SELECT i.*, bi.is_active, bi.config
      FROM integration_templates i
      JOIN branch_integrations bi ON i.id = bi.integration_id
      WHERE bi.branch_id = $1
    `, [id]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Şube entegrasyonları güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Entegrasyonlar güncellenemedi' });
  }
});

module.exports = router;