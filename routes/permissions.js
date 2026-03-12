const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// Kullanıcı yetkilerini getir
router.get('/users/:id/permissions', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Kullanıcı bilgilerini ve yetkilerini al
    const userResult = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.role,
        u.branch_id,
        u.brand_id,
        u.is_active,
        b.name as branch_name,
        br.name as brand_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      LEFT JOIN brands br ON u.brand_id = br.id
      WHERE u.id = $1
    `, [id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    }
    
    const user = userResult.rows[0];
    
    // Kullanıcının erişebileceği branch'leri al
    const accessibleBranches = await db.query(`
      SELECT 
        b.id,
        b.name,
        br.name as brand_name,
        CASE 
          WHEN ub.user_id IS NOT NULL THEN true 
          ELSE false 
        END as has_access
      FROM branches b
      LEFT JOIN brands br ON b.brand_id = br.id
      LEFT JOIN user_branches ub ON b.id = ub.branch_id AND ub.user_id = $1
      WHERE 
        CASE 
          WHEN $2 = 'super_admin' THEN true
          WHEN $2 = 'brand_manager' THEN b.brand_id = $3
          WHEN $2 = 'branch_manager' THEN b.id = $4
          ELSE false
        END
      ORDER BY br.name, b.name
    `, [id, user.role, user.brand_id, user.branch_id]);
    
    // Kullanıcının erişebileceği brand'leri al
    const accessibleBrands = await db.query(`
      SELECT 
        br.id,
        br.name,
        CASE 
          WHEN ubr.user_id IS NOT NULL THEN true 
          ELSE false 
        END as has_access
      FROM brands br
      LEFT JOIN user_brands ubr ON br.id = ubr.brand_id AND ubr.user_id = $1
      WHERE 
        CASE 
          WHEN $2 = 'super_admin' THEN true
          WHEN $2 = 'brand_manager' THEN br.id = $3
          ELSE false
        END
      ORDER BY br.name
    `, [id, user.role, user.brand_id]);
    
    res.json({
      user,
      accessibleBranches: accessibleBranches.rows,
      accessibleBrands: accessibleBrands.rows
    });
    
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({ message: 'Kullanıcı yetkileri alınırken hata oluştu' });
  }
});

// Kullanıcı yetkilerini güncelle
router.put('/users/:id/permissions', authorize(['super_admin']), async (req, res) => {
  const client = await db.getClient();
  
  try {
    const { id } = req.params;
    const { role, branch_id, brand_id } = req.body;
    
    await client.query('BEGIN');
    
    // 1. Users tablosunu güncelle
    const updateUser = await client.query(`
      UPDATE users 
      SET 
        role = COALESCE($1, role),
        branch_id = $2,
        brand_id = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [role, branch_id || null, brand_id || null, id]);
    
    if (updateUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    }
    
    const updatedUser = updateUser.rows[0];
    
    // 2. user_branches tablosunu güncelle
    await client.query('DELETE FROM user_branches WHERE user_id = $1', [id]);
    
    if (branch_id) {
      await client.query(`
        INSERT INTO user_branches (user_id, branch_id, role)
        VALUES ($1, $2, $3)
      `, [id, branch_id, role]);
    }
    
    // 3. user_brands tablosunu güncelle
    await client.query('DELETE FROM user_brands WHERE user_id = $1', [id]);
    
    if (brand_id && role === 'brand_manager') {
      await client.query(`
        INSERT INTO user_brands (user_id, brand_id, role)
        VALUES ($1, $2, $3)
      `, [id, brand_id, role]);
    }
    
    await client.query('COMMIT');
    
    // Güncellenmiş yetkileri getir
    const permissions = await db.query(`
      SELECT * FROM user_permissions WHERE user_id = $1
    `, [id]);
    
    res.json({
      message: 'Kullanıcı yetkileri güncellendi',
      user: updatedUser,
      permissions: permissions.rows[0]
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user permissions:', error);
    res.status(500).json({ message: 'Kullanıcı yetkileri güncellenirken hata oluştu' });
  } finally {
    client.release();
  }
});

// Tüm roller
router.get('/roles', authorize(['super_admin']), async (req, res) => {
  res.json([
    { value: 'super_admin', label: 'Süper Admin', description: 'Tüm sisteme erişim' },
    { value: 'brand_manager', label: 'Brand Yöneticisi', description: 'Brand ve tüm şubelerine erişim' },
    { value: 'branch_manager', label: 'Şube Yöneticisi', description: 'Sadece kendi şubesine erişim' }
  ]);
});

