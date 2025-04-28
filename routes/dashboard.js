// routes/dashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// Dashboard verileri - yetkilendirme ekle
router.get('/', authorize(['super_admin', 'branch_manager']), async (req, res) => {
  try {
    // Kullanıcı bilgisini al
    const user = req.user;
    let dashboardData;
    
    if (user.role === 'super_admin') {
      // Super admin tüm verileri görebilir
      dashboardData = await getSuperAdminDashboard();
    } else if (user.role === 'branch_manager') {
      // Branch manager sadece kendi şubesinin verilerini görebilir
      dashboardData = await getBranchManagerDashboard(user.branch_id);
    } else {
      return res.status(403).json({ error: 'Bu veriye erişim yetkiniz yok' });
    }
    
    res.json(dashboardData);
  } catch (err) {
    console.error('Dashboard verileri alınırken hata:', err.message);
    res.status(500).json({ error: 'Dashboard verileri alınamadı' });
  }
});

// Super Admin dashboard verileri
async function getSuperAdminDashboard() {
  try {
    // Marka ve şube sayıları
    const brandsCount = await db.query('SELECT COUNT(*) FROM brands');
    const branchesCount = await db.query('SELECT COUNT(*) FROM branches');
    
    // Toplam sipariş
    const ordersCount = await db.query('SELECT COUNT(*) FROM orders');
    
    // total_price sütununu kullan
    let totalRevenue = 0;
    try {
      const revenueResult = await db.query('SELECT SUM(total_price) FROM orders');
      totalRevenue = parseFloat(revenueResult.rows[0].sum || 0);
    } catch (error) {
      console.warn('Gelir hesaplanamadı:', error.message);
    }
    
    // Aktif ürün sayısı
    const productsCount = await db.query('SELECT COUNT(*) FROM products WHERE is_deleted = false');
    
    // Son 5 sipariş
    const recentOrders = await db.query(`
      SELECT o.*, b.name as branch_name 
      FROM orders o
      JOIN branches b ON o.branch_id = b.id
      ORDER BY o.created_at DESC
      LIMIT 5
    `);
    
    return {
      stats: {
        brands: parseInt(brandsCount.rows[0].count),
        branches: parseInt(branchesCount.rows[0].count),
        orders: parseInt(ordersCount.rows[0].count),
        revenue: totalRevenue,
        products: parseInt(productsCount.rows[0].count)
      },
      recentOrders: recentOrders.rows
    };
  } catch (err) {
    console.error('Super Admin dashboard verileri alınırken hata:', err);
    return {
      stats: {
        brands: 0,
        branches: 0,
        orders: 0,
        revenue: 0,
        products: 0
      },
      recentOrders: []
    };
  }
}

// Branch Manager dashboard verileri
async function getBranchManagerDashboard(branchId) {
  try {
    // Şube bilgileri
    const branch = await db.query('SELECT * FROM branches WHERE id = $1', [branchId]);
    
    // Sipariş ve gelir bilgileri
    const ordersCount = await db.query(
      'SELECT COUNT(*) FROM orders WHERE branch_id = $1',
      [branchId]
    );
    
    // total_price sütununu kullan
    let totalRevenue = 0;
    try {
      const revenueResult = await db.query(
        'SELECT SUM(total_price) FROM orders WHERE branch_id = $1',
        [branchId]
      );
      totalRevenue = parseFloat(revenueResult.rows[0].sum || 0);
    } catch (error) {
      console.warn('Şube geliri hesaplanamadı:', error.message);
    }
    
    // Aktif ürün sayısı
    const productsCount = await db.query(`
      SELECT COUNT(*) 
      FROM branch_products bp
      JOIN products p ON bp.product_id = p.id
      WHERE bp.branch_id = $1 AND bp.is_visible = true AND p.is_deleted = false`,
      [branchId]
    );
    
    // Son 5 sipariş
    const recentOrders = await db.query(`
      SELECT o.* 
      FROM orders o
      WHERE o.branch_id = $1
      ORDER BY o.created_at DESC
      LIMIT 5
    `, [branchId]);
    
    return {
      stats: {
        branch: branch.rows[0] || null,
        orders: parseInt(ordersCount.rows[0].count),
        revenue: totalRevenue,
        products: parseInt(productsCount.rows[0].count || 0)
      },
      recentOrders: recentOrders.rows || []
    };
  } catch (err) {
    console.error('Branch Manager dashboard verileri alınırken hata:', err);
    return {
      stats: {
        branch: null,
        orders: 0,
        revenue: 0,
        products: 0
      },
      recentOrders: []
    };
  }
}

module.exports = router;