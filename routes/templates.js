const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// --- MENU TEMPLATE ROUTES ---

// GET - /api/templates/menu - Menü şablonlarını getir
router.get('/menu', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        // Branch manager ise sadece kendi şubesinin şablonlarını getir
        let query = 'SELECT * FROM menu_templates';
        const queryParams = [];
        
        if (req.user && req.user.role === 'branch_manager' && req.user.branch_id) {
            // Şubenin marka ID'sini al
            const branchResult = await db.query('SELECT brand_id FROM branches WHERE id = $1', [req.user.branch_id]);
            
            if (branchResult.rows.length > 0 && branchResult.rows[0].brand_id) {
                // Markaya ait şablonları veya herkese açık şablonları getir
                query += ' WHERE brand_id = $1 OR is_public = true';
                queryParams.push(branchResult.rows[0].brand_id);
            }
        }
        
        query += ' ORDER BY name ASC';
        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Menü şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonları yüklenemedi' });
    }
});

// POST - /api/templates/menu - Yeni menü şablonu ekle
router.post('/menu', authorize(['super_admin']), async (req, res) => {
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
router.get('/menu/:id/products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { onlyTemplateProducts } = req.query; // Bu parametreyi alıyoruz

        // Şablonu kontrol et
        const templateCheck = await db.query(
            'SELECT * FROM menu_templates WHERE id = $1',
            [id]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }
        
        // Branch manager ise şablona erişim hakkı olup olmadığını kontrol et
        if (req.user.role === 'branch_manager' && req.user.branch_id) {
            const branchCheck = await db.query(
                'SELECT brand_id FROM branches WHERE id = $1',
                [req.user.branch_id]
            );
            
            if (branchCheck.rows.length > 0) {
                const branchBrandId = branchCheck.rows[0].brand_id;
                const templateBrandCheck = await db.query(
                    'SELECT brand_id, is_public FROM menu_templates WHERE id = $1',
                    [id]
                );
                
                if (templateBrandCheck.rows.length > 0) {
                    const template = templateBrandCheck.rows[0];
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu şablona erişim yetkiniz yok' });
                    }
                }
            }
        }

        let query;

        // onlyTemplateProducts=true ise sadece şablondaki ürünleri getir
        if (onlyTemplateProducts === 'true') {
            query = `
          SELECT 
            p.*, 
            c.name as category_name,
            mtp.is_visible
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          INNER JOIN menu_template_products mtp ON p.id = mtp.product_id 
          WHERE mtp.menu_template_id = $1 AND p.is_deleted = false
          ORDER BY c.name, p.name
        `;
        } else {
            // Tüm ürünleri getir ve şablonda olanları işaretle
            query = `
          SELECT 
            p.*, 
            c.name as category_name,
            COALESCE(mtp.is_visible, false) as is_visible
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
          WHERE p.is_deleted = false
          ORDER BY c.name, p.name
        `;
        }

        const result = await db.query(query, [id]);
        res.json(result.rows);
    } catch (err) {
        console.error('Şablon ürünleri alınırken hata:', err);
        res.status(500).json({ error: 'Şablon ürünleri getirilemedi' });
    }
});

// POST - /api/templates/menu/:id/products - Şablondaki ürünleri güncelle
router.post('/menu/:id/products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;
        
        // Branch manager şablon yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM menu_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu şablonu güncelleme yetkiniz yok' });
                    }
                }
            }
        }

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
router.post('/menu/:id/products/batch', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const products = req.body;
        
        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM menu_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu şablonu toplu güncelleme yetkiniz yok' });
                    }
                }
            }
        }

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
router.get('/price', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        // Branch manager ise sadece kendi şubesinin şablonlarını getir
        let query = 'SELECT * FROM price_templates';
        const queryParams = [];
        
        if (req.user && req.user.role === 'branch_manager' && req.user.branch_id) {
            // Şubenin marka ID'sini al
            const branchResult = await db.query('SELECT brand_id FROM branches WHERE id = $1', [req.user.branch_id]);
            
            if (branchResult.rows.length > 0 && branchResult.rows[0].brand_id) {
                // Markaya ait şablonları veya herkese açık şablonları getir
                query += ' WHERE brand_id = $1 OR is_public = true';
                queryParams.push(branchResult.rows[0].brand_id);
            }
        }
        
        query += ' ORDER BY name ASC';
        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Fiyat şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonları yüklenemedi' });
    }
});

