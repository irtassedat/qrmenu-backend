const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// Helper function to check if user has access to a branch
async function userHasAccessToBranch(userId, userRole, userBranchId, userBrandId, branchId) {
    if (userRole === 'super_admin') return true;
    
    if (userRole === 'branch_manager') {
        return userBranchId === parseInt(branchId);
    }
    
    if (userRole === 'brand_manager') {
        const branchResult = await db.query(
            'SELECT brand_id FROM branches WHERE id = $1',
            [branchId]
        );
        return branchResult.rows.length > 0 && branchResult.rows[0].brand_id === userBrandId;
    }
    
    return false;
}

// --- MENU TEMPLATE ROUTES ---

// GET - /api/templates/menu - Menü şablonlarını getir (brand izolasyonlu)
router.get('/menu', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { role, brand_id: userBrandId } = req.user;

        let query = 'SELECT * FROM menu_templates';
        let queryParams = [];

        // Super admin hepsini görebilir, diğerleri sadece kendi markasını
        if (role !== 'super_admin') {
            query += ' WHERE brand_id = $1';
            queryParams.push(userBrandId);
        }

        query += ' ORDER BY name ASC';

        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Menü şablonları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonları yüklenemedi' });
    }
});

// GET - /api/templates/menu/:id - Belirli bir menü şablonunu getir
router.get('/menu/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            'SELECT * FROM menu_templates WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu detayı alınırken hata:', err.message);
        res.status(500).json({ error: 'Menü şablonu detayı alınamadı' });
    }
});

// GET - /api/templates/:id/available-products - Mevcut şablonda olmayan, diğer şablonlardaki ürünleri getir
router.get('/:id/available-products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const templateId = parseInt(id, 10);

        if (Number.isNaN(templateId)) {
            return res.status(400).json({ error: 'Geçersiz şablon ID' });
        }

        const templateCheck = await db.query(
            'SELECT id, brand_id FROM menu_templates WHERE id = $1',
            [templateId]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }

        const currentTemplate = templateCheck.rows[0];

        // Yetki kontrolü: super_admin dışındakiler sadece kendi markasının şablonuna erişebilir
        if (req.user.role !== 'super_admin') {
            let userBrandId = req.user.brand_id;

            if (!userBrandId && req.user.branch_id) {
                const branchResult = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                userBrandId = branchResult.rows[0]?.brand_id || null;
            }

            if (!userBrandId || currentTemplate.brand_id !== userBrandId) {
                return res.status(403).json({ error: 'Bu şablona erişim yetkiniz yok' });
            }
        }

        const queryParams = [templateId];
        let brandScopeCondition = 'AND other_mt.brand_id IS NULL';

        if (currentTemplate.brand_id !== null && currentTemplate.brand_id !== undefined) {
            queryParams.push(currentTemplate.brand_id);
            brandScopeCondition = `AND other_mt.brand_id = $${queryParams.length}`;
        }

        const productsQuery = `
            SELECT DISTINCT ON (p.id)
                p.id,
                p.name,
                p.price,
                p.category_id,
                c.name AS category_name
            FROM menu_template_products mtp
            INNER JOIN menu_templates other_mt ON other_mt.id = mtp.menu_template_id
            INNER JOIN products p ON p.id = mtp.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE other_mt.id <> $1
              ${brandScopeCondition}
              AND p.is_deleted = false
              AND NOT EXISTS (
                SELECT 1
                FROM menu_template_products current_mtp
                WHERE current_mtp.menu_template_id = $1
                  AND current_mtp.product_id = p.id
              )
            ORDER BY p.id, c.name, p.name
        `;

        const result = await db.query(productsQuery, queryParams);

        const products = [...result.rows].sort((a, b) => {
            const categoryCompare = (a.category_name || '').localeCompare((b.category_name || ''), 'tr');
            if (categoryCompare !== 0) return categoryCompare;
            return (a.name || '').localeCompare((b.name || ''), 'tr');
        });

        const categoryMap = new Map();
        for (const product of products) {
            if (!product.category_id || !product.category_name) continue;
            if (!categoryMap.has(product.category_id)) {
                categoryMap.set(product.category_id, {
                    id: product.category_id,
                    name: product.category_name
                });
            }
        }

        const categories = Array.from(categoryMap.values()).sort((a, b) =>
            (a.name || '').localeCompare((b.name || ''), 'tr')
        );

        return res.json({
            categories,
            products
        });
    } catch (err) {
        console.error('Varolan ürünler alınırken hata:', err.message);
        return res.status(500).json({ error: 'Varolan ürünler yüklenemedi' });
    }
});

