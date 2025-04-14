const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// GET /api/brands - Tüm markaları getir
router.get('/', async (req, res) => {
    try {
        // Filtreleme ve sıralama desteği ekle
        const { sort = 'name', order = 'ASC', limit = 50, active, simple } = req.query;

        // SQL injection koruması için izin verilen sıralama alanları
        const allowedSortFields = ['id', 'name', 'created_at', 'updated_at'];
        const sortField = allowedSortFields.includes(sort) ? sort : 'name';

        // Aktif/pasif filtreleme
        let query = 'SELECT * FROM brands';
        const queryParams = [];

        if (active !== undefined) {
            query += ' WHERE is_active = $1';
            queryParams.push(active === 'true');
        }

        // Sıralama ve limit ekle
        query += ` ORDER BY ${sortField} ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT $${queryParams.length + 1}`;
        queryParams.push(parseInt(limit) || 50);

        const result = await db.query(query, queryParams);

        // UserManagement.jsx ile uyum için basit mod - doğrudan dizi döndür
        if (simple === 'true') {
            return res.json(result.rows);
        }

        // Toplam kayıt sayısını da döndür
        const countResult = await db.query('SELECT COUNT(*) FROM brands');

        res.json({
            data: result.rows,
            total: parseInt(countResult.rows[0].count),
            page_size: parseInt(limit) || 50
        });
    } catch (err) {
        console.error('Markalar yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Markalar yüklenemedi', details: err.message });
    }
});

// GET /api/brands/search - Marka arama endpoint'i
router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Arama sorgusu en az 2 karakter olmalıdır' });
        }

        const result = await db.query(
            `SELECT * FROM brands 
             WHERE name ILIKE $1 OR description ILIKE $1
             ORDER BY name ASC
             LIMIT 10`,
            [`%${q}%`]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Marka arama hatası:', err.message);
        res.status(500).json({ error: 'Arama yapılamadı', details: err.message });
    }
});

// GET /api/brands/:id - Marka detaylarını getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // İlişkili şubeleri de getir
        const brandResult = await db.query(
            `SELECT b.*, 
                (SELECT COUNT(*) FROM branches WHERE brand_id = b.id) as branch_count
             FROM brands b 
             WHERE b.id = $1`,
            [id]
        );

        if (brandResult.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        // Son eklenen şubeler
        const branchesResult = await db.query(
            `SELECT id, name, address, phone, email, is_active 
             FROM branches 
             WHERE brand_id = $1 
             ORDER BY created_at DESC 
             LIMIT 5`,
            [id]
        );

        // İstatistikler (toplam aktif/pasif şube sayısı)
        const statsResult = await db.query(
            `SELECT 
                COUNT(*) FILTER (WHERE is_active = true) as active_branches,
                COUNT(*) FILTER (WHERE is_active = false) as inactive_branches
             FROM branches 
             WHERE brand_id = $1`,
            [id]
        );

        res.json({
            ...brandResult.rows[0],
            recent_branches: branchesResult.rows,
            stats: statsResult.rows[0]
        });
    } catch (err) {
        console.error('Marka detayları yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Marka detayları yüklenemedi', details: err.message });
    }
});

