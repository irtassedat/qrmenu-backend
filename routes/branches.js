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

// POST /api/branches → Yeni şube ekle 
router.post('/', async (req, res) => {
  try {
    const { name, address, phone, email, manager_name, opening_hours, description, is_active } = req.body;

    // Temel doğrulama
    if (!name || !address) {
      return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
    }

    // Yeni şubeyi veritabanına ekle
    const result = await db.query(`
      INSERT INTO branches (
        name, address, phone, email, manager_name, opening_hours, description, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      name,
      address,
      phone || null,
      email || null,
      manager_name || null,
      opening_hours || null,
      description || null,
      is_active !== false // undefined ise true kabul et
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Şube eklenirken hata:', err.message);
    res.status(500).json({ error: 'Şube eklenemedi', details: err.message });
  }
});

// PUT /api/branches/:id → Şube bilgilerini güncelle
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id } = req.body;

    // Temel doğrulama
    if (!name || !address) {
      return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
    }

    //Şubenin mevcut olup olmadığı
    const checkResult = await db.query('SELECT id FROM branches WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Şubeyi güncelle - brand_id parametresi eklendi
    const result = await db.query(`
      UPDATE branches SET 
        name = $1, 
        address = $2, 
        phone = $3, 
        email = $4, 
        manager_name = $5, 
        opening_hours = $6, 
        description = $7, 
        is_active = $8,
        brand_id = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [
      name,
      address,
      phone || null,
      email || null,
      manager_name || null,
      opening_hours || null,
      description || null,
      is_active !== false, // undefined ise true kabul et
      brand_id || null,    // brand_id parametresi eklendi
      id
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Şube güncellenemedi', details: err.message });
  }
});

// DELETE /api/branches/:id → Şubeyi sil
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await db.query('SELECT id FROM branches WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Şubeyi sil
    await db.query('DELETE FROM branches WHERE id = $1', [id]);

    res.json({ message: 'Şube başarıyla silindi' });
  } catch (err) {
    console.error('Şube silinirken hata:', err.message);
    res.status(500).json({ error: 'Şube silinemedi', details: err.message });
  }
});

// POST /api/branches/update-brand - Özel bir şubenin marka bilgisini güncelle
router.post('/update-brand', async (req, res) => {
  try {
    const { branch_id, brand_id } = req.body;

    if (!branch_id || !brand_id) {
      return res.status(400).json({ error: 'Şube ID ve Marka ID zorunludur' });
    }

    // Şubenin var olup olmadığını kontrol et
    const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [branch_id]);
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Markanın var olup olmadığını kontrol et
    const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [brand_id]);
    if (brandCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }

    // Şubenin markasını güncelle
    const result = await db.query(`
      UPDATE branches SET 
        brand_id = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [brand_id, branch_id]);

    res.json({
      success: true,
      message: 'Şube markası başarıyla güncellendi',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Şube markası güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Şube markası güncellenemedi', details: err.message });
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

router.patch("/branch-product", async (req, res) => {
  const { branch_id, product_id, is_visible, stock_count } = req.body;

  // Middleware'de gerekli kontrolleri yaptıktan sonra...
  try {
    console.log('Gelen PATCH isteği verisi:', req.body); // Debug amaçlı

    // Branch-product kaydını kontrol et
    const checkQuery = await db.query(
      "SELECT * FROM branch_products WHERE branch_id = $1 AND product_id = $2",
      [branch_id, product_id]
    );

    let result;
    if (checkQuery.rows.length > 0) {
      // Mevcut kaydı güncelle - is_visible ve stock_count değerlerini ayrı ayrı işle
      let query = `UPDATE branch_products SET updated_at = CURRENT_TIMESTAMP`;
      const values = [];
      let paramCounter = 1;

      // is_visible parametresi belirtilmişse
      if (is_visible !== undefined) {
        query += `, is_visible = $${paramCounter}`;
        values.push(is_visible);
        paramCounter++;
      }

      // stock_count parametresi belirtilmişse
      if (stock_count !== undefined) {
        query += `, stock_count = $${paramCounter}`;
        values.push(stock_count);
        paramCounter++;
      }

      query += ` WHERE branch_id = $${paramCounter} AND product_id = $${paramCounter + 1} RETURNING *`;
      values.push(branch_id, product_id);

      console.log('Çalıştırılacak sorgu:', query, values); // Debug amaçlı
      result = await db.query(query, values);
    } else {
      // Yeni bir kayıt oluştur
      result = await db.query(
        `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count) 
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [branch_id, product_id, is_visible !== undefined ? is_visible : true, stock_count !== undefined ? stock_count : 0]
      );
    }

    // Başarılı yanıt
    res.json({
      success: true,
      message: "Ürün durumu başarıyla güncellendi",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("Branch-product güncelleme hatası:", err);
    res.status(500).json({
      success: false,
      error: "Ürün durumu güncellenemedi",
      details: err.message
    });
  }
});

// GET /api/branches/:id/menu → Şubeye özel QR menü için ürünleri getir
router.get('/:id/menu', async (req, res) => {
  const branchId = req.params.id;

  try {
    // Önce şubenin mevcut olup olmadığını kontrol edelim
    const branchCheck = await db.query('SELECT id, name FROM branches WHERE id = $1', [branchId]);
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Şube için görünür ürünleri ve kategorileri getir
    const result = await db.query(`
      SELECT p.*, c.name as category_name, bp.stock_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      INNER JOIN branch_products bp ON p.id = bp.product_id
      WHERE bp.branch_id = $1
        AND bp.is_visible = true
        AND p.is_deleted = false
      ORDER BY c.name, p.name
    `, [branchId]);

    res.json({
      branch: branchCheck.rows[0],
      products: result.rows
    });
  } catch (err) {
    console.error('Şube menüsü alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube menüsü getirilemedi' });
  }
});

module.exports = router;
