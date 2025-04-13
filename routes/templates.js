const express = require('express');
const router = express.Router();
const db = require('../db');

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

// GET /api/templates/price - Fiyat şablonlarını getir
router.get('/price', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM price_templates ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Fiyat şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonları yüklenemedi' });
    }
});

// POST /api/templates/price - Yeni fiyat şablonu ekle
router.post('/price', async (req, res) => {
    try {
        const { name, description, is_active, year } = req.body;

        // Temel doğrulama
        if (!name) {
            return res.status(400).json({ error: 'Şablon adı zorunludur' });
        }

        // Şablonu ekle
        const result = await db.query(`
            INSERT INTO price_templates (name, description, is_active, year)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [
            name,
            description || null,
            is_active !== false, // undefined ise true kabul et
            year || new Date().getFullYear()
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonu eklenemedi' });
    }
});

// PUT /api/templates/menu/:id - Menü şablonu güncelleme
router.put('/menu/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active } = req.body;
        
        // Şablonu güncelle
        const result = await db.query(`
            UPDATE menu_templates 
            SET name = $1, description = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [
            name,
            description || null,
            is_active !== false, // undefined ise true kabul et
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Şablon bulunamadı' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon güncellenemedi' });
    }
});

// PUT /api/templates/price/:id - Fiyat şablonu güncelleme
router.put('/price/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active, year } = req.body;
        
        // Şablonu güncelle
        const result = await db.query(`
            UPDATE price_templates 
            SET name = $1, description = $2, is_active = $3, year = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [
            name,
            description || null,
            is_active !== false, // undefined ise true kabul et
            year || new Date().getFullYear(),
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Şablon bulunamadı' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon güncellenemedi' });
    }
});

// DELETE /api/templates/menu/:id - Menü şablonu silme
router.delete('/menu/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.query('DELETE FROM menu_templates WHERE id = $1', [id]);
        
        res.json({ message: 'Menü şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Menü şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

// DELETE /api/templates/price/:id - Fiyat şablonu silme
router.delete('/price/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        await db.query('DELETE FROM price_templates WHERE id = $1', [id]);
        
        res.json({ message: 'Fiyat şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Fiyat şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

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