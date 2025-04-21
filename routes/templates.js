const express = require('express');
const router = express.Router();
const db = require('../db');

// --- MENU TEMPLATE ROUTES ---

// GET - /api/templates/menu - Menü şablonlarını getir
router.get('/menu', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM menu_templates ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Menü şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonları yüklenemedi' });
    }
});

// POST - /api/templates/menu - Yeni menü şablonu ekle
router.post('/menu', async (req, res) => {
    try {
        const { name, description, is_active } = req.body;
        if (!name) return res.status(400).json({ error: 'Şablon adı zorunludur' });

        const result = await db.query(`
            INSERT INTO menu_templates (name, description, is_active)
            VALUES ($1, $2, $3)
            RETURNING *`,
            [name, description || null, is_active !== false]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonu eklenemedi' });
    }
});

// GET - /api/templates/menu/:id/products - Şablondaki ürünleri getir
router.get('/menu/:id/products', async (req, res) => {
    try {
        const { id } = req.params;
        const { branchId } = req.query; // Opsiyonel olarak şube spesifik bilgileri de getir

        // Şablonu kontrol et
        const templateCheck = await db.query(
            'SELECT * FROM menu_templates WHERE id = $1',
            [id]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }

        // SQL sorgusunu hazırla - branch ID varsa şube spesifik bilgileri de getir
        let query = `
        SELECT 
          p.*, 
          c.name as category_name,
          mtp.is_visible
      `;

        if (branchId) {
            query += `, bp.stock_count, bp.price_override`;
        }

        query += `
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
      `;

        if (branchId) {
            query += ` LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $2`;
        }

        query += `
        ORDER BY c.name, p.name
      `;

        // Sorguyu çalıştır
        let result;
        if (branchId) {
            result = await db.query(query, [id, branchId]);
        } else {
            result = await db.query(query, [id]);
        }

        res.json(result.rows);
    } catch (err) {
        console.error('Şablon ürünleri alınırken hata:', err);
        res.status(500).json({ error: 'Şablon ürünleri getirilemedi' });
    }
});

// POST - /api/templates/menu/:id/products - Şablondaki ürünleri güncelle
router.post('/menu/:id/products', async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM menu_template_products WHERE menu_template_id = $1', [id]);

            for (const item of products) {
                await client.query(
                    'INSERT INTO menu_template_products (menu_template_id, product_id, is_visible) VALUES ($1, $2, $3)',
                    [id, item.product_id, item.is_visible]
                );
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Şablon ürünleri güncellendi' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Şablon ürünleri güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürünleri güncellenemedi' });
    }
});

// BATCH - /api/templates/menu/:id/products/batch - Excel'den toplu ürün güncelleme
router.post('/menu/:id/products/batch', async (req, res) => {
    try {
        const { id } = req.params;
        const products = req.body;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            for (const product of products) {
                const productCheck = await client.query('SELECT id FROM products WHERE name = $1', [product['Ürün Adı']]);
                if (productCheck.rows.length > 0) {
                    const productId = productCheck.rows[0].id;

                    await client.query(`
                        INSERT INTO menu_template_products (menu_template_id, product_id, is_visible)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (menu_template_id, product_id)
                        DO UPDATE SET is_visible = $3`,
                        [id, productId, product['Görünür'] === 'Evet']
                    );
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Şablon ürünleri toplu olarak güncellendi' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Şablon ürünleri toplu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürünleri toplu güncellenemedi' });
    }
});

// --- PRICE TEMPLATE ROUTES ---

// GET - /api/templates/price - Fiyat şablonlarını getir
router.get('/price', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM price_templates ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Fiyat şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonları yüklenemedi' });
    }
});

