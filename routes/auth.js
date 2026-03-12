// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'cesme-kahve-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

// Test credentials - Production'da .env'de ENABLE_TEST_CREDENTIALS=false yaparak kapatılabilir
const ENABLE_TEST_CREDENTIALS = process.env.ENABLE_TEST_CREDENTIALS !== 'false';
const TEST_SUPERADMIN_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD || 'cesme123';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || 'test123';

let usersHasBrandIdColumnCache = null;

const usersHasBrandIdColumn = async () => {
  if (usersHasBrandIdColumnCache !== null) {
    return usersHasBrandIdColumnCache;
  }

  try {
    const result = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = 'brand_id'
       ) AS exists`
    );

    usersHasBrandIdColumnCache = Boolean(result.rows[0]?.exists);
    console.log('Auth schema check - users.brand_id exists:', usersHasBrandIdColumnCache);
  } catch (err) {
    console.error('Auth schema check failed, defaulting to fallback query:', err.message);
    usersHasBrandIdColumnCache = false;
  }

  return usersHasBrandIdColumnCache;
};

const getUserSelectByIdQuery = async () => {
  const hasBrandId = await usersHasBrandIdColumn();
  if (hasBrandId) {
    return 'SELECT id, username, role, branch_id, brand_id FROM users WHERE id = $1';
  }
  return `SELECT u.id, u.username, u.role, u.branch_id, b.brand_id
          FROM users u
          LEFT JOIN branches b ON u.branch_id = b.id
          WHERE u.id = $1`;
};

const getUserByUsernameQuery = async () => {
  const hasBrandId = await usersHasBrandIdColumn();
  if (hasBrandId) {
    return `SELECT u.*,
            b.name as branch_name,
            br.name as brand_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN brands br ON u.brand_id = br.id
            WHERE u.username = $1`;
  }
  return `SELECT u.*,
          b.name as branch_name,
          b.brand_id as brand_id,
          br.name as brand_name
          FROM users u
          LEFT JOIN branches b ON u.branch_id = b.id
          LEFT JOIN brands br ON b.brand_id = br.id
          WHERE u.username = $1`;
};

const getUserProfileByIdQuery = async () => {
  const hasBrandId = await usersHasBrandIdColumn();
  if (hasBrandId) {
    return `SELECT u.*,
            b.name as branch_name,
            br.name as brand_name,
            br.slug as brand_slug
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN brands br ON u.brand_id = br.id
            WHERE u.id = $1`;
  }
  return `SELECT u.*,
          b.name as branch_name,
          b.brand_id as brand_id,
          br.name as brand_name,
          br.slug as brand_slug
          FROM users u
          LEFT JOIN branches b ON u.branch_id = b.id
          LEFT JOIN brands br ON b.brand_id = br.id
          WHERE u.id = $1`;
};

// Helper: Kullanıcının gitmesi gereken default route'u belirle
const getDefaultRoute = (user) => {
  if (user.role === 'branch_manager' && user.branch_id) {
    return `/admin/branches/${user.branch_id}`;
  }
  if (user.role === 'brand_manager' && user.brand_id) {
    return `/admin/brands/${user.brand_id}/branches`;
  }
  if (user.role === 'super_admin') {
    return '/admin/brands';
  }
  return '/admin';
};

// Yetkilendirme middleware - Gelen istekleri kontrol eder
const authorize = (allowedRoles = []) => {
  return async (req, res, next) => {
    console.log(`=== AUTH DEBUG ===`);
    console.log(`${req.method} ${req.path}`);
    console.log(`Allowed roles:`, allowedRoles);
    
    try {
      // Token'ı al
      const authHeader = req.headers.authorization;
      console.log(`Auth header present:`, !!authHeader);
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log(`Auth failed: No valid Bearer token`);
        return res.status(401).json({ error: 'Kimlik doğrulama gerekli' });
      }

      const token = authHeader.split(' ')[1];
      
      // Token'ı doğrula
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Kullanıcı bilgilerini veritabanından al - brand_id eklendi
      const userQuery = await db.query(
        await getUserSelectByIdQuery(),
        [decoded.userId]
      );
      
      if (userQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
      }
      
      const user = userQuery.rows[0];
      
      // Rol kontrolü
      console.log(`User role: ${user.role}`);
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        console.log(`Auth failed: Role ${user.role} not in allowed roles:`, allowedRoles);
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
      }
      
      // Kullanıcı bilgilerini isteğe ekle
      req.user = user;
      console.log(`Auth success: User ${user.username} (${user.role})`);
      console.log(`=== AUTH DEBUG END ===`);
      
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
      await getUserByUsernameQuery(),
      [username]
    );
    
    if (result.rows.length === 0) {
      console.log('Kullanıcı bulunamadı');
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    }
    
    const user = result.rows[0];
    console.log('Kullanıcı bulundu:', { id: user.id, usernameFromDB: user.username });
    
    // Şifreleri karşılaştıralım
    let passwordMatch = false;

    // Test credentials kontrolü (ortam değişkeniyle kontrol edilir)
    if (ENABLE_TEST_CREDENTIALS) {
      if (user.username === 'cesmesuperadmin' && password === TEST_SUPERADMIN_PASSWORD) {
        console.log('Super admin test girişi: BAŞARILI (ENABLE_TEST_CREDENTIALS=true)');
        passwordMatch = true;
      } else if (user.username === 'alacatiqrtest' && password === TEST_USER_PASSWORD) {
        console.log('Test kullanıcısı girişi: BAŞARILI (ENABLE_TEST_CREDENTIALS=true)');
        passwordMatch = true;
      }
    }

    // Test credentials eşleşmediyse bcrypt kontrolü yap
    if (!passwordMatch) {
      try {
        passwordMatch = await bcrypt.compare(password, user.password);
      } catch (err) {
        console.error('Bcrypt karşılaştırma hatası:', err);
      }
    }
    
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
      expiresIn: JWT_EXPIRES_IN,
      defaultRoute: getDefaultRoute(user)
    });
    
  } catch (err) {
    console.error('Login hatası:', err);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu' });
  }
});


// Mevcut kullanıcı bilgilerini getir
router.get('/me', authorize(), async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Kullanıcı bilgilerini brand_name ve brand_slug ile birlikte getir
    const result = await db.query(
      await getUserProfileByIdQuery(),
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    const user = result.rows[0];
    delete user.password; // Şifreyi kaldır

    res.json({
      user: {
        ...user,
        defaultRoute: getDefaultRoute(user)
      }
    });
    
  } catch (err) {
    console.error('Kullanıcı bilgisi alma hatası:', err.message);
    res.status(500).json({ error: 'Kullanıcı bilgisi alınırken hata oluştu' });
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
