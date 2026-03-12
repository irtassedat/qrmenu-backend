// routes/products.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// GET /api/products -> Get all products (brand isolated)
router.get('/', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { role, brand_id: userBrandId } = req.user;

    let query = 'SELECT * FROM products WHERE is_deleted = false';
    let queryParams = [];

    // Brand manager and branch manager only see their brand's products
    if (role !== 'super_admin') {
      query += ' AND brand_id = $1';
      queryParams.push(userBrandId);
    }

    query += ' ORDER BY name ASC';

    const result = await db.query(query, queryParams);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching products:', err.message);
    res.status(500).json({ error: 'Failed to fetch products' });
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

// ✅ POST /api/products → Yeni ürün ekle (otomatik brand_id atama)
router.post('/', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { name, description, image_url, price, category_id, info_tags, brand_id } = req.body;
  const { role, brand_id: userBrandId } = req.user;

  if (!name || !price || !category_id) {
    return res.status(400).json({ error: 'Zorunlu alanlar eksik' });
  }

  try {
    // Brand ID kontrolü
    let targetBrandId;
    if (role === 'super_admin') {
      targetBrandId = brand_id || null; // Super admin brand seçebilir
    } else {
      targetBrandId = userBrandId; // Brand manager sadece kendi markası
    }

    // Kategori-marka uyumluluğu kontrolü
    const categoryResult = await db.query(
      'SELECT id, brand_id FROM categories WHERE id = $1 LIMIT 1',
      [category_id]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ error: 'Geçersiz kategori seçimi' });
    }

    const categoryBrandId = categoryResult.rows[0].brand_id;

    if (!categoryBrandId) {
      return res.status(400).json({ error: 'Seçilen kategori bir markaya bağlı değil. Lütfen marka kategorisi kullanın.' });
    }

    if (targetBrandId === null && role === 'super_admin') {
      targetBrandId = categoryBrandId;
    }

    if (Number(targetBrandId) !== Number(categoryBrandId)) {
      return res.status(400).json({ error: 'Seçilen kategori, ürün markası ile eşleşmiyor' });
    }

    // 1. Ürünü ekle (brand_id ile)
    const result = await db.query(
      `INSERT INTO products (name, description, image_url, price, category_id, info_tags, brand_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, description, image_url, price, category_id, JSON.stringify(info_tags || {}), targetBrandId]
    );

    // 2. İlgili markanın şubelerine otomatik tanımla
    let branches;
    if (targetBrandId) {
      branches = await db.query('SELECT id FROM branches WHERE brand_id = $1', [targetBrandId]);
    } else {
      branches = await db.query('SELECT id FROM branches');
    }

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

// ✅ DELETE /api/products/:id → Ürünü soft delete yap (rol bazlı erişim)
router.delete("/:id", authorize(['super_admin', 'brand_manager']), async (req, res) => {
  const { id } = req.params
  const { role, brand_id: userBrandId } = req.user

  try {
    // Önce ürünün brand_id'sini ve brand erişimini kontrol et
    const productCheck = await db.query(
      `
      SELECT
        p.id,
        p.brand_id,
        EXISTS (
          SELECT 1
          FROM branches b
          WHERE b.brand_id = $2
            AND (
              EXISTS (
                SELECT 1
                FROM branch_products bp
                WHERE bp.branch_id = b.id
                  AND bp.product_id = p.id
              )
              OR (
                b.menu_template_id IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM menu_template_products mtp
                  WHERE mtp.menu_template_id = b.menu_template_id
                    AND mtp.product_id = p.id
                )
              )
            )
        ) AS has_brand_access
      FROM products p
      WHERE p.id = $1
        AND p.is_deleted = false
      `,
      [id, userBrandId]
    )

    if (productCheck.rows.length === 0) {
      return res.status(404).json({ error: "Ürün bulunamadı veya zaten silinmiş" })
    }

    // Brand manager:
    // 1) kendi markasının ürününü silebilir
    // 2) brand_id NULL ise ama kendi markasıyla ilişkiliyse silebilir
    if (role === 'brand_manager') {
      const productBrandId = productCheck.rows[0].brand_id
      const hasBrandAccess = productCheck.rows[0].has_brand_access
      const canDeleteOwnBrandProduct = productBrandId === userBrandId
      const canDeleteUnassignedProduct = productBrandId === null && hasBrandAccess

      if (!canDeleteOwnBrandProduct && !canDeleteUnassignedProduct) {
        return res.status(403).json({ error: "Bu ürünü silme yetkiniz yok" })
      }
    }

    const result = await db.query(
      `UPDATE products
       SET is_deleted = true
       WHERE id = $1 AND is_deleted = false
       RETURNING *`,
      [id]
    )

    res.json({ message: "Ürün başarıyla silindi" })
  } catch (err) {
    console.error("Ürün silinirken hata:", err)
    res.status(500).json({ error: "Ürün silinemedi" })
  }
})

// ✅ PUT /api/products/:id → Ürünü güncelle (Super Admin, Brand Manager ve Branch Manager)
router.put("/:id", authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { id } = req.params
  const { name, description, image_url, price, category_id, info_tags } = req.body
  
  console.log(`=== PRODUCT UPDATE DEBUG ===`);
  console.log(`Product ID: ${id}`);
  console.log(`Request body:`, req.body);
  console.log(`Info Tags received:`, info_tags);
  console.log(`Info Tags JSON:`, JSON.stringify(info_tags || {}));
  console.log(`==============================`);

  try {
    let fallbackBrandId = null;

    // Brand manager ve branch manager için detaylı erişim kontrolü
    if (req.user.role === 'brand_manager') {
      const accessCheck = await db.query(
        `
        SELECT
          p.brand_id,
          EXISTS (
            SELECT 1
            FROM branches b
            WHERE b.brand_id = $2
              AND (
                EXISTS (
                  SELECT 1
                  FROM branch_products bp
                  WHERE bp.branch_id = b.id
                    AND bp.product_id = p.id
                )
                OR (
                  b.menu_template_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM menu_template_products mtp
                    WHERE mtp.menu_template_id = b.menu_template_id
                      AND mtp.product_id = p.id
                  )
                )
              )
          ) AS has_brand_access
        FROM products p
        WHERE p.id = $1
          AND p.is_deleted = false
        `,
        [id, req.user.brand_id]
      );

      if (accessCheck.rowCount === 0) {
        return res.status(404).json({ error: "Ürün bulunamadı" });
      }

      const { brand_id: productBrandId, has_brand_access: hasBrandAccess } = accessCheck.rows[0];
      const canEditOwnBrandProduct = productBrandId === req.user.brand_id;
      const canClaimUnassignedProduct = productBrandId === null && hasBrandAccess;

      if (!canEditOwnBrandProduct && !canClaimUnassignedProduct) {
        return res.status(403).json({ error: "Bu ürünü düzenleme yetkiniz yok" });
      }

      if (canClaimUnassignedProduct) {
        fallbackBrandId = req.user.brand_id;
      }
    }

    if (req.user.role === 'branch_manager') {
      const accessCheck = await db.query(
        `
        SELECT
          p.brand_id,
          b.brand_id AS branch_brand_id,
          EXISTS (
            SELECT 1
            FROM branch_products bp
            WHERE bp.branch_id = b.id
              AND bp.product_id = p.id
          ) AS in_branch_products,
          (
            b.menu_template_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM menu_template_products mtp
              WHERE mtp.menu_template_id = b.menu_template_id
                AND mtp.product_id = p.id
            )
          ) AS in_branch_template
        FROM products p
        JOIN branches b ON b.id = $2
        WHERE p.id = $1
          AND p.is_deleted = false
        `,
        [id, req.user.branch_id]
      );

      if (accessCheck.rowCount === 0) {
        return res.status(404).json({ error: "Ürün bulunamadı veya şube bulunamadı" });
      }

      const {
        brand_id: productBrandId,
        branch_brand_id: branchBrandId,
        in_branch_products: inBranchProducts,
        in_branch_template: inBranchTemplate
      } = accessCheck.rows[0];

      const hasBranchAccess = inBranchProducts || inBranchTemplate;
      const hasBrandConflict = productBrandId !== null && productBrandId !== branchBrandId;

      if (!hasBranchAccess || hasBrandConflict) {
        return res.status(403).json({ error: "Bu ürünü düzenleme yetkiniz yok" });
      }

      if (productBrandId === null) {
        fallbackBrandId = branchBrandId;
      }
    }

    const result = await db.query(
      `UPDATE products
       SET name = $1,
           description = $2,
           image_url = $3,
           price = $4,
           category_id = $5,
           info_tags = $6,
           brand_id = COALESCE(brand_id, $8)
       WHERE id = $7
       RETURNING *`,
      [name, description, image_url, price, category_id, JSON.stringify(info_tags || {}), id, fallbackBrandId]
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
router.get("/branch/:branch_id", authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { branch_id } = req.params;

  if (!branch_id) {
    return res.status(400).json({ error: "Şube ID'si gerekli" });
  }

  try {
    // Önce şube bilgilerini alalım
    const branchCheck = await db.query(
      "SELECT id, brand_id, menu_template_id, price_template_id FROM branches WHERE id = $1",
      [branch_id]
    );

    if (branchCheck.rowCount === 0) {
      return res.status(404).json({ error: "Şube bulunamadı" });
    }

    const branch = branchCheck.rows[0];
    const isSuperAdmin = req.user.role === 'super_admin';

    if (req.user.role === 'brand_manager' && branch.brand_id !== req.user.brand_id) {
      return res.status(403).json({ error: "Bu şubeye erişim yetkiniz yok" });
    }

    if (req.user.role === 'branch_manager' && branch.id !== req.user.branch_id) {
      return res.status(403).json({ error: "Bu şubeye erişim yetkiniz yok" });
    }

    let result;

    // Eğer şubenin bir menü şablonu varsa, o şablondaki ürünleri getir
    if (branch.menu_template_id) {
      console.log(`Şube ${branch_id} menü şablonu ID: ${branch.menu_template_id} kullanıyor`);

      const menuQuery = `
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
          ${isSuperAdmin ? '' : 'AND p.brand_id = $3'}
        ORDER BY c.name, p.name
      `;
      const menuParams = isSuperAdmin
        ? [branch_id, branch.menu_template_id]
        : [branch_id, branch.menu_template_id, branch.brand_id];

      result = await db.query(menuQuery, menuParams);
    } else {
      // Şubenin menü şablonu yoksa, branch_products tablosundaki ürünleri getir
      console.log(`Şube ${branch_id} menü şablonu kullanmıyor, branch_products tablosundan ürünleri getiriyorum`);

      const branchQuery = `
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
          ${isSuperAdmin ? '' : 'AND p.brand_id = $2'}
        ORDER BY c.name, p.name
      `;
      const branchParams = isSuperAdmin
        ? [branch_id]
        : [branch_id, branch.brand_id];

      result = await db.query(branchQuery, branchParams);
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Şube ürünleri alınamadı:", err.message);
    res.status(500).json({ error: "Ürünler alınamadı" });
  }
});

// ✅ PATCH /api/products/branch-product → Update product visibility and stock for a branch
router.patch("/branch-product", authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
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

// POST /api/products/bulk → Toplu ürün ekle (brand isolated)
router.post('/bulk', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { products, branchId, brand_id } = req.body;
    const { role, brand_id: userBrandId } = req.user;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Geçersiz veri formatı - products array olmalı" });
    }

    // Brand ID kontrolü - super_admin brand seçebilir, brand_manager sadece kendi markası
    let targetBrandId;
    if (role === 'super_admin') {
      targetBrandId = brand_id || null;
    } else {
      targetBrandId = userBrandId; // Brand manager sadece kendi markasına ekleyebilir
    }

    console.log(`📥 Bulk import başladı - ${products.length} ürün, branchId: ${branchId}, brand_id: ${targetBrandId}`);

    // İşlem sonuçları için sayaçlar
    const results = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };

    // Şube template bilgisini al (eğer branchId varsa)
    let menuTemplateId = null;
    let priceTemplateId = null;
    if (branchId) {
      const branchCheck = await db.query(
        'SELECT menu_template_id, price_template_id FROM branches WHERE id = $1',
        [branchId]
      );
      if (branchCheck.rows.length > 0) {
        menuTemplateId = branchCheck.rows[0].menu_template_id;
        priceTemplateId = branchCheck.rows[0].price_template_id;
        console.log(`📋 Şube menu_template_id: ${menuTemplateId}, price_template_id: ${priceTemplateId}`);
      }
    }

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
              console.log(`✅ Yeni kategori oluşturuldu: ${item.Kategori} (ID: ${categoryId})`);
            }
          }

          if (!item.Ürün || !categoryId) {
            console.log(`⏭️  Atlanan ürün: ${item.Ürün || 'İsimsiz'} - Kategori: ${item.Kategori || 'Yok'}`);
            results.skipped++;
            continue;
          }

          // Info tags oluştur (Excel kolonlarından)
          const infoTags = {
            glutensiz: item.Glutensiz === 'true' || item.Glutensiz === true || item.Glutensiz === 1,
            sutsuz: item.Sütsüz === 'true' || item.Sütsüz === true || item.Sütsüz === 1,
            vejetaryen: item.Vejetaryen === 'true' || item.Vejetaryen === true || item.Vejetaryen === 1,
            organik: item.Organik === 'true' || item.Organik === true || item.Organik === 1
          };

          // Ürünün zaten var olup olmadığını kontrol et
          const productCheck = await client.query(
            "SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND is_deleted = false",
            [item.Ürün]
          );

          let productId;
          if (productCheck.rows.length > 0) {
            // Ürün zaten varsa güncelle
            productId = productCheck.rows[0].id;
            await client.query(
              `UPDATE products
               SET price = $1, description = $2, image_url = $3, category_id = $4, info_tags = $5, updated_at = CURRENT_TIMESTAMP
               WHERE id = $6`,
              [
                parseFloat(item.Fiyat) || 0,
                item.Açıklama || '',
                item.Görsel || '',
                categoryId,
                JSON.stringify(infoTags),
                productId
              ]
            );
            console.log(`🔄 Ürün güncellendi: ${item.Ürün} (ID: ${productId})`);
            results.updated++;
          } else {
            // Yeni ürün ekle (brand_id ile)
            const result = await client.query(
              `INSERT INTO products (name, description, price, image_url, category_id, info_tags, brand_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id`,
              [
                item.Ürün,
                item.Açıklama || '',
                parseFloat(item.Fiyat) || 0,
                item.Görsel || '',
                categoryId,
                JSON.stringify(infoTags),
                targetBrandId
              ]
            );
            productId = result.rows[0].id;
            console.log(`➕ Yeni ürün eklendi: ${item.Ürün} (ID: ${productId}, brand_id: ${targetBrandId})`);
            results.inserted++;
          }

          // Şube ürün ilişkisini güncelle (eğer şube ID'si belirtilmişse)
          if (branchId) {
            await client.query(
              `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (branch_id, product_id)
               DO UPDATE SET is_visible = $3, stock_count = $4, updated_at = CURRENT_TIMESTAMP`,
              [
                branchId,
                productId,
                true, // Varsayılan olarak görünür
                parseInt(item.Stok) || 0
              ]
            );
          }

          // Menu Template'e otomatik ekleme (eğer şube bir template kullanıyorsa)
          if (menuTemplateId) {
            await client.query(
              `INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, price)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (menu_template_id, product_id)
               DO UPDATE SET is_visible = true, price = $4, updated_at = CURRENT_TIMESTAMP`,
              [
                menuTemplateId,
                productId,
                true,
                parseFloat(item.Fiyat) || 0
              ]
            );
            console.log(`🔗 Ürün menu template'e eklendi: ${item.Ürün} -> Template ${menuTemplateId}, Fiyat: ${item.Fiyat}`);
          }

          // Price Template'e otomatik ekleme/güncelleme (eğer şube bir price template kullanıyorsa)
          if (priceTemplateId) {
            await client.query(
              `INSERT INTO price_template_products (price_template_id, product_id, price)
               VALUES ($1, $2, $3)
               ON CONFLICT (price_template_id, product_id)
               DO UPDATE SET price = $3, updated_at = CURRENT_TIMESTAMP`,
              [
                priceTemplateId,
                productId,
                parseFloat(item.Fiyat) || 0
              ]
            );
            console.log(`💰 Ürün price template'e eklendi: ${item.Ürün} -> Template ${priceTemplateId}, Fiyat: ${item.Fiyat}`);
          }
        } catch (err) {
          console.error(`❌ Ürün eklenirken hata (${item.Ürün}):`, err.message);
          results.errors++;
        }
      }

      await client.query('COMMIT');

      console.log(`✅ Bulk import tamamlandı - Eklenen: ${results.inserted}, Güncellenen: ${results.updated}, Atlanan: ${results.skipped}, Hata: ${results.errors}`);

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
    res.status(500).json({ error: "Sunucu hatası", details: err.message });
  }
});

module.exports = router;
