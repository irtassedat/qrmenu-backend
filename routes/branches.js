const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ GET /api/branches → Tüm şubeleri getir
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM branches ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Şubeler alınırken hata:', err.message);
    res.status(500).json({ error: 'Şubeler getirilemedi' });
  }
});

// ✅ GET /api/branches/:id/products → Şubeye özel ürünleri getir
router.get('/:id/products', async (req, res) => {
  const branchId = req.params.id;

  try {
    const result = await db.query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      INNER JOIN branch_products bp ON p.id = bp.product_id
      WHERE bp.branch_id = $1
        AND bp.is_visible = true
        AND (
          p.is_deleted = false
          OR (p.is_deleted = true AND c.name = 'Çaylar')
        )
      ORDER BY c.name, p.name
    `, [branchId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Şube ürünleri alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube ürünleri getirilemedi' });
  }
});

// ✅ PATCH /api/branches/:branch_id/products/:product_id → Şubedeki ürün bilgisini güncelle
router.patch('/:branch_id/products/:product_id', async (req, res) => {
  const { branch_id, product_id } = req.params;
  const { is_visible, stock_count } = req.body;

  try {
    const existing = await db.query(
      'SELECT * FROM branch_products WHERE branch_id = $1 AND product_id = $2',
      [branch_id, product_id]
    );

    if (existing.rows.length > 0) {
      // Güncelle
      const updated = await db.query(
        `UPDATE branch_products
         SET is_visible = COALESCE($1, is_visible),
             stock_count = COALESCE($2, stock_count)
         WHERE branch_id = $3 AND product_id = $4
         RETURNING *`,
        [is_visible, stock_count, branch_id, product_id]
      );
      res.json(updated.rows[0]);
    } else {
      // Yeni kayıt oluştur
      const inserted = await db.query(
        `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [branch_id, product_id, is_visible ?? true, stock_count ?? 0]
      );
      res.json(inserted.rows[0]);
    }
  } catch (err) {
    console.error('Ürün görünürlüğü/stok güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Güncelleme başarısız' });
  }
});

module.exports = router;
