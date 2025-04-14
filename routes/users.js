// routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { authorize } = require('./auth');

// Tüm kullanıcıları getir - Şube ID'sine göre filtreleme opsiyonlu
router.get('/', authorize(['super_admin']), async (req, res) => {
  try {
    const { branch_id, brand_id, role, is_active } = req.query;
    
    // Temel sorgu
    let query = `
      SELECT u.id, u.username, u.email, u.role, u.is_active, 
      u.full_name, u.phone, u.created_at, u.last_login, u.branch_id, u.brand_id,
      b.name as branch_name, br.name as brand_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      LEFT JOIN brands br ON u.brand_id = br.id
      WHERE 1=1
    `;
    
    // Parametreler için array
    const queryParams = [];
    let paramCounter = 1;
    
    // Şubeye göre filtreleme
    if (branch_id) {
      query += ` AND u.branch_id = $${paramCounter}`;
      queryParams.push(branch_id);
      paramCounter++;
    }
    
    // Markaya göre filtreleme
    if (brand_id) {
      query += ` AND u.brand_id = $${paramCounter}`;
      queryParams.push(brand_id);
      paramCounter++;
    }
    
    // Role göre filtreleme
    if (role) {
      query += ` AND u.role = $${paramCounter}`;
      queryParams.push(role);
      paramCounter++;
    }
    
    // Aktiflik durumuna göre filtreleme
    if (is_active !== undefined) {
      query += ` AND u.is_active = $${paramCounter}`;
      queryParams.push(is_active === 'true');
      paramCounter++;
    }
    
    // Sıralama
    query += ` ORDER BY u.created_at DESC`;
    
    const result = await db.query(query, queryParams);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Kullanıcılar alınırken hata:', err.message);
    res.status(500).json({ error: 'Kullanıcılar alınamadı' });
  }
});

// Kullanıcı detaylarını getir
router.get('/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT u.id, u.username, u.email, u.role, u.is_active, 
      u.full_name, u.phone, u.created_at, u.last_login, 
      u.branch_id, u.brand_id, b.name as branch_name, br.name as brand_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      LEFT JOIN brands br ON u.brand_id = br.id
      WHERE u.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kullanıcı detayları alınırken hata:', err.message);
    res.status(500).json({ error: 'Kullanıcı detayları alınamadı' });
  }
});