// POST - /api/templates/price - Yeni fiyat şablonu ekle
router.post('/price', async (req, res) => {
    try {
        const { name, description, is_active, year } = req.body;
        if (!name) return res.status(400).json({ error: 'Şablon adı zorunludur' });

        const result = await db.query(`
            INSERT INTO price_templates (name, description, is_active, year)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [name, description || null, is_active !== false, year || new Date().getFullYear()]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonu eklenemedi' });
    }
});

// GET - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını getir
router.get('/price/:id/products', async (req, res) => {
    try {
        const { id } = req.params;

        const templateCheck = await db.query('SELECT * FROM price_templates WHERE id = $1', [id]);
        if (templateCheck.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        const result = await db.query(`
            SELECT p.*, c.name as category_name, COALESCE(ptp.price, p.price) as template_price
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
            WHERE p.is_deleted = false
            ORDER BY c.name, p.name`,
            [id]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Şablon ürün fiyatları alınırken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürün fiyatları yüklenemedi' });
    }
});

// POST - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını güncelle
router.post('/price/:id/products', async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            for (const item of products) {
                await client.query(`
                    INSERT INTO price_template_products (price_template_id, product_id, price)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (price_template_id, product_id)
                    DO UPDATE SET price = $3`,
                    [id, item.product_id, item.price]
                );
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Şablon ürün fiyatları güncellendi' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Şablon ürün fiyatları güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürün fiyatları güncellenemedi' });
    }
});

// BATCH - /api/templates/price/:id/products/batch - Excel'den toplu fiyat güncelleme
router.post('/price/:id/products/batch', async (req, res) => {
    try {
        const { id } = req.params;
        const products = req.body;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            for (const product of products) {
                const productCheck = await client.query('SELECT id FROM products WHERE name = $1', [product['Ürün Adı']]);
                if (productCheck.rows.length > 0 && product['Fiyat (TL)']) {
                    const productId = productCheck.rows[0].id;
                    await client.query(`
                        INSERT INTO price_template_products (price_template_id, product_id, price)
                        VALUES ($1, $2, $3)
                        ON CONFLICT (price_template_id, product_id)
                        DO UPDATE SET price = $3`,
                        [id, productId, parseFloat(product['Fiyat (TL)'])]
                    );
                }
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Şablon ürün fiyatları toplu olarak güncellendi' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Şablon ürün fiyatları toplu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürün fiyatları toplu güncellenemedi' });
    }
});

// POST /api/templates/import-template-products - Şablona toplu ürün ekleme
router.post('/import-template-products', async (req, res) => {
    try {
        const { branchId, menuTemplateId, products } = req.body;

        if ((!branchId && branchId !== null) || !menuTemplateId || !Array.isArray(products)) {
            return res.status(400).json({ error: 'Geçersiz istek formatı' });
        }

        // Şablonu kontrol et
        const templateCheck = await db.query(
            'SELECT * FROM menu_templates WHERE id = $1',
            [menuTemplateId]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }

        // Şubeyi kontrol et
        const branchCheck = await db.query(
            'SELECT * FROM branches WHERE id = $1',
            [branchId]
        );

        if (branchCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Şube bulunamadı' });
        }

        // Transaction başlat
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // Kategorileri isimden ID'ye çevir (yeni kategori oluşturma desteğiyle)
            const processingResults = {
                inserted: 0,
                updated: 0,
                skipped: 0
            };

            for (const product of products) {
                // Kategori kontrolü ve ekleme
                let categoryId = null;
                if (product.category) {
                    const categoryCheck = await client.query(
                        'SELECT id FROM categories WHERE LOWER(name) = LOWER($1)',
                        [product.category]
                    );

                    if (categoryCheck.rows.length > 0) {
                        categoryId = categoryCheck.rows[0].id;
                    } else {
                        // Yeni kategori oluştur
                        const newCategory = await client.query(
                            'INSERT INTO categories (name) VALUES ($1) RETURNING id',
                            [product.category]
                        );
                        categoryId = newCategory.rows[0].id;
                    }
                }

                // Ürün var mı kontrol et (isme göre)
                const productCheck = await client.query(
                    'SELECT id FROM products WHERE LOWER(name) = LOWER($1)',
                    [product.name]
                );

                let productId;
                if (productCheck.rows.length > 0) {
                    // Ürün varsa güncelle
                    productId = productCheck.rows[0].id;
                    await client.query(`
              UPDATE products 
              SET 
                price = $1,
                description = $2,
                image_url = $3,
                category_id = $4,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $5
            `, [
                        product.price,
                        product.description,
                        product.image_url,
                        categoryId,
                        productId
                    ]);

                    processingResults.updated++;
                } else if (product.name && categoryId) {
                    // Ürün yoksa ve geçerli isim ve kategori varsa ekle
                    const newProduct = await client.query(`
              INSERT INTO products (name, price, description, image_url, category_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `, [
                        product.name,
                        product.price,
                        product.description,
                        product.image_url,
                        categoryId
                    ]);

                    productId = newProduct.rows[0].id;
                    processingResults.inserted++;
                } else {
                    // İsim veya kategori eksikse atla
                    processingResults.skipped++;
                    continue;
                }

                // Ürünü menü şablonuna ekle veya güncelle
                await client.query(`
            INSERT INTO menu_template_products (menu_template_id, product_id, is_visible)
            VALUES ($1, $2, $3)
            ON CONFLICT (menu_template_id, product_id) 
            DO UPDATE SET is_visible = $3
          `, [
                    menuTemplateId,
                    productId,
                    product.is_visible
                ]);

                // Şube ürün ilişkisini güncelle
                await client.query(`
            INSERT INTO branch_products (branch_id, product_id, stock_count, is_visible)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (branch_id, product_id) 
            DO UPDATE SET stock_count = $3, is_visible = $4
          `, [
                    branchId,
                    productId,
                    product.stock_count,
                    product.is_visible
                ]);
            }

            await client.query('COMMIT');
            res.json({ success: true, stats: processingResults });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Şablon ürünleri içe aktarılırken hata:', err);
        res.status(500).json({ error: 'Şablon ürünleri içe aktarılamadı' });
    }
});

// --- ORTAK ---

// PUT - Menü / Fiyat şablonlarını güncelle
router.put('/menu/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active } = req.body;

        const result = await db.query(`
            UPDATE menu_templates
            SET name = $1, description = $2, is_active = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 RETURNING *`,
            [name, description || null, is_active !== false, id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon güncellenemedi' });
    }
});

router.put('/price/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active, year } = req.body;

        const result = await db.query(`
            UPDATE price_templates
            SET name = $1, description = $2, is_active = $3, year = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 RETURNING *`,
            [name, description || null, is_active !== false, year || new Date().getFullYear(), id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon güncellenemedi' });
    }
});

// DELETE - Menü / Fiyat şablonu silme
router.delete('/menu/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM menu_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Menü şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Menü şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

router.delete('/price/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM price_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Fiyat şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Fiyat şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

// PATCH - Şube şablon ataması
router.patch('/branches/:id/templates', async (req, res) => {
    try {
        const { id } = req.params;
        const { menu_template_id, price_template_id } = req.body;

        const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [id]);
        if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'Şube bulunamadı' });

        const result = await db.query(`
            UPDATE branches
            SET menu_template_id = $1, price_template_id = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3 RETURNING *`,
            [menu_template_id || null, price_template_id || null, id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Şube şablonları güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablonlar güncellenemedi' });
    }
});

module.exports = router;
