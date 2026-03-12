const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// GET /api/cart-settings/brand/:brandId - Marka sepet ayarlarını getir
router.get('/brand/:brandId', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { brandId } = req.params;
        
        // Authorization check for brand managers
        if (req.user.role === 'brand_manager' && req.user.brand_id !== parseInt(brandId)) {
            return res.status(403).json({ error: 'Bu markaya erişim yetkiniz yok' });
        }
        
        // Authorization check for branch managers - they can only access their brand
        if (req.user.role === 'branch_manager') {
            const branchResult = await db.query(
                'SELECT brand_id FROM branches WHERE id = $1',
                [req.user.branch_id]
            );
            if (branchResult.rows.length === 0 || branchResult.rows[0].brand_id !== parseInt(brandId)) {
                return res.status(403).json({ error: 'Bu markaya erişim yetkiniz yok' });
            }
        }
        
        const result = await db.query(`
            SELECT id, name, cart_enabled, cart_settings 
            FROM brands 
            WHERE id = $1
        `, [brandId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }
        
        const brand = result.rows[0];
        res.json({
            ...brand,
            cart_settings: brand.cart_settings || {
                min_order_amount: 0,
                max_order_amount: null,
                delivery_fee: 0,
                payment_methods: ['cash', 'card'],
                auto_approve_orders: false,
                order_time_limit: 30
            }
        });
    } catch (err) {
        console.error('Marka sepet ayarları alınırken hata:', err);
        res.status(500).json({ error: 'Ayarlar alınamadı' });
    }
});

// GET /api/cart-settings/branch/:branchId - Şube sepet ayarlarını getir
router.get('/branch/:branchId', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { branchId } = req.params;
        
        // Authorization check for branch managers
        if (req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(branchId)) {
            return res.status(403).json({ error: 'Bu şubeye erişim yetkiniz yok' });
        }
        
        // Authorization check for brand managers
        if (req.user.role === 'brand_manager') {
            const branchResult = await db.query(
                'SELECT brand_id FROM branches WHERE id = $1',
                [branchId]
            );
            if (branchResult.rows.length === 0 || branchResult.rows[0].brand_id !== req.user.brand_id) {
                return res.status(403).json({ error: 'Bu şubeye erişim yetkiniz yok' });
            }
        }
        
        const result = await db.query(`
            SELECT 
                b.id, 
                b.name, 
                b.cart_enabled as branch_cart_enabled,
                b.cart_override,
                b.cart_settings as branch_cart_settings,
                o.cart_enabled as brand_cart_enabled,
                o.cart_settings as brand_cart_settings,
                CASE 
                    WHEN b.cart_override = true THEN b.cart_enabled
                    ELSE COALESCE(b.cart_enabled, o.cart_enabled, true)
                END as effective_cart_enabled
            FROM branches b
            JOIN brands o ON b.brand_id = o.id
            WHERE b.id = $1
        `, [branchId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Şube bulunamadı' });
        }
        
        const branch = result.rows[0];
        res.json({
            ...branch,
            branch_cart_settings: branch.branch_cart_settings || {
                min_order_amount: 0,
                max_order_amount: null,
                delivery_fee: 0,
                payment_methods: ['cash', 'card'],
                auto_approve_orders: false,
                order_time_limit: 30
            },
            brand_cart_settings: branch.brand_cart_settings || {
                min_order_amount: 0,
                max_order_amount: null,
                delivery_fee: 0,
                payment_methods: ['cash', 'card'],
                auto_approve_orders: false,
                order_time_limit: 30
            }
        });
    } catch (err) {
        console.error('Şube sepet ayarları alınırken hata:', err);
        res.status(500).json({ error: 'Ayarlar alınamadı' });
    }
});

// PUT /api/cart-settings/brand/:brandId - Marka sepet ayarlarını güncelle
router.put('/brand/:brandId', authorize(['super_admin', 'brand_manager']), async (req, res) => {
    try {
        const { brandId } = req.params;
        const { cart_enabled, cart_settings } = req.body;
        
        // Authorization check for brand managers
        if (req.user.role === 'brand_manager' && req.user.brand_id !== parseInt(brandId)) {
            return res.status(403).json({ error: 'Bu markanın ayarlarını güncelleme yetkiniz yok' });
        }
        
        const result = await db.query(`
            UPDATE brands
            SET cart_enabled = $1,
                cart_settings = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING id, name, cart_enabled, cart_settings
        `, [
            cart_enabled !== undefined ? cart_enabled : true,
            cart_settings ? JSON.stringify(cart_settings) : '{}',
            brandId
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marka bulunamadı' });
        }
        
        res.json({
            success: true,
            message: 'Marka sepet ayarları güncellendi',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Marka sepet ayarları güncellenirken hata:', err);
        res.status(500).json({ error: 'Ayarlar güncellenemedi' });
    }
});

// PUT /api/cart-settings/branch/:branchId - Şube sepet ayarlarını güncelle
router.put('/branch/:branchId', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const { branchId } = req.params;
        const { cart_enabled, cart_override, cart_settings } = req.body;
        
        // Authorization check for branch managers
        if (req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(branchId)) {
            return res.status(403).json({ error: 'Bu şubenin ayarlarını güncelleme yetkiniz yok' });
        }
        
        // Authorization check for brand managers
        if (req.user.role === 'brand_manager') {
            const branchResult = await db.query(
                'SELECT brand_id FROM branches WHERE id = $1',
                [branchId]
            );
            if (branchResult.rows.length === 0 || branchResult.rows[0].brand_id !== req.user.brand_id) {
                return res.status(403).json({ error: 'Bu şubenin ayarlarını güncelleme yetkiniz yok' });
            }
        }
        
        const result = await db.query(`
            UPDATE branches
            SET cart_enabled = $1,
                cart_override = $2,
                cart_settings = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING id, name, cart_enabled, cart_override, cart_settings
        `, [
            cart_enabled !== undefined ? cart_enabled : null,
            cart_override !== undefined ? cart_override : false,
            cart_settings ? JSON.stringify(cart_settings) : '{}',
            branchId
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Şube bulunamadı' });
        }
        
        res.json({
            success: true,
            message: 'Şube sepet ayarları güncellendi',
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Şube sepet ayarları güncellenirken hata:', err);
        res.status(500).json({ error: 'Ayarlar güncellenemedi' });
    }
});

// GET /api/cart-settings/check/:branchId - QR menü için sepet durumunu kontrol et
router.get('/check/:branchId', async (req, res) => {
    try {
        const { branchId } = req.params;
        
        const result = await db.query(`
            SELECT effective_cart_enabled as cart_enabled
            FROM branch_cart_status
            WHERE branch_id = $1
        `, [branchId]);
        
        if (result.rows.length === 0) {
            return res.json({ cart_enabled: true }); // Varsayılan olarak sepet açık
        }
        
        res.json({ cart_enabled: result.rows[0].cart_enabled });
    } catch (err) {
        console.error('Sepet durumu kontrol edilirken hata:', err);
        res.status(500).json({ error: 'Durum kontrol edilemedi' });
    }
});

module.exports = router;