// POST - /api/templates/menu - Yeni menü şablonu ekle
router.post('/menu', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        console.log('Menü şablonu ekleme isteği:', req.body);
        const { name, description, is_active, brand_id } = req.body;
        const { role, brand_id: userBrandId } = req.user;

        if (!name) return res.status(400).json({ error: 'Şablon adı zorunludur' });

        // Brand ID kontrolü: Super admin istediği markayı seçebilir, brand_manager ve branch_manager sadece kendi markası
        let targetBrandId;
        if (role === 'super_admin') {
            targetBrandId = brand_id || null;  // Super admin brand_id gönderebilir veya NULL
        } else {
            targetBrandId = userBrandId;  // Brand manager ve branch_manager sadece kendi markası
        }

        // Sequence değerini kontrol et
        const seqCheck = await db.query("SELECT last_value FROM menu_templates_id_seq");
        console.log('Mevcut sequence değeri:', seqCheck.rows[0].last_value);

        // Mevcut en büyük ID'yi kontrol et
        const maxIdCheck = await db.query("SELECT MAX(id) FROM menu_templates");
        const maxId = maxIdCheck.rows[0].max || 0;
        console.log('En büyük mevcut ID:', maxId);

        // Sequence değerini düzelt
        if (seqCheck.rows[0].last_value <= maxId) {
            await db.query(`SELECT setval('menu_templates_id_seq', $1)`, [maxId + 1]);
            console.log('Sequence değeri güncellendi:', maxId + 1);
        }

        const result = await db.query(`
            INSERT INTO menu_templates (name, description, is_active, brand_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [name, description || null, is_active !== false, targetBrandId]
        );

        console.log('Eklenen menü şablonu:', result.rows[0]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Menü şablonu eklenirken hata:', err);
        console.error('Hata mesajı:', err.message);
        console.error('Hata stack:', err.stack);
        res.status(500).json({ error: 'Menü şablonu eklenemedi', details: err.message });
    }
});

// GET - /api/templates/menu/:id/products - Şablondaki ürünleri getir
// GET - /api/templates/menu/:id/products - Şablondaki ürünleri getir
router.get('/menu/:id/products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { onlyTemplateProducts } = req.query; // Bu parametreyi alıyoruz

        console.log(`[TEMPLATE DEBUG] Menu template ${id} - onlyTemplateProducts=${onlyTemplateProducts}, type=${typeof onlyTemplateProducts}`);

        // Şablonu kontrol et
        const templateCheck = await db.query(
            'SELECT * FROM menu_templates WHERE id = $1',
            [id]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }

        let query;

        // onlyTemplateProducts=true ise sadece şablondaki ürünleri getir
        // String 'true', boolean true, veya 1 kabul et
        const shouldFilterToTemplateOnly = onlyTemplateProducts === 'true' || onlyTemplateProducts === true || onlyTemplateProducts === 1 || onlyTemplateProducts === '1';

        if (shouldFilterToTemplateOnly) {
            console.log(`[TEMPLATE DEBUG] Using INNER JOIN - only template products`);

            query = `
          SELECT 
            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
            p.updated_at, p.is_deleted, p.info_tags,
            c.name as category_name,
            mtp.is_visible,
            mtp.price as template_price
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          INNER JOIN menu_template_products mtp ON p.id = mtp.product_id 
          WHERE mtp.menu_template_id = $1 AND p.is_deleted = false
          ORDER BY c.name, p.name
        `;
        } else {
            console.log(`[TEMPLATE DEBUG] Using LEFT JOIN - all products with template flags`);
            // Tüm ürünleri getir ve şablonda olanları işaretle
            query = `
          SELECT 
            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
            p.updated_at, p.is_deleted, p.info_tags,
            c.name as category_name,
            COALESCE(mtp.is_visible, false) as is_visible,
            mtp.price as template_price
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
          WHERE p.is_deleted = false
          ORDER BY c.name, p.name
        `;
        }

        const result = await db.query(query, [id]);
        console.log(`[TEMPLATE DEBUG] Returning ${result.rows.length} products`);
        res.json(result.rows);
    } catch (err) {
        console.error('Şablon ürünleri alınırken hata:', err);
        res.status(500).json({ error: 'Şablon ürünleri getirilemedi' });
    }
});

// POST - /api/templates/menu/:id/products - Şablondaki ürünleri güncelle
router.post('/menu/:id/products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM menu_template_products WHERE menu_template_id = $1', [id]);

            for (const item of products) {
                // Eğer fiyat gönderilmişse onu da ekle
                if (item.price !== undefined && item.price !== null) {
                    await client.query(
                        'INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, price, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
                        [id, item.product_id, item.is_visible, item.price]
                    );
                } else {
                    await client.query(
                        'INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
                        [id, item.product_id, item.is_visible]
                    );
                }
            }

            await client.query('COMMIT');
            
            // Menu template'i kullanan şubeleri bul
            const branchesUsingTemplate = await db.query(
                'SELECT id FROM branches WHERE menu_template_id = $1',
                [id]
            );
            
            // Etkilenen şubeleri logla
            console.log(`Menu template ${id} güncellendi. Etkilenen şubeler:`, branchesUsingTemplate.rows.map(b => b.id));
            
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

// POST - /api/templates/menu/:id/products/add-existing - Şablona var olan ürünü ekle (append/upsert)
router.post('/menu/:id/products/add-existing', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { product_id, is_visible = true } = req.body;
        const templateId = parseInt(id, 10);
        const parsedProductId = parseInt(product_id, 10);

        console.log('[ADD_EXISTING_PRODUCT] Incoming request:', {
            template_id: id,
            parsed_template_id: templateId,
            product_id,
            parsed_product_id: parsedProductId,
            is_visible,
            user: {
                id: req.user?.id,
                role: req.user?.role,
                brand_id: req.user?.brand_id,
                branch_id: req.user?.branch_id
            }
        });

        if (Number.isNaN(templateId)) {
            return res.status(400).json({ error: 'Geçersiz template_id' });
        }

        if (Number.isNaN(parsedProductId)) {
            return res.status(400).json({ error: 'product_id zorunludur' });
        }

        const templateCheck = await db.query(
            'SELECT id, brand_id FROM menu_templates WHERE id = $1',
            [templateId]
        );

        if (templateCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Menü şablonu bulunamadı' });
        }

        const template = templateCheck.rows[0];

        // Super admin dışındaki roller sadece kendi markasının şablonuna ürün ekleyebilir
        if (req.user.role !== 'super_admin') {
            let userBrandId = req.user.brand_id;

            if (!userBrandId && req.user.branch_id) {
                const branchResult = await db.query(
                    'SELECT brand_id FROM branches WHERE id = $1',
                    [req.user.branch_id]
                );
                userBrandId = branchResult.rows[0]?.brand_id || null;
            }

            if (!userBrandId || template.brand_id !== userBrandId) {
                return res.status(403).json({ error: 'Bu şablona ürün ekleme yetkiniz yok' });
            }
        }

        const productCheck = await db.query(
            `SELECT id, name, category_id, brand_id
             FROM products
             WHERE id = $1 AND is_deleted = false`,
            [parsedProductId]
        );

        if (productCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Ürün bulunamadı' });
        }

        const product = productCheck.rows[0];

        // Super admin dışındaki rollerde ürün uygunluk kontrolü:
        // 1) brand_id birebir eşleşiyorsa izin ver
        // 2) legacy veri için product.brand_id eşleşmese bile, ürün aynı brand'deki başka menü şablonlarında kullanılıyorsa izin ver
        if (req.user.role !== 'super_admin' && template.brand_id !== null && template.brand_id !== undefined) {
            let canAddProduct = product.brand_id === template.brand_id;

            if (!canAddProduct) {
                const templateMembershipCheck = await db.query(
                    `SELECT EXISTS(
                        SELECT 1
                        FROM menu_template_products mtp
                        INNER JOIN menu_templates mt ON mt.id = mtp.menu_template_id
                        WHERE mtp.product_id = $1
                          AND mt.brand_id = $2
                    ) AS exists`,
                    [parsedProductId, template.brand_id]
                );
                canAddProduct = !!templateMembershipCheck.rows[0]?.exists;
            }

            if (!canAddProduct) {
                console.warn('[ADD_EXISTING_PRODUCT] Brand compatibility failed:', {
                    template_id: templateId,
                    template_brand_id: template.brand_id,
                    product_id: parsedProductId,
                    product_brand_id: product.brand_id
                });
                return res.status(403).json({ error: 'Bu ürün bu şablona eklenemez' });
            }
        }

        const upsertResult = await db.query(
            `INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (menu_template_id, product_id)
             DO UPDATE SET is_visible = EXCLUDED.is_visible, updated_at = CURRENT_TIMESTAMP
             RETURNING menu_template_id, product_id, is_visible`,
            [templateId, parsedProductId, Boolean(is_visible)]
        );

        res.json({
            success: true,
            message: 'Ürün şablona eklendi',
            data: upsertResult.rows[0]
        });
    } catch (err) {
        console.error('Var olan ürün şablona eklenirken hata:', err.message);
        res.status(500).json({ error: 'Ürün şablona eklenemedi' });
    }
});

// BATCH - /api/templates/menu/:id/products/batch - Excel'den toplu ürün güncelleme
router.post('/menu/:id/products/batch', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
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

                    // Fiyat bilgisi varsa onu da ekle
                    if (product['Fiyat (TL)'] !== undefined) {
                        await client.query(`
                            INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, price, updated_at)
                            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                            ON CONFLICT (menu_template_id, product_id)
                            DO UPDATE SET is_visible = $3, price = $4, updated_at = CURRENT_TIMESTAMP`,
                            [id, productId, product['Görünür'] === 'Evet', parseFloat(product['Fiyat (TL)'])]
                        );
                    } else {
                        await client.query(`
                            INSERT INTO menu_template_products (menu_template_id, product_id, is_visible, updated_at)
                            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                            ON CONFLICT (menu_template_id, product_id)
                            DO UPDATE SET is_visible = $3, updated_at = CURRENT_TIMESTAMP`,
                            [id, productId, product['Görünür'] === 'Evet']
                        );
                    }
                }
            }

            await client.query('COMMIT');
            
            // Menu template'i kullanan şubeleri bul
            const branchesUsingTemplate = await db.query(
                'SELECT id FROM branches WHERE menu_template_id = $1',
                [id]
            );
            
            // Etkilenen şubeleri logla
            console.log(`Menu template ${id} toplu güncellendi. Etkilenen şubeler:`, branchesUsingTemplate.rows.map(b => b.id));
            
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
router.get('/price', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { role, brand_id: userBrandId } = req.user;

        let query = 'SELECT * FROM price_templates';
        let queryParams = [];

        // Super admin hepsini görebilir, diğerleri sadece kendi markasını
        if (role !== 'super_admin') {
            query += ' WHERE brand_id = $1';
            queryParams.push(userBrandId);
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
router.post('/price', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { name, description, is_active, year, menu_template_id, brand_id } = req.body;
        const { role, brand_id: userBrandId } = req.user;

        if (!name) return res.status(400).json({ error: 'Şablon adı zorunludur' });

        // Brand ID kontrolü: Super admin istediği markayı seçebilir, branch_manager ve brand_manager sadece kendi markası
        let targetBrandId;
        if (role === 'super_admin') {
            targetBrandId = brand_id || null;
        } else {
            targetBrandId = userBrandId;  // Brand manager ve branch_manager sadece kendi markası
        }

        const result = await db.query(`
            INSERT INTO price_templates (name, description, is_active, year, menu_template_id, brand_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, description || null, is_active !== false, year || new Date().getFullYear(), menu_template_id || null, targetBrandId]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Fiyat şablonu eklenirken hata:', err.message);
        res.status(500).json({ error: 'Fiyat şablonu eklenemedi' });
    }
});

