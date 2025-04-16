const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// GET /api/dashboard - Dashboard verileri
router.get('/', authorize(['super_admin', 'admin']), async (req, res) => {
    try {
        // Temel sayılar
        const stats = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM brands) as total_brands,
                (SELECT COUNT(*) FROM branches) as total_branches,
                (SELECT COUNT(*) FROM products WHERE is_deleted = false) as total_products,
                (SELECT COUNT(*) FROM orders) as total_orders,
                (SELECT COUNT(*) FROM categories) as total_categories
        `);

        // Son 5 siparişi getir
        const recentOrders = await db.query(`
            SELECT id, name, table_number, total_price, created_at,
                  'Tamamlandı' as status  -- Frontend'in status beklediği için sabit bir değer ekledik
            FROM orders
            ORDER BY created_at DESC
            LIMIT 5
        `);

        // Tüm markaları getir
        const brands = await db.query(`
            SELECT id, name, logo_url, is_active
            FROM brands
            WHERE is_active = true
            ORDER BY name ASC
        `);

        // Popüler ürünleri getir
        const popularProducts = await db.query(`
            SELECT p.id, p.name, p.price, c.name as category_name,
                  COUNT(oi.product_id) as order_count
            FROM products p
            LEFT JOIN order_items oi ON p.id = oi.product_id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.is_deleted = false
            GROUP BY p.id, p.name, p.price, c.name
            ORDER BY order_count DESC
            LIMIT 5
        `);

        res.json({
            stats: stats.rows[0],
            recentOrders: recentOrders.rows,
            brands: brands.rows,
            popularProducts: popularProducts.rows
        });
    } catch (err) {
        console.error('Dashboard verileri yüklenirken hata:', err.message);
        res.status(500).json({ error: 'Veriler yüklenemedi', details: err.message });
    }
});

module.exports = router;