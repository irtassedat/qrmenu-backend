const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// Sistem ayarlarını getir
router.get('/system-settings', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT setting_key, setting_value FROM system_settings'
    );

    const settingsObj = {};
    result.rows.forEach(setting => {
      settingsObj[setting.setting_key] = setting.setting_value;
    });

    res.json(settingsObj);
  } catch (error) {
    console.error('Sistem ayarları getirme hatası:', error);
    res.status(500).json({ error: 'Sistem ayarları getirilemedi' });
  }
});

// Sistem ayarlarını güncelle
router.put('/system-settings', authorize(['super_admin']), async (req, res) => {
  try {
    const settings = req.body;

    for (const [key, value] of Object.entries(settings)) {
      await db.query(
        `INSERT INTO system_settings (setting_key, setting_value) 
         VALUES ($1, $2) 
         ON CONFLICT (setting_key) DO UPDATE SET 
         setting_value = EXCLUDED.setting_value, 
         updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
    }

    res.json({ message: 'Sistem ayarları güncellendi' });
  } catch (error) {
    console.error('Sistem ayarları güncelleme hatası:', error);
    res.status(500).json({ error: 'Sistem ayarları güncellenemedi' });
  }
});

// Kullanıcı limitlerini getir
router.get('/users/:userId/limits', authorize(['super_admin']), async (req, res) => {
  try {
    const userId = req.params.userId;

    // Kullanıcı bilgisini al
    const userResult = await db.query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const userRole = userResult.rows[0].role;

    // Kullanıcının özel limitlerini al
    const limitsResult = await db.query(
      'SELECT limit_type, limit_value FROM user_limits WHERE user_id = $1',
      [userId]
    );

    // Sistem varsayılanlarını al
    const settingsResult = await db.query(
      'SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE $1',
      ['default_%']
    );

    const defaultSettings = {};
    settingsResult.rows.forEach(setting => {
      defaultSettings[setting.setting_key] = parseInt(setting.setting_value);
    });

    // Rol bazlı varsayılan limitler
    const roleDefaults = {
      brand_owner: {
        max_branches_per_brand: defaultSettings.default_branch_limit || 5,
        max_users: defaultSettings.default_user_limit || 50,
        max_products: defaultSettings.default_product_limit || 500
      },
      branch_manager: {
        max_users: 10,
        discount_limit: 20
      },
      staff: {
        discount_limit: 0
      }
    };

    // Kullanıcının mevcut limitlerini varsayılanlarla birleştir
    const userLimits = roleDefaults[userRole] || {};
    
    limitsResult.rows.forEach(limit => {
      userLimits[limit.limit_type] = limit.limit_value;
    });

    res.json(userLimits);
  } catch (error) {
    console.error('Kullanıcı limitleri getirme hatası:', error);
    res.status(500).json({ error: 'Kullanıcı limitleri getirilemedi' });
  }
});

// Kullanıcı limitlerini güncelle
router.put('/users/:userId/limits', authorize(['super_admin']), async (req, res) => {
  try {
    const userId = req.params.userId;
    const limits = req.body;

    // Önce mevcut limitleri sil
    await db.query(
      'DELETE FROM user_limits WHERE user_id = $1',
      [userId]
    );

    // Yeni limitleri ekle
    for (const [limitType, limitValue] of Object.entries(limits)) {
      if (limitValue && limitValue > 0) {
        await db.query(
          'INSERT INTO user_limits (user_id, limit_type, limit_value, created_by) VALUES ($1, $2, $3, $4)',
          [userId, limitType, limitValue, req.user.id]
        );
      }
    }

    res.json({ message: 'Kullanıcı limitleri güncellendi' });
  } catch (error) {
    console.error('Kullanıcı limitleri güncelleme hatası:', error);
    res.status(500).json({ error: 'Kullanıcı limitleri güncellenemedi' });
  }
});

// Kullanıcının aktif limit durumunu kontrol et
router.get('/users/:userId/limit-status', authorize(['super_admin']), async (req, res) => {
  try {
    const userId = req.params.userId;

    // Kullanıcının şube sayısını al
    const branchCountResult = await db.query(
      `SELECT COUNT(*) as count FROM user_branches ub 
       JOIN branches b ON ub.branch_id = b.id 
       WHERE ub.user_id = $1 AND b.deleted_at IS NULL`,
      [userId]
    );

    // Kullanıcının limitini al
    const userLimitResult = await db.query(
      'SELECT limit_value FROM user_limits WHERE user_id = $1 AND limit_type = $2',
      [userId, 'max_branches_per_brand']
    );

    // Varsayılan limiti al
    const defaultLimitResult = await db.query(
      'SELECT setting_value FROM system_settings WHERE setting_key = $1',
      ['default_branch_limit']
    );

    const currentLimit = userLimitResult.rows.length > 0 ? userLimitResult.rows[0].limit_value : 
                        (defaultLimitResult.rows.length > 0 ? parseInt(defaultLimitResult.rows[0].setting_value) : 5);

    res.json({
      current_branches: parseInt(branchCountResult.rows[0].count),
      max_branches: currentLimit,
      can_add_branch: parseInt(branchCountResult.rows[0].count) < currentLimit
    });
  } catch (error) {
    console.error('Limit durumu kontrol hatası:', error);
    res.status(500).json({ error: 'Limit durumu kontrol edilemedi' });
  }
});

module.exports = router;