// GET - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını getir
router.get('/price/:id/products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { onlyTemplateProducts } = req.query;

        const templateCheck = await db.query('SELECT * FROM price_templates WHERE id = $1', [id]);
        if (templateCheck.rows.length === 0) return res.status(404).json({ error: 'Şablon bulunamadı' });

        const priceTemplate = templateCheck.rows[0];

        // Fiyat şablonuna bağlı bir menü şablonu var mı kontrol et
        if (priceTemplate.menu_template_id) {
            // İlk olarak menü şablonunun varlığını kontrol et
            const menuCheck = await db.query('SELECT id FROM menu_templates WHERE id = $1', [priceTemplate.menu_template_id]);
            if (menuCheck.rows.length === 0) {
                console.warn(`Fiyat şablonuna bağlı menü şablonu (${priceTemplate.menu_template_id}) bulunamadı, tüm ürünleri getiriyoruz.`);

                // Menü şablonu yok - alternatif sorgu
                let fallbackQuery;
                if (onlyTemplateProducts === 'true') {
                    fallbackQuery = `
                        SELECT
                            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                            p.updated_at, p.is_deleted, p.info_tags,
                            c.name as category_name, ptp.price as template_price
                        FROM price_template_products ptp
                        INNER JOIN products p ON p.id = ptp.product_id
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE ptp.price_template_id = $1 AND p.is_deleted = false
                        ORDER BY c.name, p.name`;
                } else {
                    fallbackQuery = `
                        SELECT
                            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                            p.updated_at, p.is_deleted, p.info_tags,
                            c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
                        WHERE p.is_deleted = false
                        ORDER BY c.name, p.name`;
                }
                
                const fallbackResult = await db.query(fallbackQuery, [id]);

                return res.json(fallbackResult.rows);
            }

            try {
                // Menü şablonundaki ürünleri getir ve fiyat bilgilerini ekle
                const result = await db.query(`
                    SELECT 
                        p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                        p.updated_at, p.is_deleted, p.info_tags,
                        c.name as category_name, 
                        COALESCE(ptp.price, p.price) as template_price
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

                // Hata olursa fiyat ürünlerini getir
                let errorFallbackQuery;
                if (onlyTemplateProducts === 'true') {
                    errorFallbackQuery = `
                        SELECT
                            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                            p.updated_at, p.is_deleted, p.info_tags,
                            c.name as category_name, ptp.price as template_price
                        FROM price_template_products ptp
                        INNER JOIN products p ON p.id = ptp.product_id
                        LEFT JOIN categories c ON p.category_id = c.id
                        WHERE ptp.price_template_id = $1 AND p.is_deleted = false
                        ORDER BY c.name, p.name`;
                } else {
                    errorFallbackQuery = `
                        SELECT
                            p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                            p.updated_at, p.is_deleted, p.info_tags,
                            c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                        FROM products p
                        LEFT JOIN categories c ON p.category_id = c.id
                        LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
                        WHERE p.is_deleted = false
                        ORDER BY c.name, p.name`;
                }
                
                const fallbackResult = await db.query(errorFallbackQuery, [id]);

                return res.json(fallbackResult.rows);
            }
        } else {
            // Menü şablonu bağlantısı yok
            let query;
            if (onlyTemplateProducts === 'true') {
                // Sadece bu fiyat şablonundaki ürünleri getir
                query = `
                    SELECT 
                        p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                        p.updated_at, p.is_deleted, p.info_tags,
                        c.name as category_name, ptp.price as template_price
                    FROM price_template_products ptp
                    INNER JOIN products p ON p.id = ptp.product_id
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE ptp.price_template_id = $1 AND p.is_deleted = false
                    ORDER BY c.name, p.name`;
            } else {
                // Tüm ürünleri getir ve fiyat şablonundaki fiyatları işaretle
                query = `
                    SELECT 
                        p.id, p.name, p.description, p.price, p.image_url, p.category_id,
                        p.updated_at, p.is_deleted, p.info_tags,
                        c.name as category_name, COALESCE(ptp.price, p.price) as template_price
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $1
                    WHERE p.is_deleted = false
                    ORDER BY c.name, p.name`;
            }
            
            const result = await db.query(query, [id]);
            res.json(result.rows);
        }
    } catch (err) {
        console.error('Şablon ürün fiyatları alınırken hata:', err.message);
        res.status(500).json({ error: 'Şablon ürün fiyatları yüklenemedi', details: err.message });
    }
});

// POST - /api/templates/price/:id/products - Şablondaki ürün fiyatlarını güncelle
router.post('/price/:id/products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { products } = req.body;
        
        console.log('Fiyat güncelleme isteği:', { id, products });

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            for (const item of products) {
                console.log('Güncellenecek ürün:', { 
                    price_template_id: id, 
                    product_id: item.product_id, 
                    price: item.price 
                });
                
                // Önce mevcut kayıtları kontrol et
                const existingCheck = await client.query(
                    'SELECT id FROM price_template_products WHERE price_template_id = $1 AND product_id = $2',
                    [id, item.product_id]
                );
                
                if (existingCheck.rows.length > 0) {
                    // Kayıt varsa güncelle ve updated_at'i güncelle
                    await client.query(
                        'UPDATE price_template_products SET price = $3, updated_at = CURRENT_TIMESTAMP WHERE price_template_id = $1 AND product_id = $2',
                        [id, item.product_id, item.price]
                    );
                } else {
                    // Kayıt yoksa ekle
                    await client.query(
                        'INSERT INTO price_template_products (price_template_id, product_id, price, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
                        [id, item.product_id, item.price]
                    );
                }
            }

            await client.query('COMMIT');
            
            // Fiyat template'i kullanan şubeleri bul
            const branchesUsingTemplate = await db.query(
                'SELECT id FROM branches WHERE price_template_id = $1',
                [id]
            );
            
            // Etkilenen şubeleri logla
            console.log(`Fiyat template ${id} güncellendi. Etkilenen şubeler:`, branchesUsingTemplate.rows.map(b => b.id));
            
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
router.post('/price/:id/products/batch', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
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
                        INSERT INTO price_template_products (price_template_id, product_id, price, updated_at)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                        ON CONFLICT (price_template_id, product_id)
                        DO UPDATE SET price = $3, updated_at = CURRENT_TIMESTAMP`,
                        [id, productId, parseFloat(product['Fiyat (TL)'])]
                    );
                }
            }

            await client.query('COMMIT');
            
            // Fiyat template'i kullanan şubeleri bul
            const branchesUsingTemplate = await db.query(
                'SELECT id FROM branches WHERE price_template_id = $1',
                [id]
            );
            
            // Etkilenen şubeleri logla
            console.log(`Fiyat template ${id} toplu güncellendi. Etkilenen şubeler:`, branchesUsingTemplate.rows.map(b => b.id));
            
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
router.post('/import-template-products', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        console.log("Import Template Products - Gelen istek:", JSON.stringify(req.body));
        
        const { branchId, menuTemplateId, products } = req.body;
        
        console.log("Parsed Request - branchId:", branchId, "menuTemplateId:", menuTemplateId, "products count:", Array.isArray(products) ? products.length : "not an array");

        if ((!branchId && branchId !== null) || !menuTemplateId || !Array.isArray(products)) {
            console.log("Validation failed - branchId:", branchId, "menuTemplateId:", menuTemplateId, "products:", products);
            return res.status(400).json({ error: 'Geçersiz istek formatı' });
        }
        
        // Check if brand manager has access to this branch
        if (req.user.role === 'brand_manager') {
            const hasAccess = await userHasAccessToBranch(
                req.user.id, 
                req.user.role, 
                req.user.branch_id, 
                req.user.brand_id, 
                branchId
            );
            
            if (!hasAccess) {
                return res.status(403).json({ error: 'Bu şubeye erişim yetkiniz yok' });
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
                        try {
                            // Use a high starting ID (1000) to avoid conflicts
                            const categoryExists = await client.query(
                                "SELECT EXISTS(SELECT 1 FROM categories WHERE id = 1000)"
                            );
                            
                            let newCategoryId;
                            if (categoryExists.rows[0].exists) {
                                // If 1000 already exists, get max ID + 1000
                                const maxIdCheck = await client.query("SELECT MAX(id) FROM categories");
                                newCategoryId = (parseInt(maxIdCheck.rows[0].max) || 0) + 1000;
                            } else {
                                newCategoryId = 1000;
                            }
                            
                            // Explicitly create with the new ID
                            const newCategory = await client.query(
                                'INSERT INTO categories (id, name) VALUES ($1, $2) RETURNING id',
                                [newCategoryId, product.category]
                            );
                            categoryId = newCategory.rows[0].id;
                            
                            // Update the sequence
                            await client.query(`SELECT setval('categories_id_seq', $1)`, [newCategoryId + 1]);
                            
                            console.log(`New category created with ID ${categoryId} for '${product.category}'`);
                        } catch (catErr) {
                            console.error('Error creating category:', catErr);
                            throw catErr;
                        }
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
                    try {
                        // Use a very high starting ID (10000) to avoid conflicts
                        const maxProductIdCheck = await client.query("SELECT MAX(id) FROM products");
                        const maxProductId = (parseInt(maxProductIdCheck.rows[0].max) || 0) + 10000; // Add 10000 to avoid collisions
                        
                        // Ürün yoksa ve geçerli isim ve kategori varsa ekle
                        const newProduct = await client.query(`
                            INSERT INTO products (id, name, price, description, image_url, category_id)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            RETURNING id
                        `, [
                            maxProductId,
                            product.name,
                            product.price,
                            product.description,
                            product.image_url,
                            categoryId
                        ]);

                        productId = newProduct.rows[0].id;
                        await client.query(`SELECT setval('products_id_seq', $1)`, [maxProductId + 1]);
                        console.log(`New product created with ID ${productId} for '${product.name}'`);
                        processingResults.inserted++;
                    } catch (prodErr) {
                        console.error('Error creating product:', prodErr);
                        throw prodErr;
                    }
                } else {
                    // İsim veya kategori eksikse atla
                    processingResults.skipped++;
                    continue;
                }

                // Ürünü menü şablonuna ekle veya güncelle
                try {
                    // Check if a menu_template_products entry exists for this pair
                    const mtpCheck = await client.query(
                        'SELECT EXISTS(SELECT 1 FROM menu_template_products WHERE menu_template_id = $1 AND product_id = $2)',
                        [menuTemplateId, productId]
                    );
                    
                    if (mtpCheck.rows[0].exists) {
                        // Update existing record
                        await client.query(`
                            UPDATE menu_template_products 
                            SET is_visible = $3
                            WHERE menu_template_id = $1 AND product_id = $2
                        `, [
                            menuTemplateId,
                            productId,
                            product.is_visible
                        ]);
                        console.log(`Updated menu_template_products for template ${menuTemplateId} and product ${productId}`);
                    } else {
                        // Get max ID and add safe offset
                        const maxMtpIdCheck = await client.query("SELECT MAX(id) FROM menu_template_products");
                        const maxMtpId = (parseInt(maxMtpIdCheck.rows[0].max) || 0) + 10000; // Add 10000 to avoid collisions
                        
                        // Insert with explicit ID
                        await client.query(`
                            INSERT INTO menu_template_products (id, menu_template_id, product_id, is_visible)
                            VALUES ($1, $2, $3, $4)
                        `, [
                            maxMtpId,
                            menuTemplateId,
                            productId,
                            product.is_visible
                        ]);
                        
                        // Update sequence
                        await client.query(`SELECT setval('menu_template_products_id_seq', $1)`, [maxMtpId + 1]);
                        console.log(`Created menu_template_products with ID ${maxMtpId} for template ${menuTemplateId} and product ${productId}`);
                    }
                } catch (mtpErr) {
                    console.error('Error with menu_template_products:', mtpErr);
                    throw mtpErr;
                }

                // Şube ürün ilişkisini güncelle
                try {
                    // Check if a branch_products entry exists for this pair
                    const bpCheck = await client.query(
                        'SELECT EXISTS(SELECT 1 FROM branch_products WHERE branch_id = $1 AND product_id = $2)',
                        [branchId, productId]
                    );
                    
                    if (bpCheck.rows[0].exists) {
                        // Update existing record
                        await client.query(`
                            UPDATE branch_products 
                            SET stock_count = $3, is_visible = $4
                            WHERE branch_id = $1 AND product_id = $2
                        `, [
                            branchId,
                            productId,
                            product.stock_count,
                            product.is_visible
                        ]);
                        console.log(`Updated branch_products for branch ${branchId} and product ${productId}`);
                    } else {
                        // Get max ID and add safe offset
                        const maxBpIdCheck = await client.query("SELECT MAX(id) FROM branch_products");
                        const maxBpId = (parseInt(maxBpIdCheck.rows[0].max) || 0) + 10000; // Add 10000 to avoid collisions
                        
                        // Insert with explicit ID
                        await client.query(`
                            INSERT INTO branch_products (id, branch_id, product_id, stock_count, is_visible)
                            VALUES ($1, $2, $3, $4, $5)
                        `, [
                            maxBpId,
                            branchId,
                            productId,
                            product.stock_count,
                            product.is_visible
                        ]);
                        
                        // Update sequence
                        await client.query(`SELECT setval('branch_products_id_seq', $1)`, [maxBpId + 1]);
                        console.log(`Created branch_products with ID ${maxBpId} for branch ${branchId} and product ${productId}`);
                    }
                } catch (bpErr) {
                    console.error('Error with branch_products:', bpErr);
                    throw bpErr;
                }
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
router.put('/menu/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
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

router.put('/price/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
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
router.delete('/menu/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        await db.query('DELETE FROM menu_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Menü şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Menü şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

router.delete('/price/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        await db.query('DELETE FROM price_templates WHERE id = $1', [req.params.id]);
        res.json({ message: 'Fiyat şablonu başarıyla silindi' });
    } catch (err) {
        console.error('Fiyat şablonu silinirken hata:', err.message);
        res.status(500).json({ error: 'Şablon silinemedi' });
    }
});

// PATCH - Şube şablon ataması
router.patch('/branches/:id/templates', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;
        const { menu_template_id, price_template_id, slider_template_id, enable_cart, enable_popup, payment_api_info } = req.body;

        // Check if user has access to this branch
        const hasAccess = await userHasAccessToBranch(
            req.user.id,
            req.user.role,
            req.user.branch_id,
            req.user.brand_id,
            id
        );

        if (!hasAccess) {
            return res.status(403).json({ error: 'Bu şubeye erişim yetkiniz yok' });
        }

        const branchCheck = await db.query('SELECT id, theme_settings FROM branches WHERE id = $1', [id]);
        if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'Şube bulunamadı' });

        // Mevcut theme_settings'i al
        let themeSettings = branchCheck.rows[0].theme_settings || {};

        // cart ve popup ayarlarını güncelle
        if (enable_cart !== undefined) {
            themeSettings.cart = themeSettings.cart || {};
            themeSettings.cart.enabled = enable_cart;
        }
        if (enable_popup !== undefined) {
            themeSettings.popup = themeSettings.popup || {};
            themeSettings.popup.enabled = enable_popup;
        }

        // Bazı kurulumlarda branches tablosunda slider_template_id/payment_api_info kolonu olmayabilir.
        // Kolon varlığını kontrol ederek dinamik UPDATE kuruyoruz.
        const optionalColumnsResult = await db.query(`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'branches'
              AND column_name = ANY($1::text[])
        `, [['slider_template_id', 'payment_api_info']]);

        const optionalColumns = new Set(optionalColumnsResult.rows.map((row) => row.column_name));
        const updateFields = [
            { column: 'menu_template_id', value: menu_template_id || null },
            { column: 'price_template_id', value: price_template_id || null }
        ];

        if (optionalColumns.has('slider_template_id')) {
            updateFields.push({ column: 'slider_template_id', value: slider_template_id || null });
        }

        if (optionalColumns.has('payment_api_info')) {
            updateFields.push({ column: 'payment_api_info', value: payment_api_info || null });
        }

        updateFields.push({ column: 'theme_settings', value: JSON.stringify(themeSettings) });
        updateFields.push({ column: 'updated_at', value: null, raw: 'CURRENT_TIMESTAMP' });

        const setClause = updateFields
            .map((field, index) => {
                if (field.raw) return `${field.column} = ${field.raw}`;
                return `${field.column} = $${index + 1}`;
            })
            .join(',\n                ');

        const params = updateFields
            .filter((field) => !field.raw)
            .map((field) => field.value);
        params.push(id);

        const result = await db.query(`
            UPDATE branches
            SET ${setClause}
            WHERE id = $${params.length} RETURNING *`,
            params
        );

        // Response'a enable_cart ve enable_popup ekle
        const response = {
            ...result.rows[0],
            enable_cart: result.rows[0].theme_settings?.cart?.enabled ?? true,
            enable_popup: result.rows[0].theme_settings?.popup?.enabled ?? true
        };

        res.json(response);
    } catch (err) {
        console.error('Şube şablonları güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Şablonlar güncellenemedi' });
    }
});

router.get('/price/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { id } = req.params;

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
