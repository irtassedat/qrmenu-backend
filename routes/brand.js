// routes/brands.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/brands - Tüm markaları getir
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM brands ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Markalar yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Markalar yüklenemedi' });
    }
});

// GET /api/brands/:id - Marka detaylarını getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM brands WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Marka detayları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Marka detayları yüklenemedi' });
    }
});

// POST /api/brands - Yeni marka ekle
router.post('/', async (req, res) => {
    try {
        const { name, logo_url, contact_email, contact_phone, address, description, is_active } = req.body;

        // Temel doğrulama
        if (!name) {
            return res.status(400).json({ error: 'Marka adı zorunludur' });
        }

        // Markayı ekle
        const result = await db.query(`
      INSERT INTO brands (name, logo_url, contact_email, contact_phone, address, description, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
            name,
            logo_url || null,
            contact_email || null,
            contact_phone || null,
            address || null,
            description || null,
            is_active !== false // undefined ise true kabul et
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Marka eklenirken hata:', err.message);
        res.status(500).json({ error: 'Marka eklenemedi' });
    }
});

// routes/brands.js - ana rota düzenlemeleri
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, logo_url, contact_email, contact_phone, address, description, is_active } = req.body;

        // Markayı güncelle
        const result = await db.query(`
        UPDATE brands 
        SET name = $1, logo_url = $2, contact_email = $3, contact_phone = $4, 
            address = $5, description = $6, is_active = $7, updated_at = CURRENT_TIMESTAMP
        WHERE id = $8
        RETURNING *
      `, [
            name, logo_url || null, contact_email || null, contact_phone || null,
            address || null, description || null, is_active !== false, id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Marka güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Marka güncellenemedi' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Markayı sil
        await db.query('DELETE FROM brands WHERE id = $1', [id]);

        res.json({ message: 'Marka başarıyla silindi' });
    } catch (err) {
        console.error('Marka silinirken hata:', err.message);
        res.status(500).json({ error: 'Marka silinemedi' });
    }
});

// GET /api/brands/:id/branches - Markaya ait şubeleri getir
router.get('/:id/branches', async (req, res) => {
    try {
        const { id } = req.params;

        // Önce markanın varlığını kontrol et
        const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [id]);
        if (brandCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        // Şubeleri getir
        const result = await db.query(`
      SELECT b.*, m.name as menu_template_name, p.name as price_template_name
      FROM branches b
      LEFT JOIN menu_templates m ON b.menu_template_id = m.id
      LEFT JOIN price_templates p ON b.price_template_id = p.id
      WHERE b.brand_id = $1
      ORDER BY b.name ASC
    `, [id]);

        res.json(result.rows);
    } catch (err) {
        console.error('Markaya ait şubeler yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Şubeler yüklenemedi' });
    }
});

module.exports = router;