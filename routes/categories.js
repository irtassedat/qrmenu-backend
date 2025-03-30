const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ GET /api/categories → Tüm kategorileri getir
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Kategoriler alınırken hata:', err.message);
    res.status(500).json({ error: 'Kategoriler getirilemedi' });
  }
});

// ✅ POST /api/categories → Yeni kategori ekle
router.post('/', async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Kategori adı zorunludur' });
  }

  try {
    const result = await db.query(
      `INSERT INTO categories (name) VALUES ($1) RETURNING *`,
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Kategori eklenirken hata:', err.message);
    res.status(500).json({ error: 'Kategori eklenemedi' });
  }
});

module.exports = router;
