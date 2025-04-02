const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ GET /api/products → Veritabanından ürünleri getir
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        products.*, 
        categories.name AS category_name 
      FROM products
      LEFT JOIN categories ON products.category_id = categories.id
      WHERE products.is_deleted = false
      ORDER BY products.id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Ürünleri çekerken hata:', err.message);
    res.status(500).json({ error: 'Ürünler getirilemedi' });
  }
});

// ✅ POST /api/products → Yeni ürün ekle
router.post('/', async (req, res) => {
  const { name, description, image_url, price, category_id } = req.body;

  if (!name || !price || !category_id) {
    return res.status(400).json({ error: 'Zorunlu alanlar eksik' });
  }

  try {
    // 1. Ürünü ekle
    const result = await db.query(
      `INSERT INTO products (name, description, image_url, price, category_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description, image_url, price, category_id]
    );

    // 2. Tüm şubelere otomatik tanımla
    const branches = await db.query('SELECT id FROM branches');
    for (const branch of branches.rows) {
      await db.query(
        `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
         VALUES ($1, $2, true, 0)`,
        [branch.id, result.rows[0].id]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Ürün eklenirken hata:', err.message);
    res.status(500).json({ error: 'Ürün eklenemedi' });
  }
});

// ✅ DELETE /api/products/:id → Ürünü soft delete yap
router.delete("/:id", async (req, res) => {
  const { id } = req.params

  try {
    const result = await db.query(
      `UPDATE products 
       SET is_deleted = true 
       WHERE id = $1 AND is_deleted = false 
       RETURNING *`,
      [id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ürün bulunamadı veya zaten silinmiş" })
    }

    res.json({ message: "Ürün başarıyla silindi" })
  } catch (err) {
    console.error("Ürün silinirken hata:", err)
    res.status(500).json({ error: "Ürün silinemedi" })
  }
})

// ✅ PUT /api/products/:id → Ürünü güncelle
router.put("/:id", async (req, res) => {
  const { id } = req.params
  const { name, description, image_url, price, category_id } = req.body

  try {
    const result = await db.query(
      `UPDATE products SET name = $1, description = $2, image_url = $3, price = $4, category_id = $5 WHERE id = $6 RETURNING *`,
      [name, description, image_url, price, category_id, id]
    )

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ürün bulunamadı" })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error("Ürün güncellenemedi:", err.message)
    res.status(500).json({ error: "Bir hata oluştu" })
  }
})

// GET /api/products/branch/:branch_id → Get products for a specific branch
router.get("/branch/:branch_id", async (req, res) => {
  const { branch_id } = req.params;

  if (!branch_id) {
    return res.status(400).json({ error: "Şube ID'si gerekli" });
  }

  try {
    // First check if branch exists
    const branchCheck = await db.query(
      "SELECT id FROM branches WHERE id = $1",
      [branch_id]
    );

    if (branchCheck.rowCount === 0) {
      return res.status(404).json({ error: "Şube bulunamadı" });
    }

    const result = await db.query(`
      SELECT 
        p.*, 
        c.name AS category_name,
        COALESCE(bp.is_visible, true) as is_visible,
        COALESCE(bp.stock_count, 0) as stock_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = $1
      WHERE p.is_deleted = false
        AND (bp.is_visible IS NULL OR bp.is_visible = true)
      ORDER BY p.id
    `, [branch_id]);

    res.json(result.rows);
  } catch (err) {
    console.error("Şube ürünleri alınamadı:", err.message);
    res.status(500).json({ error: "Ürünler alınamadı" });
  }
});

// ✅ PATCH /api/products/branch-product → Update product visibility and stock for a branch
router.patch("/branch-product", async (req, res) => {
  const { branch_id, product_id, is_visible, stock_count } = req.body;

  // Validate required fields
  if (!branch_id || !product_id) {
    return res.status(400).json({ error: "Şube ve ürün ID gerekli" });
  }

  // Validate data types
  if (typeof is_visible !== 'boolean' && is_visible !== undefined) {
    return res.status(400).json({ error: "is_visible boolean olmalıdır" });
  }

  if (typeof stock_count !== 'number' && stock_count !== undefined) {
    return res.status(400).json({ error: "stock_count sayı olmalıdır" });
  }

  try {
    // Check if branch exists
    const branchCheck = await db.query(
      "SELECT id FROM branches WHERE id = $1",
      [branch_id]
    );

    if (branchCheck.rowCount === 0) {
      return res.status(404).json({ error: "Şube bulunamadı" });
    }

    // Check if product exists
    const productCheck = await db.query(
      "SELECT id FROM products WHERE id = $1",
      [product_id]
    );

    if (productCheck.rowCount === 0) {
      return res.status(404).json({ error: "Ürün bulunamadı" });
    }

    // Check if branch-product record exists
    const existing = await db.query(
      "SELECT * FROM branch_products WHERE branch_id = $1 AND product_id = $2",
      [branch_id, product_id]
    );

    let result;
    if (existing.rowCount > 0) {
      // Update existing record
      result = await db.query(
        `UPDATE branch_products 
         SET is_visible = COALESCE($1, is_visible),
             stock_count = COALESCE($2, stock_count),
             updated_at = CURRENT_TIMESTAMP
         WHERE branch_id = $3 AND product_id = $4
         RETURNING *`,
        [is_visible, stock_count, branch_id, product_id]
      );
    } else {
      // Insert new record
      result = await db.query(
        `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count) 
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [branch_id, product_id, is_visible ?? true, stock_count ?? 0]
      );
    }

    // Get the updated product with category information
    const updatedProduct = await db.query(`
      SELECT 
        p.*,
        c.name AS category_name,
        bp.is_visible,
        bp.stock_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = $1
      WHERE p.id = $2
    `, [branch_id, product_id]);

    res.json({
      message: "Güncelleme başarılı ✅",
      data: updatedProduct.rows[0]
    });
  } catch (err) {
    console.error("Güncelleme hatası:", err.message);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// POST /api/products/bulk → Toplu ürün ekle
router.post('/bulk', async (req, res) => {
  const { products } = req.body;

  if (!Array.isArray(products)) {
    return res.status(400).json({ error: "Geçersiz veri formatı" });
  }

  try {
    let insertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Get all branches once
    const branches = await db.query('SELECT id FROM branches');

    for (const item of products) {
      try {
        // Validate required fields
        if (!item.Ürün || !item.Fiyat || !item.Kategori) {
          skippedCount++;
          continue;
        }

        // Get category ID
        const categoryRes = await db.query(
          "SELECT id FROM categories WHERE name = $1", 
          [item.Kategori]
        );
        
        if (!categoryRes.rows[0]) {
          skippedCount++;
          continue;
        }

        const category_id = categoryRes.rows[0].id;

        // Insert product
        const result = await db.query(
          `INSERT INTO products (name, description, price, image_url, category_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            item.Ürün,
            item.Açıklama || '',
            parseFloat(item.Fiyat),
            item.Görsel || '',
            category_id
          ]
        );

        // Add to all branches
        for (const branch of branches.rows) {
          await db.query(
            `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
             VALUES ($1, $2, true, $3)`,
            [branch.id, result.rows[0].id, parseInt(item.Stok) || 0]
          );
        }

        insertedCount++;
      } catch (err) {
        console.error(`Ürün eklenirken hata (${item.Ürün}):`, err.message);
        errorCount++;
      }
    }

    res.json({ 
      message: "Toplu ürün ekleme tamamlandı",
      stats: {
        inserted: insertedCount,
        skipped: skippedCount,
        errors: errorCount
      }
    });
  } catch (err) {
    console.error("Toplu ürün ekleme hatası:", err.message);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

module.exports = router;
