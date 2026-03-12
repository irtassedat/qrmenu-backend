// middleware/licenseCheck.js
const crypto = require('crypto');

// Master lisans anahtarı (sadece sizde olacak)
const MASTER_KEY = process.env.MASTER_LICENSE_KEY || '';
const LICENSE_EXPIRY = process.env.LICENSE_EXPIRY || '';

// Lisans kontrolü
const checkLicense = (req, res, next) => {
  try {
    // Lisans tarihi kontrolü
    if (LICENSE_EXPIRY) {
      const expiryDate = new Date(LICENSE_EXPIRY);
      const now = new Date();
      
      if (now > expiryDate) {
        return res.status(403).json({
          error: 'Lisans süresi dolmuş. Lütfen geliştirici ile iletişime geçin.',
          contact: 'sedatirtas@example.com'
        });
      }
    }
    
    // Demo mod kontrolü
    if (process.env.DEMO_MODE === 'true') {
      // Demo modda bazı özellikleri kısıtla
      req.isDemoMode = true;
      if (req.path.includes('admin/users/create') && !req.body.masterPassword) {
        return res.status(403).json({
          error: 'Demo modda bu özellik kısıtlıdır.'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Lisans kontrolü hatası:', error);
    next();
  }
};

// Master password kontrolü - Tüm kullanıcı işlemleri için
const checkMasterPassword = (req, res, next) => {
  // POST (oluşturma), PUT/PATCH (güncelleme) ve DELETE (silme) işlemlerini kontrol et
  const needsAuth = [
    { method: 'POST', path: '/api/users' },
    { method: 'PUT', path: /^\/api\/users\/\d+$/ },
    { method: 'PATCH', path: /^\/api\/users\/\d+$/ },
    { method: 'DELETE', path: /^\/api\/users\/\d+$/ }
  ];

  // Mevcut isteğin kontrole ihtiyacı var mı?
  const requiresPassword = needsAuth.some(rule => {
    if (req.method !== rule.method) return false;
    
    if (typeof rule.path === 'string') {
      return req.path === rule.path;
    } else if (rule.path instanceof RegExp) {
      return rule.path.test(req.path);
    }
    return false;
  });

  if (requiresPassword) {
    const masterPassword = req.headers['x-master-password'] || req.body.masterPassword;
    
    if (!masterPassword) {
      return res.status(403).json({
        error: 'Master şifre gerekli. Bu işlem için master şifreyi girin.'
      });
    }
    
    if (masterPassword !== process.env.MASTER_PASSWORD) {
      return res.status(403).json({
        error: 'Geçersiz master şifre. İşlem yapabilmek için doğru şifreyi girin.'
      });
    }
  }
  
  next();
};

module.exports = { checkLicense, checkMasterPassword };