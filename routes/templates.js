const express = require('express');
const router = express.Router();
const db = require('../db');


router.get('/:id/products', async (req, res) => {
    const branchId = req.params.id;
    const { menu_template_id, price_template_id } = req.query;

    try {
        // Şubenin varlığını kontrol et
        const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [branchId]);
        if (branchCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Şube bulunamadı' });
        }

        // Şubenin ürünlerini ve şablona göre fiyatlarını getir
        let query = `
        SELECT p.*, c.name as category_name, bp.stock_count, 
               COALESCE(pt.price, p.price) as price,
               bp.is_visible
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $1
      `;

        const queryParams = [branchId];

        // Fiyat şablonu belirtilmişse
        if (price_template_id) {
            query += `
          LEFT JOIN price_template_products pt 
          ON p.id = pt.product_id AND pt.price_template_id = $2
        `;
            queryParams.push(price_template_id);
        }

        // Menü şablonu belirtilmişse
        if (menu_template_id) {
            query += `
          JOIN menu_template_products mt 
          ON p.id = mt.product_id AND mt.menu_template_id = $${queryParams.length + 1}
        `;
            queryParams.push(menu_template_id);
        } else {
            query += `
          WHERE bp.branch_id = $1 
          AND bp.is_visible = true 
          AND p.is_deleted = false
        `;
        }

        query += `
        ORDER BY c.name, p.name
      `;

        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Şube ürünleri alınırken hata:', err.message);
        res.status(500).json({ error: 'Şube ürünleri getirilemedi' });
    }
});

// GET /api/templates/menu - Menü şablonlarını getir
router.get('/menu', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM menu_templates ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Menü şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonları yüklenemedi' });
    }
});

// POST /api/templates/menu - Yeni menü şablonu ekle
router.post('/menu', async (req, res) => {
    try {
        const { name, description, is_active } = req.body;

        // Temel doğrulama
        if (!name) {
            return res.status(400).json({ error: 'Şablon adı zorunludur' });
        }

        // Şablonu ekle
        const result = await db.query(`
      INSERT INTO menu_templates (name, description, is_active)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [
            name,
            description || null,
            is_active !== false // undefined ise true kabul et
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonu eklenemedi' });
    }
});

// ... Benzer şekilde diğer şablon endpoint'leri (menu, price, integration)

// PATCH /api/branches/:id/templates - Şube şablonlarını güncelle
router.patch('/branches/:id/templates', async (req, res) => {
    try {
        const { id } = req.params;
        const { menu_template_id, price_template_id } = req.body;

        // Şubenin var olup olmadığını kontrol et
        const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [id]);
        if (branchCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Şube bulunamadı' });
        }

        // Şablonları güncelle
        const result = await db.query(`
      UPDATE branches 
      SET menu_template_id = $1, price_template_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [
            menu_template_id || null,
            price_template_id || null,
            id
        ]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Şube şablonları güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablonlar güncellenemedi' });
    }
});

module.exports = router;