// Yeni kullanıcı ekle
router.post('/', authorize(['super_admin']), async (req, res) => {
  try {
    const { 
      username, email, password, role, 
      branch_id, brand_id, is_active, 
      full_name, phone 
    } = req.body;
    
    // Kullanıcı adı veya e-posta adresi zaten var mı?
    const existingUser = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta adresi zaten kullanılıyor' });
    }
    
    // Şifreyi hashle
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Role değeri doğrulama - Sadece izin verilen roller
    const allowedRoles = ['super_admin', 'branch_manager'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Geçersiz rol' });
    }
    
    // Branch Manager rolündeki kullanıcılar için şube ve marka ID'si zorunlu
    if (role === 'branch_manager') {
      if (!branch_id) {
        return res.status(400).json({ error: 'Şube yöneticisi için şube seçimi zorunludur' });
      }
      
      if (!brand_id) {
        return res.status(400).json({ error: 'Şube yöneticisi için marka seçimi zorunludur' });
      }
      
      // Şubenin gerçekten seçilen markaya ait olup olmadığını kontrol et
      const branchCheck = await db.query(
        'SELECT * FROM branches WHERE id = $1 AND brand_id = $2',
        [branch_id, brand_id]
      );
      
      if (branchCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Seçilen şube belirtilen markaya ait değil' });
      }
    }
    
    // Kullanıcıyı ekle
    const result = await db.query(`
      INSERT INTO users (
        username, email, password, role, branch_id, brand_id, 
        is_active, full_name, phone, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      RETURNING id, username, email, role, branch_id, brand_id, 
                is_active, full_name, phone, created_at
    `, [
      username, 
      email, 
      hashedPassword, 
      role, 
      branch_id || null, 
      brand_id || null, 
      is_active || true, 
      full_name, 
      phone
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Kullanıcı eklenirken hata:', err.message);
    
    // Duplicate kullanıcı adı veya e-posta kontrolü
    if (err.code === '23505') { // PostgreSQL unique constraint violation kodu
      return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanımda' });
    }
    
    res.status(500).json({ error: 'Kullanıcı eklenemedi' });
  }
});

// Kullanıcı güncelle
router.put('/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      username, email, role, branch_id, brand_id, 
      is_active, full_name, phone 
    } = req.body;
    
    // Kullanıcı var mı?
    const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Kullanıcı adı veya e-posta çakışması kontrolü
    if (username || email) {
      const existingUser = await db.query(
        'SELECT id FROM users WHERE (username = $1 OR email = $2) AND id != $3',
        [username, email, id]
      );
      
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta adresi zaten kullanılıyor' });
      }
    }
    
    // Role değeri doğrulama - Sadece izin verilen roller
    if (role) {
      const allowedRoles = ['super_admin', 'branch_manager'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({ error: 'Geçersiz rol' });
      }
      
      // Branch Manager rolündeki kullanıcılar için şube ve marka ID'si zorunlu
      if (role === 'branch_manager') {
        if (!branch_id) {
          return res.status(400).json({ error: 'Şube yöneticisi için şube seçimi zorunludur' });
        }
        
        if (!brand_id) {
          return res.status(400).json({ error: 'Şube yöneticisi için marka seçimi zorunludur' });
        }
        
        // Şubenin gerçekten seçilen markaya ait olup olmadığını kontrol et
        const branchCheck = await db.query(
          'SELECT * FROM branches WHERE id = $1 AND brand_id = $2',
          [branch_id, brand_id]
        );
        
        if (branchCheck.rows.length === 0) {
          return res.status(400).json({ error: 'Seçilen şube belirtilen markaya ait değil' });
        }
      }
    }
    
    // Güncellenecek alanları ve değerlerini belirle
    const updates = [];
    const values = [];
    let paramCounter = 1;
    
    if (username) {
      updates.push(`username = $${paramCounter}`);
      values.push(username);
      paramCounter++;
    }
    
    if (email) {
      updates.push(`email = $${paramCounter}`);
      values.push(email);
      paramCounter++;
    }
    
    if (role) {
      updates.push(`role = $${paramCounter}`);
      values.push(role);
      paramCounter++;
    }
    
    // Branch_id değerini yalnızca tanımlıysa güncelle
    if (branch_id !== undefined) {
      updates.push(`branch_id = $${paramCounter}`);
      values.push(branch_id === null ? null : branch_id);
      paramCounter++;
    }
    
    // Brand_id değerini yalnızca tanımlıysa güncelle
    if (brand_id !== undefined) {
      updates.push(`brand_id = $${paramCounter}`);
      values.push(brand_id === null ? null : brand_id);
      paramCounter++;
    }
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCounter}`);
      values.push(is_active);
      paramCounter++;
    }
    
    if (full_name !== undefined) {
      updates.push(`full_name = $${paramCounter}`);
      values.push(full_name);
      paramCounter++;
    }
    
    if (phone !== undefined) {
      updates.push(`phone = $${paramCounter}`);
      values.push(phone);
      paramCounter++;
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    
    // Değişecek alan yoksa hata ver
    if (updates.length <= 1) {
      return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });
    }
    
    // ID'yi değerler listesine ekle
    values.push(id);
    
    // Güncelleme sorgusu
    const result = await db.query(`
      UPDATE users 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCounter}
      RETURNING id, username, email, role, branch_id, brand_id, 
                is_active, full_name, phone, updated_at
    `, values);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kullanıcı güncellenirken hata:', err.message);
    
    // Duplicate kullanıcı adı veya e-posta kontrolü
    if (err.code === '23505') { // PostgreSQL unique constraint violation kodu
      return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta zaten kullanımda' });
    }
    
    res.status(500).json({ error: 'Kullanıcı güncellenemedi' });
  }
});

// Kullanıcı şifresini sıfırla (Super Admin)
router.post('/:id/reset-password', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır' });
    }
    
    // Kullanıcı var mı?
    const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Şifreyi hashle
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Şifreyi güncelle
    await db.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, id]
    );
    
    res.json({ message: 'Şifre başarıyla sıfırlandı' });
  } catch (err) {
    console.error('Şifre sıfırlama hatası:', err.message);
    res.status(500).json({ error: 'Şifre sıfırlanamadı' });
  }
});

// Kullanıcı sil (soft delete)
router.delete('/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Kullanıcı var mı?
    const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Super admin kendini silemesin
    if (userCheck.rows[0].role === 'super_admin' && userCheck.rows[0].id === req.user.id) {
      return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
    }
    
    // Kullanıcıyı pasif yap
    await db.query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
    
    res.json({ message: 'Kullanıcı başarıyla silindi' });
  } catch (err) {
    console.error('Kullanıcı silinirken hata:', err.message);
    res.status(500).json({ error: 'Kullanıcı silinemedi' });
  }
});

// GET /api/users/me/branches → Kullanıcının erişebileceği şubeleri getir
router.get('/me/branches', authorize(), async (req, res) => {
  try {
    const user = req.user;
    let result;

    if (user.role === 'super_admin') {
      // Super admin tüm şubelere erişebilir
      result = await db.query('SELECT * FROM branches ORDER BY name');
    } else if (user.role === 'branch_manager' && user.branch_id) {
      // Şube yöneticisi sadece kendi şubesine erişebilir
      result = await db.query('SELECT * FROM branches WHERE id = $1', [user.branch_id]);
    } else {
      // Tanımsız rol veya branch_id yoksa boş liste döndür
      result = { rows: [] };
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Kullanıcı şubeleri alınırken hata:', err.message);
    res.status(500).json({ error: 'Şubeler getirilemedi' });
  }
});

// Markaya göre şubeleri getir - Kullanıcı oluşturma/düzenleme formunda kullanılabilir
router.get('/branches/by-brand/:brandId', authorize(['super_admin']), async (req, res) => {
  try {
    const { brandId } = req.params;
    
    // Marka var mı kontrol et
    const brand = await db.query('SELECT * FROM brands WHERE id = $1', [brandId]);
    
    if (brand.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    // Markaya ait şubeleri getir
    const branches = await db.query(
      `SELECT 
        branches.*, 
        brands.name AS brand_name
       FROM branches
       JOIN brands ON branches.brand_id = brands.id
       WHERE branches.brand_id = $1
       ORDER BY branches.name`,
      [brandId]
    );
    
    res.json(branches.rows);
  } catch (err) {
    console.error('Markaya göre şubeler alınırken hata:', err.message);
    res.status(500).json({ error: 'Şubeler getirilemedi' });
  }
});

// Tüm markaları getir - Kullanıcı oluşturma/düzenleme formunda kullanılabilir
router.get('/brands', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM brands ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Markalar alınırken hata:', err.message);
    res.status(500).json({ error: 'Markalar getirilemedi' });
  }
});

module.exports = router;