const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// ✅ GET /api/branches → Tüm şubeleri getir
router.get('/', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM branches ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Şubeler alınırken hata:', err.message);
    res.status(500).json({ error: 'Şubeler getirilemedi' });
  }
});

// POST /api/branches → Yeni şube ekle 
router.post('/', authorize(['super_admin']), async (req, res) => {
  try {
    const { name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id } = req.body;

    // Temel doğrulama
    if (!name || !address) {
      return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
    }

    // Yeni şubeyi veritabanına ekle
    const result = await db.query(`
      INSERT INTO branches (
        name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      brand_id || null     // brand_id parametresi eklendi
    ]);

    // Şube oluşturulduktan sonra, markanın varsayılan tema ayarlarını şubeye uygulayın
    if (result.rows[0].brand_id) {
      try {
        // Markanın tema ayarlarını al
        const brandTheme = await db.query(
          'SELECT theme_settings FROM brands WHERE id = $1',
          [result.rows[0].brand_id]
        );

        if (brandTheme.rows.length > 0 && brandTheme.rows[0].theme_settings) {
          // Tema ayarlarını yeni şubeye uygula
          await db.query(
            'UPDATE branches SET theme_settings = $1 WHERE id = $2',
            [brandTheme.rows[0].theme_settings, result.rows[0].id]
          );

          console.log(`Marka ID ${result.rows[0].brand_id} tema ayarları yeni şube ID ${result.rows[0].id} için uygulandı`);
        }
      } catch (themeErr) {
        console.error("Marka tema ayarları yeni şubeye uygulanırken hata:", themeErr);
        // Tema ayarları uygulanamasa bile şube oluşturma işlemine devam et
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Şube eklenirken hata:', err.message);
    res.status(500).json({ error: 'Şube eklenemedi', details: err.message });
  }
});

// PUT /api/branches/:id → Şube bilgilerini güncelle
router.put('/:id', authorize(['super_admin']), async (req, res) => {
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

// GET /api/branches/:id - Şube detaylarını getir
router.get('/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    const { id } = req.params;

    // Branch manager yetki kontrolü
    if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(id)) {
      return res.status(403).json({ error: 'Bu şubenin detaylarını görüntüleme yetkiniz yok' });
    }

    // Şubeyi şablon bilgileriyle birlikte getir
    const result = await db.query(`
      SELECT b.*, 
             m.name as menu_template_name,
             p.name as price_template_name
      FROM branches b
      LEFT JOIN menu_templates m ON b.menu_template_id = m.id
      LEFT JOIN price_templates p ON b.price_template_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube detayları alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube detayları getirilemedi' });
  }
});

// DELETE /api/branches/:id → Şubeyi sil
router.delete('/:id', authorize(['super_admin']), async (req, res) => {
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
router.post('/update-brand', authorize(['super_admin']), async (req, res) => {
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

    // Marka değiştirildiğinde, yeni markanın tema ayarlarını şubeye uygulama opsiyonu ekleyelim
    try {
      // Markanın tema ayarlarını al
      const brandTheme = await db.query(
        'SELECT theme_settings FROM brands WHERE id = $1',
        [brand_id]
      );

      if (brandTheme.rows.length > 0 && brandTheme.rows[0].theme_settings) {
        // Tema ayarlarını şubeye uygula
        await db.query(
          'UPDATE branches SET theme_settings = $1 WHERE id = $2',
          [brandTheme.rows[0].theme_settings, branch_id]
        );

        console.log(`Marka değişimi: Marka ID ${brand_id} tema ayarları şube ID ${branch_id} için uygulandı`);
      }
    } catch (themeErr) {
      console.error("Marka değişiminde tema ayarları şubeye uygulanırken hata:", themeErr);
      // Tema ayarları uygulanamasa bile işleme devam et
    }

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

// GET /api/branches/:id/products → Şubeye özel ürünleri getir
router.get('/:id/products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const branchId = req.params.id;

  // Branch manager, sadece kendi şubesini yönetebilir
  if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(branchId)) {
    return res.status(403).json({ error: 'Bu şubenin ürünlerini görüntüleme yetkiniz yok' });
  }

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

router.patch("/branch-product", authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const { branch_id, product_id, is_visible, stock_count } = req.body;

  // Branch manager yetki kontrolü
  if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(branch_id)) {
    return res.status(403).json({ error: 'Bu şubenin ürünlerini güncelleme yetkiniz yok' });
  }

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

router.get('/:id/menu', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  const branchId = req.params.id;

  // Branch manager yetki kontrolü
  if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(branchId)) {
    return res.status(403).json({ error: 'Bu şubenin menüsünü görüntüleme yetkiniz yok' });
  }

  try {
    // Debug için detaylı log ekleyelim
    console.log(`Şube ${branchId} için menü getiriliyor`);

    // Önce şubenin mevcut olup olmadığını kontrol edelim
    const branchCheck = await db.query('SELECT id, name, menu_template_id, price_template_id FROM branches WHERE id = $1', [branchId]);

    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    const branch = branchCheck.rows[0];
    console.log('Şube bilgileri:', branch);

    // Eğer şubenin menü şablonu yoksa, tüm ürünleri göster (geriye uyumluluk için)
    if (!branch.menu_template_id) {
      console.log('Şube için menü şablonu bulunamadı, tüm ürünleri getiriyorum');

      const productsResult = await db.query(`
        SELECT p.*, c.name as category_name, bp.stock_count, p.price as display_price
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $1
        WHERE p.is_deleted = false AND (bp.is_visible IS NULL OR bp.is_visible = true)
        ORDER BY c.name, p.name
      `, [branchId]);

      console.log(`${productsResult.rows.length} ürün bulundu`);

      return res.json({
        branch: {
          id: branch.id,
          name: branch.name
        },
        products: productsResult.rows
      });
    }

    // Şubenin seçtiği menü şablonu varsa, o şablona göre getir
    console.log(`Menü şablonu ID: ${branch.menu_template_id}, Fiyat şablonu ID: ${branch.price_template_id}`);

    // Şubenin seçtiği menü şablonundaki ürünleri getir
    // ÖNEMLİ: Bu sorguyu menü şablonundaki ürünlerin olup olmadığını görmek için INNER JOIN yerine LEFT JOIN kullanalım
    let query = `
      SELECT 
        p.*, 
        c.name as category_name,
        COALESCE(bp.stock_count, 0) as stock_count,
        mtp.is_visible
    `;

    // Fiyat şablonu varsa, o şablondaki fiyatları getir
    if (branch.price_template_id) {
      query += `, COALESCE(ptp.price, p.price) as display_price`;
    } else {
      query += `, p.price as display_price`;
    }

    query += `
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
    `;

    // Fiyat şablonu varsa, join et
    if (branch.price_template_id) {
      query += `LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $2`;
    }

    query += `
      LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $3
      WHERE mtp.product_id IS NOT NULL
      AND (mtp.is_visible = true OR mtp.is_visible IS NULL)
      AND p.is_deleted = false
      ORDER BY c.name, p.name
    `;

    let queryParams = [];
    if (branch.price_template_id) {
      queryParams = [branch.menu_template_id, branch.price_template_id, branchId];
    } else {
      queryParams = [branch.menu_template_id, branchId];
    }

    const result = await db.query(query, queryParams);
    console.log(`${result.rows.length} ürün bulundu`);

    // Eğer hiç ürün bulunamadıysa, şablon ürünlerini kontrol edelim
    if (result.rows.length === 0) {
      console.log("Menü şablonunda görünür ürün bulunamadı, şablondaki tüm ürünleri kontrol ediyoruz");

      // Şablondaki tüm ürünleri (görünür olmasa bile) kontrol edelim
      const templateCheck = await db.query(`
        SELECT COUNT(*) as count FROM menu_template_products 
        WHERE menu_template_id = $1
      `, [branch.menu_template_id]);

      console.log(`Şablonda toplam ${templateCheck.rows[0].count} ürün kaydı var`);

      // Eğer şablonda hiç ürün yoksa, admin uyarısı ekleyelim
      if (parseInt(templateCheck.rows[0].count) === 0) {
        console.log("UYARI: Şablonda hiç ürün kaydı bulunmuyor!");
      }
    }

    res.json({
      branch: {
        id: branch.id,
        name: branch.name
      },
      products: result.rows
    });
  } catch (err) {
    console.error('Şube menüsü alınırken hata:', err);
    res.status(500).json({ error: 'Şube menüsü getirilemedi', details: err.message });
  }
});

// PUBLIC route - Şube bilgilerini getir (QR menü için)
router.get('/public/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Şubeyi şablon bilgileriyle birlikte getir
    const result = await db.query(`
      SELECT b.*, 
             m.name as menu_template_name,
             p.name as price_template_name
      FROM branches b
      LEFT JOIN menu_templates m ON b.menu_template_id = m.id
      LEFT JOIN price_templates p ON b.price_template_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube detayları alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube detayları getirilemedi' });
  }
});

// PUBLIC route - Şube menüsünü getir (QR menü için)
router.get('/public/:id/menu', async (req, res) => {
  const branchId = req.params.id;

  try {
    console.log(`Şube ${branchId} için menü getiriliyor (public)`);

    // Önce şubenin mevcut olup olmadığını kontrol edelim
    const branchCheck = await db.query('SELECT id, name, menu_template_id, price_template_id FROM branches WHERE id = $1', [branchId]);

    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    const branch = branchCheck.rows[0];
    
    // Eğer şubenin menü şablonu yoksa, tüm ürünleri göster
    if (!branch.menu_template_id) {
      console.log('Şube için menü şablonu bulunamadı, tüm ürünleri getiriyorum (public)');

      const productsResult = await db.query(`
        SELECT p.*, c.name as category_name, bp.stock_count, p.price as display_price
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $1
        WHERE p.is_deleted = false AND (bp.is_visible IS NULL OR bp.is_visible = true)
        ORDER BY c.name, p.name
      `, [branchId]);

      console.log(`${productsResult.rows.length} ürün bulundu (public)`);

      return res.json({
        branch: {
          id: branch.id,
          name: branch.name
        },
        products: productsResult.rows
      });
    }

    // Şubenin seçtiği menü şablonu varsa, o şablona göre getir
    console.log(`Menü şablonu ID: ${branch.menu_template_id}, Fiyat şablonu ID: ${branch.price_template_id} (public)`);

    // Şubenin seçtiği menü şablonundaki ürünleri getir
    let query = `
      SELECT 
        p.*, 
        c.name as category_name,
        COALESCE(bp.stock_count, 0) as stock_count,
        mtp.is_visible
    `;

    // Fiyat şablonu varsa, o şablondaki fiyatları getir
    if (branch.price_template_id) {
      query += `, COALESCE(ptp.price, p.price) as display_price`;
    } else {
      query += `, p.price as display_price`;
    }

    query += `
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
    `;

    // Fiyat şablonu varsa, join et
    if (branch.price_template_id) {
      query += `LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $2`;
    }

    query += `
      LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $3
      WHERE mtp.product_id IS NOT NULL
      AND (mtp.is_visible = true OR mtp.is_visible IS NULL)
      AND p.is_deleted = false
      ORDER BY c.name, p.name
    `;

    let queryParams = [];
    if (branch.price_template_id) {
      queryParams = [branch.menu_template_id, branch.price_template_id, branchId];
    } else {
      queryParams = [branch.menu_template_id, branchId];
    }

    const result = await db.query(query, queryParams);
    console.log(`${result.rows.length} ürün bulundu (public)`);

    res.json({
      branch: {
        id: branch.id,
        name: branch.name
      },
      products: result.rows
    });
  } catch (err) {
    console.error('Şube menüsü alınırken hata:', err);
    res.status(500).json({ error: 'Şube menüsü getirilemedi', details: err.message });
  }
});

module.exports = router;