// POST /api/brands - Yeni marka ekle
router.post('/', authorize(['super_admin']), async (req, res) => {
    try {
        const {
            name,
            logo_url,
            contact_email,
            contact_phone,
            address,
            description,
            website_url,
            social_media,
            is_active
        } = req.body;

        // Temel doğrulama
        if (!name) {
            return res.status(400).json({ error: 'Marka adı zorunludur' });
        }

        // Email formatı kontrolü
        if (contact_email && !/^\S+@\S+\.\S+$/.test(contact_email)) {
            return res.status(400).json({ error: 'Geçersiz email formatı' });
        }

        // Benzersiz isim kontrolü
        const existingCheck = await db.query(
            'SELECT id FROM brands WHERE LOWER(name) = LOWER($1)',
            [name]
        );

        if (existingCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Bu marka adı zaten kullanılıyor' });
        }

        // Markayı ekle
        const result = await db.query(`
            INSERT INTO brands (
                name, 
                logo_url, 
                contact_email, 
                contact_phone, 
                address, 
                description, 
                website_url,
                social_media,
                is_active,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
        `, [
            name,
            logo_url || null,
            contact_email || null,
            contact_phone || null,
            address || null,
            description || null,
            website_url || null,
            social_media ? JSON.stringify(social_media) : null,
            is_active !== false, // undefined ise true kabul et
            req.user?.id || null
        ]);

        // Başarılı yanıt
        res.status(201).json({
            success: true,
            message: 'Marka başarıyla oluşturuldu',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Marka eklenirken hata:', err.message);
        res.status(500).json({ error: 'Marka eklenemedi', details: err.message });
    }
});

// PUT /api/brands/:id - Marka bilgilerini güncelle
router.put('/:id', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            logo_url,
            contact_email,
            contact_phone,
            address,
            description,
            website_url,
            social_media,
            is_active
        } = req.body;

        // Temel doğrulama
        if (!name) {
            return res.status(400).json({ error: 'Marka adı zorunludur' });
        }

        // Email formatı kontrolü
        if (contact_email && !/^\S+@\S+\.\S+$/.test(contact_email)) {
            return res.status(400).json({ error: 'Geçersiz email formatı' });
        }

        // Benzersiz isim kontrolü (kendisi hariç)
        const existingCheck = await db.query(
            'SELECT id FROM brands WHERE LOWER(name) = LOWER($1) AND id != $2',
            [name, id]
        );

        if (existingCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Bu marka adı zaten kullanılıyor' });
        }

        // Markayı güncelle
        const result = await db.query(`
            UPDATE brands 
            SET name = $1, 
                logo_url = $2, 
                contact_email = $3, 
                contact_phone = $4, 
                address = $5, 
                description = $6, 
                website_url = $7,
                social_media = $8,
                is_active = $9, 
                updated_at = CURRENT_TIMESTAMP,
                updated_by = $10
            WHERE id = $11
            RETURNING *
        `, [
            name,
            logo_url || null,
            contact_email || null,
            contact_phone || null,
            address || null,
            description || null,
            website_url || null,
            social_media ? JSON.stringify(social_media) : null,
            is_active !== false,
            req.user?.id || null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        res.json({
            success: true,
            message: 'Marka başarıyla güncellendi',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Marka güncellenirken hata:', err.message);
        res.status(500).json({ error: 'Marka güncellenemedi', details: err.message });
    }
});

// DELETE /api/brands/:id - Markayı sil
router.delete('/:id', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;

        // İlişkili şubeleri kontrol et
        const branchCheck = await db.query(
            'SELECT COUNT(*) FROM branches WHERE brand_id = $1',
            [id]
        );

        if (parseInt(branchCheck.rows[0].count) > 0) {
            return res.status(409).json({
                error: 'Bu markaya ait şubeler bulunduğu için silinemez',
                branch_count: parseInt(branchCheck.rows[0].count)
            });
        }

        // Markayı sil
        const result = await db.query(
            'DELETE FROM brands WHERE id = $1 RETURNING id, name',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        res.json({
            success: true,
            message: `"${result.rows[0].name}" markası başarıyla silindi`
        });
    } catch (err) {
        console.error('Marka silinirken hata:', err.message);
        res.status(500).json({ error: 'Marka silinemedi', details: err.message });
    }
});

// GET /api/brands/:id/branches - Markaya ait şubeleri getir
router.get('/:id/branches', async (req, res) => {
    try {
        const { id } = req.params;
        const { active, sort = 'name', order = 'ASC', simple } = req.query;  // simple parametresi eklendi

        // Önce markanın varlığını kontrol et
        const brandCheck = await db.query('SELECT id, name FROM brands WHERE id = $1', [id]);
        if (brandCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        // SQL injection koruması için izin verilen sıralama alanları
        const allowedSortFields = ['id', 'name', 'address', 'created_at', 'updated_at'];
        const sortField = allowedSortFields.includes(sort) ? sort : 'name';

        // Sorgu oluştur - Basit mod için sadece gerekli alanları seç
        let query = simple === 'true'
            ? `SELECT b.id, b.name, b.address, b.is_active FROM branches b WHERE b.brand_id = $1`
            : `
            SELECT b.*,
                m.name as menu_template_name, 
                p.name as price_template_name,
                (SELECT COUNT(*) FROM branch_products WHERE branch_id = b.id) as product_count
            FROM branches b
            LEFT JOIN menu_templates m ON b.menu_template_id = m.id
            LEFT JOIN price_templates p ON b.price_template_id = p.id
            WHERE b.brand_id = $1
        `;

        const queryParams = [id];

        // Aktif/pasif filtreleme
        if (active !== undefined) {
            query += ` AND b.is_active = $2`;
            queryParams.push(active === 'true');
        }

        // Sıralama ekle
        query += ` ORDER BY b.${sortField} ${order === 'DESC' ? 'DESC' : 'ASC'}`;

        const result = await db.query(query, queryParams);

        // UserManagement.jsx ile uyum için basit mod - doğrudan dizi döndür
        if (simple === 'true') {
            return res.json(result.rows);
        }

        // Normal yanıt
        res.json({
            brand: {
                id: brandCheck.rows[0].id,
                name: brandCheck.rows[0].name
            },
            branches: result.rows,
            count: result.rows.length
        });
    } catch (err) {
        console.error('Markaya ait şubeler yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Şubeler yüklenemedi', details: err.message });
    }
});

// POST /api/brands/:id/branches - Markaya yeni şube ekle
router.post('/:id/branches', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            address,
            phone,
            email,
            manager_name,
            opening_hours,
            description,
            menu_template_id,
            price_template_id,
            is_active
        } = req.body;

        // Temel doğrulama
        if (!name || !address) {
            return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
        }

        // Markanın var olduğunu kontrol et
        const brandCheck = await db.query('SELECT id, name FROM brands WHERE id = $1', [id]);
        if (brandCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        // Yeni şubeyi ekle
        const result = await db.query(`
            INSERT INTO branches (
                name, 
                address, 
                phone, 
                email, 
                manager_name, 
                opening_hours, 
                description, 
                brand_id, 
                menu_template_id,
                price_template_id,
                is_active,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *
        `, [
            name,
            address,
            phone || null,
            email || null,
            manager_name || null,
            opening_hours || null,
            description || null,
            id,
            menu_template_id || null,
            price_template_id || null,
            is_active !== false,
            req.user?.id || null
        ]);

        // Varsayılan ürünleri bu şubeye ekle
        await db.query(`
            INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count)
            SELECT $1, id, true, 0 FROM products WHERE is_deleted = false
        `, [result.rows[0].id]);

        res.status(201).json({
            success: true,
            message: 'Şube başarıyla eklendi',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Şube eklenirken hata:', err.message);
        res.status(500).json({ error: 'Şube eklenemedi', details: err.message });
    }
});

// PATCH /api/brands/:id/status - Marka durumunu hızlıca değiştir
router.patch('/:id/status', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (is_active === undefined) {
            return res.status(400).json({ error: 'is_active parametresi gereklidir' });
        }

        const result = await db.query(
            `UPDATE brands 
             SET is_active = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2
             WHERE id = $3
             RETURNING id, name, is_active`,
            [is_active, req.user?.id || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        const statusText = is_active ? 'aktif' : 'pasif';

        res.json({
            success: true,
            message: `"${result.rows[0].name}" markası ${statusText} duruma getirildi`,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Marka durumu değiştirilirken hata:', err.message);
        res.status(500).json({ error: 'Durum değiştirilemedi', details: err.message });
    }
});

// GET /api/brands/:id/stats - Marka istatistiklerini getir
router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;

        // Markanın var olduğunu kontrol et
        const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [id]);
        if (brandCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }

        // Şube ve ürün sayıları
        const basicStats = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM branches WHERE brand_id = $1) as branch_count,
                (SELECT COUNT(*) FROM branches WHERE brand_id = $1 AND is_active = true) as active_branches,
                (SELECT 
                    COUNT(DISTINCT p.id)
                FROM branches b
                JOIN branch_products bp ON b.id = bp.branch_id
                JOIN products p ON bp.product_id = p.id
                WHERE b.brand_id = $1 AND p.is_deleted = false) as product_count
        `, [id]);

        // Son 7 günün sipariş istatistikleri
        const orderStats = await db.query(`
            SELECT 
                DATE(o.created_at) as date,
                COUNT(*) as order_count,
                SUM(o.total_price) as total_revenue
            FROM orders o
            JOIN branches b ON o.branch_id = b.id
            WHERE b.brand_id = $1
            AND o.created_at > CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(o.created_at)
            ORDER BY date DESC
        `, [id]);

        // En popüler ürünler
        const popularProducts = await db.query(`
            SELECT 
                p.id,
                p.name,
                COUNT(*) as order_count
            FROM orders o
            JOIN branches b ON o.branch_id = b.id
            JOIN jsonb_array_elements(o.items) AS item ON true
            JOIN products p ON (item->>'product_id')::integer = p.id
            WHERE b.brand_id = $1
            AND o.created_at > CURRENT_DATE - INTERVAL '30 days'
            GROUP BY p.id, p.name
            ORDER BY order_count DESC
            LIMIT 5
        `, [id]);

        res.json({
            ...basicStats.rows[0],
            daily_orders: orderStats.rows,
            popular_products: popularProducts.rows
        });
    } catch (err) {
        console.error('Marka istatistikleri alınırken hata:', err.message);
        res.status(500).json({ error: 'İstatistikler alınamadı', details: err.message });
    }
});

module.exports = router;