const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// GET /api/dashboard - Dashboard verileri
router.get('/', authorize(['super_admin', 'admin', 'brand_manager', 'branch_manager']), async (req, res) => {
    try {
        const userRole = req.user.role;
        const userBranchId = req.user.branch_id;
        const userBrandId = req.user.brand_id;
        
        // Temel sayılar
        let statsQuery;
        if ((userRole === 'branch_manager' || userRole === 'brand_manager') && userBrandId) {
            // Şube/Brand yöneticisi için sadece kendi markasına ait veriler
            statsQuery = `
                SELECT 
                    (SELECT COUNT(*) FROM brands WHERE id = $1) as total_brands,
                    (SELECT COUNT(*) FROM branches WHERE brand_id = $1) as total_branches,
                    (SELECT COUNT(*) FROM products p 
                     JOIN branch_products bp ON p.id = bp.product_id 
                     WHERE bp.branch_id IN (SELECT id FROM branches WHERE brand_id = $1) 
                     AND p.is_deleted = false) as total_products,
                    (SELECT COUNT(*) FROM orders o 
                     WHERE o.branch_id IN (SELECT id FROM branches WHERE brand_id = $1)) as total_orders,
                    (SELECT COUNT(DISTINCT c.id) FROM categories c 
                     JOIN products p ON p.category_id = c.id 
                     JOIN branch_products bp ON p.id = bp.product_id 
                     WHERE bp.branch_id IN (SELECT id FROM branches WHERE brand_id = $1)) as total_categories
            `;
        } else {
            // Super admin için tüm veriler
            statsQuery = `
                SELECT 
                    (SELECT COUNT(*) FROM brands) as total_brands,
                    (SELECT COUNT(*) FROM branches) as total_branches,
                    (SELECT COUNT(*) FROM products WHERE is_deleted = false) as total_products,
                    (SELECT COUNT(*) FROM orders) as total_orders,
                    (SELECT COUNT(*) FROM categories) as total_categories
            `;
        }
        
        const stats = (userRole === 'branch_manager' || userRole === 'brand_manager') && userBrandId 
            ? await db.query(statsQuery, [userBrandId])
            : await db.query(statsQuery);

        // Son 5 siparişi getir
        let recentOrdersQuery;
        let recentOrdersParams = [];
        
        if ((userRole === 'branch_manager' || userRole === 'brand_manager') && userBrandId) {
            recentOrdersQuery = `
                SELECT id, name, table_number, total_price, created_at,
                      'Tamamlandı' as status
                FROM orders
                WHERE branch_id IN (SELECT id FROM branches WHERE brand_id = $1)
                ORDER BY created_at DESC
                LIMIT 5
            `;
            recentOrdersParams = [userBrandId];
        } else {
            recentOrdersQuery = `
                SELECT id, name, table_number, total_price, created_at,
                      'Tamamlandı' as status
                FROM orders
                ORDER BY created_at DESC
                LIMIT 5
            `;
        }
        
        const recentOrders = await db.query(recentOrdersQuery, recentOrdersParams);

        // Markaları getir
        let brandsQuery;
        let brandsParams = [];
        
        if ((userRole === 'branch_manager' || userRole === 'brand_manager') && userBrandId) {
            brandsQuery = `
                SELECT id, name, logo_url, is_active
                FROM brands
                WHERE is_active = true AND id = $1
                ORDER BY name ASC
            `;
            brandsParams = [userBrandId];
        } else {
            brandsQuery = `
                SELECT id, name, logo_url, is_active
                FROM brands
                WHERE is_active = true
                ORDER BY name ASC
            `;
        }
        
        const brands = await db.query(brandsQuery, brandsParams);

        // Popüler ürünleri getir
        let popularProductsQuery;
        let popularProductsParams = [];
        
        if ((userRole === 'branch_manager' || userRole === 'brand_manager') && userBrandId) {
            popularProductsQuery = `
                SELECT p.id, p.name, p.price, c.name as category_name,
                      COUNT(oi.product_id) as order_count
                FROM products p
                LEFT JOIN order_items oi ON p.id = oi.product_id
                LEFT JOIN categories c ON p.category_id = c.id
                JOIN branch_products bp ON p.id = bp.product_id
                WHERE p.is_deleted = false 
                AND bp.branch_id IN (SELECT id FROM branches WHERE brand_id = $1)
                GROUP BY p.id, p.name, p.price, c.name
                ORDER BY order_count DESC
                LIMIT 5
            `;
            popularProductsParams = [userBrandId];
        } else {
            popularProductsQuery = `
                SELECT p.id, p.name, p.price, c.name as category_name,
                      COUNT(oi.product_id) as order_count
                FROM products p
                LEFT JOIN order_items oi ON p.id = oi.product_id
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.is_deleted = false
                GROUP BY p.id, p.name, p.price, c.name
                ORDER BY order_count DESC
                LIMIT 5
            `;
        }
        
        const popularProducts = await db.query(popularProductsQuery, popularProductsParams);

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