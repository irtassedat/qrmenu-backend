// Kullanıcı yönetimi rotaları
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { authorize } = require('./auth');

// Tüm kullanıcıları getir - Sadece Super Admin
router.get('/', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.username, u.email, u.role, u.is_active, 
      u.created_at, u.last_login, u.branch_id, b.name as branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
      ORDER BY u.created_at DESC
    `);
    
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
      u.created_at, u.last_login, u.branch_id, b.name as branch_name
      FROM users u
      LEFT JOIN branches b ON u.branch_id = b.id
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
    const { username, email, password, role, branch_id, is_active } = req.body;
    
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
    
    // Branch Manager rolündeki kullanıcılar için şube ID'si zorunlu
    if (role === 'branch_manager' && !branch_id) {
      return res.status(400).json({ error: 'Şube yöneticisi için şube seçimi zorunludur' });
    }
    
    // Kullanıcıyı ekle
    const result = await db.query(`
      INSERT INTO users (username, email, password, role, branch_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, email, role, branch_id, is_active, created_at
    `, [username, email, hashedPassword, role, branch_id, is_active || true]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Kullanıcı eklenirken hata:', err.message);
    res.status(500).json({ error: 'Kullanıcı eklenemedi' });
  }
});

// Kullanıcı güncelle
router.put('/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, branch_id, is_active } = req.body;
    
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
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCounter}`);
      values.push(is_active);
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
      RETURNING id, username, email, role, branch_id, is_active, updated_at
    `, values);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kullanıcı güncellenirken hata:', err.message);
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

module.exports = router;