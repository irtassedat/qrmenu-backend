// routes/branches.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/branches -> Get all branches
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM branches ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching branches:', err.message);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// GET /api/branches/:id/products -> Get branch-specific products
router.get('/:id/products', async (req, res) => {
  const branchId = req.params.id;

  // Validate branch ID - making sure it's a number
  if (!branchId || isNaN(parseInt(branchId))) {
    return res.status(400).json({ error: 'Invalid branch ID' });
  }

  try {
    // First check if branch exists
    const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [branchId]);

    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const result = await db.query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN branch_products bp ON p.id = bp.product_id
      WHERE bp.branch_id = $1
        AND bp.is_visible = true
        AND p.is_deleted = false
      ORDER BY c.name, p.name
    `, [branchId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching branch products:', err.message);
    res.status(500).json({ error: 'Failed to fetch branch products' });
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
    // Önce şube bilgilerini alalım
    const branchCheck = await db.query(
      "SELECT id, menu_template_id, price_template_id FROM branches WHERE id = $1",
      [branch_id]
    );

    if (branchCheck.rowCount === 0) {
      return res.status(404).json({ error: "Şube bulunamadı" });
    }

    const branch = branchCheck.rows[0];
    let result;

    // Eğer şubenin bir menü şablonu varsa, o şablondaki ürünleri getir
    if (branch.menu_template_id) {
      console.log(`Şube ${branch_id} menü şablonu ID: ${branch.menu_template_id} kullanıyor`);

      result = await db.query(`
        SELECT 
          p.*, 
          c.name AS category_name,
          COALESCE(bp.is_visible, true) as is_visible,
          COALESCE(bp.stock_count, 0) as stock_count
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        INNER JOIN menu_template_products mtp ON p.id = mtp.product_id 
        LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = $1
        WHERE mtp.menu_template_id = $2
          AND p.is_deleted = false
        ORDER BY c.name, p.name
      `, [branch_id, branch.menu_template_id]);
    } else {
      // Şubenin menü şablonu yoksa, branch_products tablosundaki ürünleri getir
      console.log(`Şube ${branch_id} menü şablonu kullanmıyor, branch_products tablosundan ürünleri getiriyorum`);

      result = await db.query(`
        SELECT 
          p.*, 
          c.name AS category_name,
          COALESCE(bp.is_visible, false) as is_visible,
          COALESCE(bp.stock_count, 0) as stock_count
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        INNER JOIN branch_products bp ON bp.product_id = p.id 
        WHERE bp.branch_id = $1
          AND p.is_deleted = false
        ORDER BY c.name, p.name
      `, [branch_id]);
    }

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
// Toplu ürün ekleme
router.post('/bulk', async (req, res) => {
  try {
    const { products, branchId } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Geçersiz veri formatı" });
    }

    // İşlem sonuçları için sayaçlar
    const results = {
      inserted: 0,
      skipped: 0,
      errors: 0
    };

    // Transaction başlat
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      for (const item of products) {
        try {
          // Kategori kontrolü
          let categoryId = null;
          if (item.Kategori) {
            const categoryRes = await client.query(
              "SELECT id FROM categories WHERE LOWER(name) = LOWER($1)",
              [item.Kategori]
            );

            if (categoryRes.rows.length > 0) {
              categoryId = categoryRes.rows[0].id;
            } else {
              // Yeni kategori oluştur
              const newCategory = await client.query(
                "INSERT INTO categories (name) VALUES ($1) RETURNING id",
                [item.Kategori]
              );
              categoryId = newCategory.rows[0].id;
            }
          }

          if (!item.Ürün || !categoryId) {
            results.skipped++;
            continue;
          }

          // Ürünün zaten var olup olmadığını kontrol et
          const productCheck = await client.query(
            "SELECT id FROM products WHERE LOWER(name) = LOWER($1)",
            [item.Ürün]
          );

          let productId;
          if (productCheck.rows.length > 0) {
            // Ürün zaten varsa güncelle
            productId = productCheck.rows[0].id;
            await client.query(
              `UPDATE products 
               SET price = $1, description = $2, image_url = $3, category_id = $4, updated_at = CURRENT_TIMESTAMP
               WHERE id = $5`,
              [
                parseFloat(item.Fiyat) || 0,
                item.Açıklama || '',
                item.Görsel || '',
                categoryId,
                productId
              ]
            );
          } else {
            // Yeni ürün ekle
            const result = await client.query(
              `INSERT INTO products (name, description, price, image_url, category_id)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [
                item.Ürün,
                item.Açıklama || '',
                parseFloat(item.Fiyat) || 0,
                item.Görsel || '',
                categoryId
              ]
            );
            productId = result.rows[0].id;
            results.inserted++;
          }

          // Şube ürün ilişkisini güncelle (eğer şube ID'si belirtilmişse)
          if (branchId) {
            await client.query(
              `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (branch_id, product_id) 
               DO UPDATE SET is_visible = $3, stock_count = $4`,
              [
                branchId,
                productId,
                true, // Varsayılan olarak görünür 
                parseInt(item.Stok) || 0
              ]
            );
          }
        } catch (err) {
          console.error(`Ürün eklenirken hata (${item.Ürün}):`, err.message);
          results.errors++;
        }
      }

      await client.query('COMMIT');

      res.json({
        message: "Toplu ürün ekleme tamamlandı",
        stats: results
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Toplu ürün ekleme hatası:", err.message);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

module.exports = router;
