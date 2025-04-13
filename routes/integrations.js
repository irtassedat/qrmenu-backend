const express = require('express');
const router = express.Router();
const db = require('../db');


// ...

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