// POST - /api/templates/price - Yeni fiyat şablonu ekle
router.post('/price', authorize(['super_admin']), async (req, res) => {
    try {
        const { name, description, is_active, year, menu_template_id } = req.body;
        if (!name) return res.status(400).json({ error: 'Şablon adı zorunludur' });

        const result = await db.query(`
            INSERT INTO price_templates (name, description, is_active, year, menu_template_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`,
            [name, description || null, is_active !== false, year || new Date().getFullYear(), menu_template_id || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonu eklenemedi' });
    }
});

// GET - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını getir
router.get('/price/:id/products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;

        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM price_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu fiyat şablonuna erişim yetkiniz yok' });
                    }
                }
            }
        }

        const templateCheck = await db.query('SELECT * FROM price_templates WHERE id = $1', [id]);
        if (templateCheck.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        const priceTemplate = templateCheck.rows[0];

        // Fiyat şablonuna bağlı bir menü şablonu var mı kontrol et
        if (priceTemplate.menu_template_id) {
            // İlk olarak menü şablonunun varlığını kontrol et
            const menuCheck = await db.query('SELECT id FROM menu_templates WHERE id = $1', [priceTemplate.menu_template_id]);
            if (menuCheck.rows.length === 0) {
                console.warn(`Fiyat şablonuna bağlı menü şablonu (${priceTemplate.menu_template_id}) bulunamadı, tüm ürünleri getiriyoruz.`);

                // Menü şablonu yok - alternatif sorgu: Tüm ürünleri getir
                const fallbackResult = await db.query(`
                    SELECT p.*, c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
                    WHERE p.is_deleted = false
                    ORDER BY c.name, p.name`,
                    [id]
                );

                return res.json(fallbackResult.rows);
            }

            try {
                // Menü şablonundaki ürünleri getir ve fiyat bilgilerini ekle
                const result = await db.query(`
                    SELECT p.*, c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
                    LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $2
                    WHERE p.is_deleted = false AND mtp.is_visible = true
                    ORDER BY c.name, p.name`,
                    [priceTemplate.menu_template_id, id]
                );

                return res.json(result.rows);
            } catch (innerError) {
                console.error('Menü şablonu ürünleri alınırken hata:', innerError.message);

                // Hata olursa sadece fiyat ürünlerini getir
                const fallbackResult = await db.query(`
                    SELECT p.*, c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
                    WHERE p.is_deleted = false
                    ORDER BY c.name, p.name`,
                    [id]
                );

                return res.json(fallbackResult.rows);
            }
        } else {
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
        }
    } catch (err) {
        console.error('Şablon ürün fiyatları alınırken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürün fiyatları yüklenemedi', details: err.message });
    }
});

// POST - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını güncelle
router.post('/price/:id/products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;
        
        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM price_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu fiyat şablonunu güncelleme yetkiniz yok' });
                    }
                }
            }
        }

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
router.post('/price/:id/products/batch', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const products = req.body;
        
        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM price_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu fiyat şablonunu toplu güncelleme yetkiniz yok' });
                    }
                }
            }
        }

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
router.post('/import-template-products', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { branchId, menuTemplateId, products } = req.body;

        if ((!branchId && branchId !== null) || !menuTemplateId || !Array.isArray(products)) {
            return res.status(400).json({ error: 'Geçersiz istek formatı' });
        }
        
        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            if (branchId && parseInt(req.user.branch_id) !== parseInt(branchId)) {
                return res.status(403).json({ error: 'Bu şubeye ürün ekleme yetkiniz yok' });
            }
            
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM menu_templates WHERE id = $1',
                [menuTemplateId]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu şablona ürün ekleme yetkiniz yok' });
                    }
                }
            }
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
router.put('/menu/:id', authorize(['super_admin']), async (req, res) => {
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

router.put('/price/:id', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, is_active, year, menu_template_id } = req.body;

        const result = await db.query(`
            UPDATE price_templates
            SET name = $1, description = $2, is_active = $3, year = $4, menu_template_id = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6 RETURNING *`,
            [name, description || null, is_active !== false, year || new Date().getFullYear(), menu_template_id || null, id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablon güncellenemedi' });
    }
});

// DELETE - Menü / Fiyat şablonu silme
router.delete('/menu/:id', authorize(['super_admin']), async (req, res) => {
    try {
        await db.query('DELETE FROM menu_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Menü şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Menü şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

router.delete('/price/:id', authorize(['super_admin']), async (req, res) => {
    try {
        await db.query('DELETE FROM price_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Fiyat şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Fiyat şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

// PATCH - Şube şablon ataması
router.patch('/branches/:id/templates', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { menu_template_id, price_template_id } = req.body;
        
        // Branch manager yetkisi
        if (req.user.role === 'branch_manager' && parseInt(req.user.branch_id) !== parseInt(id)) {
            return res.status(403).json({ error: 'Bu şubenin şablonlarını güncelleme yetkiniz yok' });
        }

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

router.get('/price/:id', authorize(['super_admin', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;

        // Branch manager yetki kontrolü
        if (req.user.role === 'branch_manager') {
            const templateCheck = await db.query(
                'SELECT brand_id, is_public FROM price_templates WHERE id = $1',
                [id]
            );
            
            if (templateCheck.rows.length > 0) {
                const template = templateCheck.rows[0];
                const branchCheck = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                
                if (branchCheck.rows.length > 0) {
                    const branchBrandId = branchCheck.rows[0].brand_id;
                    if (!template.is_public && template.brand_id !== branchBrandId) {
                        return res.status(403).json({ error: 'Bu fiyat şablonuna erişim yetkiniz yok' });
                    }
                }
            }
        }

        const result = await db.query(`
            SELECT * FROM price_templates 
            WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Fiyat şablonu bulunamadı' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu detayı alınırken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonu detayı alınamadı' });
    }
});

module.exports = router;