// Tüm kullanıcıları detaylı bilgilerle getir
router.get('/users', authorize(['super_admin']), async (req, res) => {
  try {
    const users = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.full_name,
        u.role,
        u.is_active,
        u.created_at,
        u.last_login,
        u.branch_id,
        u.brand_id,
        b.name as branch_name,
        br.name as brand_name,
        (SELECT COUNT(*) FROM user_brands WHERE user_id = u.id) as brand_count,
        (SELECT COUNT(*) FROM user_branches WHERE user_id = u.id) as branch_count
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      LEFT JOIN brands br ON u.brand_id = br.id
      WHERE u.id != $1
      ORDER BY u.created_at DESC
    `, [req.user.id]); // Kendisi hariç
    
    res.json(users.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Kullanıcılar alınırken hata oluştu' });
  }
});

// Tüm brandleri getir
router.get('/brands', authorize(['super_admin']), async (req, res) => {
  try {
    const brands = await db.query(`
      SELECT 
        b.id,
        b.name,
        b.is_active,
        COUNT(DISTINCT br.id) as branch_count,
        COUNT(DISTINCT ub.user_id) as user_count
      FROM brands b
      LEFT JOIN branches br ON b.id = br.brand_id
      LEFT JOIN user_brands ub ON b.id = ub.brand_id
      GROUP BY b.id, b.name, b.is_active
      ORDER BY b.name
    `);
    
    res.json(brands.rows);
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ message: 'Markalar alınırken hata oluştu' });
  }
});

// Tüm şubeleri getir
router.get('/branches', authorize(['super_admin']), async (req, res) => {
  try {
    const branches = await db.query(`
      SELECT 
        b.id,
        b.name,
        b.brand_id,
        br.name as brand_name,
        b.is_active,
        COUNT(DISTINCT ub.user_id) as user_count
      FROM branches b
      LEFT JOIN brands br ON b.brand_id = br.id
      LEFT JOIN user_branches ub ON b.id = ub.branch_id
      GROUP BY b.id, b.name, b.brand_id, br.name, b.is_active
      ORDER BY br.name, b.name
    `);
    
    res.json(branches.rows);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ message: 'Şubeler alınırken hata oluştu' });
  }
});

// Kullanıcının brand erişimlerini güncelle
router.put('/users/:id/brands', authorize(['super_admin']), async (req, res) => {
  const client = await db.getClient();
  
  try {
    const { id } = req.params;
    const { brand_ids } = req.body; // Array of brand IDs
    
    await client.query('BEGIN');
    
    // Mevcut brand erişimlerini temizle
    await client.query('DELETE FROM user_brands WHERE user_id = $1', [id]);
    
    // Yeni brand erişimlerini ekle
    for (const brand_id of brand_ids) {
      await client.query(`
        INSERT INTO user_brands (user_id, brand_id, role)
        VALUES ($1, $2, 'brand_manager')
      `, [id, brand_id]);
    }
    
    await client.query('COMMIT');
    
    res.json({ message: 'Brand erişimleri güncellendi' });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user brands:', error);
    res.status(500).json({ message: 'Brand erişimleri güncellenirken hata oluştu' });
  } finally {
    client.release();
  }
});

// Kullanıcının şube erişimlerini güncelle
router.put('/users/:id/branches', authorize(['super_admin']), async (req, res) => {
  const client = await db.getClient();
  
  try {
    const { id } = req.params;
    const { branch_ids } = req.body; // Array of branch IDs
    
    await client.query('BEGIN');
    
    // Mevcut şube erişimlerini temizle
    await client.query('DELETE FROM user_branches WHERE user_id = $1', [id]);
    
    // Yeni şube erişimlerini ekle
    for (const branch_id of branch_ids) {
      await client.query(`
        INSERT INTO user_branches (user_id, branch_id, role)
        VALUES ($1, $2, 'branch_manager')
      `, [id, branch_id]);
    }
    
    await client.query('COMMIT');
    
    res.json({ message: 'Şube erişimleri güncellendi' });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user branches:', error);
    res.status(500).json({ message: 'Şube erişimleri güncellenirken hata oluştu' });
  } finally {
    client.release();
  }
});

// Kullanıcı durumunu değiştir (aktif/pasif)
router.patch('/users/:id/status', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    const result = await db.query(`
      UPDATE users 
      SET is_active = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, username, is_active
    `, [is_active, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı' });
    }
    
    res.json({
      message: is_active ? 'Kullanıcı aktifleştirildi' : 'Kullanıcı pasifleştirildi',
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ message: 'Kullanıcı durumu güncellenirken hata oluştu' });
  }
});

module.exports = router;