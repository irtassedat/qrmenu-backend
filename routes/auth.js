// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'cesme-kahve-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

// Yetkilendirme middleware - Gelen istekleri kontrol eder
const authorize = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      // Token'ı al
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Kimlik doğrulama gerekli' });
      }

      const token = authHeader.split(' ')[1];
      
      // Token'ı doğrula
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Kullanıcı bilgilerini veritabanından al - brand_id eklendi
      const userQuery = await db.query(
        'SELECT id, username, role, branch_id, brand_id FROM users WHERE id = $1',
        [decoded.userId]
      );
      
      if (userQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
      }
      
      const user = userQuery.rows[0];
      
      // Rol kontrolü
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
      }
      
      // Kullanıcı bilgilerini isteğe ekle
      req.user = user;
      
      next();
    } catch (err) {
      console.error('Yetkilendirme hatası:', err.message);
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Oturum süresi doldu, lütfen tekrar giriş yapın' });
      }
      res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
  };
};

// Giriş işlemi
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Giriş denemesini loglayalım (canlı ortamda kaldırılmalı)
    console.log('Giriş denemesi:', { username, passwordVar: !!password });
    
    // Kullanıcıyı veritabanında arayalım - Şube ve marka bilgilerini dahil et
    const result = await db.query(
      `SELECT u.*, 
       b.name as branch_name, 
       br.name as brand_name
       FROM users u 
       LEFT JOIN branches b ON u.branch_id = b.id
       LEFT JOIN brands br ON u.brand_id = br.id
       WHERE u.username = $1`,
      [username]
    );
    
    if (result.rows.length === 0) {
      console.log('Kullanıcı bulunamadı');
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    }
    
    const user = result.rows[0];
    console.log('Kullanıcı bulundu:', { id: user.id, usernameFromDB: user.username });
    
    // Şifreleri karşılaştıralım
    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log('Şifre karşılaştırma sonucu:', passwordMatch);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    }
    
    // Kullanıcı aktif mi kontrol edelim
    if (!user.is_active) {
      return res.status(401).json({ error: 'Hesabınız devre dışı bırakılmıştır' });
    }
    
    // Son giriş zamanını güncelleyelim
    await db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );
    
    // JWT token oluşturalım - brand_id eklendi
    const token = jwt.sign(
      { 
        userId: user.id,
        role: user.role,
        branch_id: user.branch_id,
        brand_id: user.brand_id
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    // Kullanıcı bilgilerini döndürelim (şifre hariç)
    delete user.password;
    
    res.json({
      user,
      token,
      expiresIn: JWT_EXPIRES_IN
    });
    
  } catch (err) {
    console.error('Login hatası:', err);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
  }
});

// Kullanıcı bilgilerini alma - Marka bilgisi eklendi
router.get('/me', authorize(), async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await db.query(
      `SELECT u.id, u.username, u.email, u.role, 
      u.branch_id, u.brand_id, u.full_name, u.phone,
      b.name as branch_name, br.name as brand_name,
      u.created_at, u.last_login
      FROM users u 
      LEFT JOIN branches b ON u.branch_id = b.id
      LEFT JOIN brands br ON u.brand_id = br.id
      WHERE u.id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Kullanıcı bilgileri alınırken hata:', err.message);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Şifre değiştirme
router.put('/change-password', authorize(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    // Mevcut şifreyi kontrol et
    const user = await db.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );
    
    const passwordMatch = await bcrypt.compare(currentPassword, user.rows[0].password);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Mevcut şifre yanlış' });
    }
    
    // Şifreyi hashle
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Şifreyi güncelle
    await db.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, userId]
    );
    
    res.json({ message: 'Şifre başarıyla değiştirildi' });
    
  } catch (err) {
    console.error('Şifre değiştirme hatası:', err.message);
    res.status(500).json({ error: 'Şifre değiştirme sırasında bir hata oluştu' });
  }
});

module.exports = { router, authorize };