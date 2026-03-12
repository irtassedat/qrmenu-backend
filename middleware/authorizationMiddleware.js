const db = require('../db');

// Kullanıcının brand'e erişim yetkisi var mı?
const checkBrandAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Super admin her şeye erişebilir
    if (userRole === 'super_admin') {
      return next();
    }
    
    // Brand ID'yi al (params, body veya query'den)
    const brandId = req.params.brandId || req.body.brand_id || req.query.brand_id;
    
    if (!brandId) {
      return res.status(400).json({ error: 'Brand ID gerekli' });
    }
    
    // Kullanıcının bu brand'e erişimi var mı?
    const result = await db.query(
      'SELECT role FROM user_brands WHERE user_id = $1 AND brand_id = $2',
      [userId, brandId]
    );
    
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Bu markaya erişim yetkiniz yok' });
    }
    
    // Kullanıcının brand'deki rolünü request'e ekle
    req.userBrandRole = result.rows[0].role;
    next();
  } catch (error) {
    console.error('Brand yetkilendirme hatası:', error);
    res.status(500).json({ error: 'Yetkilendirme hatası' });
  }
};

// Kullanıcının branch'e erişim yetkisi var mı?
const checkBranchAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Super admin her şeye erişebilir
    if (userRole === 'super_admin') {
      return next();
    }
    
    // Branch ID'yi al
    const branchId = req.params.branchId || req.body.branch_id || req.query.branch_id;
    
    if (!branchId) {
      return res.status(400).json({ error: 'Branch ID gerekli' });
    }
    
    // Önce branch'in hangi brand'e ait olduğunu bul
    const branchResult = await db.query(
      'SELECT brand_id FROM branches WHERE id = $1',
      [branchId]
    );
    
    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    const brandId = branchResult.rows[0].brand_id;
    
    // 1. Kullanıcının brand erişimi var mı?
    const brandAccess = await db.query(
      'SELECT role FROM user_brands WHERE user_id = $1 AND brand_id = $2',
      [userId, brandId]
    );
    
    // 2. Kullanıcının direkt branch erişimi var mı?
    const branchAccess = await db.query(
      'SELECT role, permissions FROM user_branches WHERE user_id = $1 AND branch_id = $2',
      [userId, branchId]
    );
    
    // Brand yöneticisi tüm branch'lere erişebilir
    if (brandAccess.rows.length > 0 && brandAccess.rows[0].role === 'brand_manager') {
      req.userBranchRole = 'brand_manager';
      return next();
    }
    
    // Direkt branch erişimi
    if (branchAccess.rows.length > 0) {
      req.userBranchRole = branchAccess.rows[0].role;
      req.userPermissions = branchAccess.rows[0].permissions || {};
      return next();
    }
    
    return res.status(403).json({ error: 'Bu şubeye erişim yetkiniz yok' });
  } catch (error) {
    console.error('Branch yetkilendirme hatası:', error);
    res.status(500).json({ error: 'Yetkilendirme hatası' });
  }
};

// Belirli bir izni kontrol et
const checkPermission = (permission) => {
  return (req, res, next) => {
    const userRole = req.user.role;
    
    // Super admin ve brand manager her şeye erişebilir
    if (userRole === 'super_admin' || req.userBrandRole === 'brand_manager') {
      return next();
    }
    
    // Kullanıcının izinlerini kontrol et
    const permissions = req.userPermissions || {};
    
    if (!permissions[permission]) {
      return res.status(403).json({ 
        error: `Bu işlem için yetkiniz yok: ${permission}` 
      });
    }
    
    next();
  };
};

// Kullanıcının erişebileceği brand'leri getir
const getUserBrands = async (userId, userRole) => {
  if (userRole === 'super_admin') {
    // Super admin tüm brand'leri görebilir
    const result = await db.query('SELECT * FROM brands ORDER BY name');
    return result.rows;
  }
  
  // Normal kullanıcı sadece yetkili olduğu brand'leri görebilir
  const result = await db.query(`
    SELECT b.*, ub.role as user_role
    FROM brands b
    JOIN user_brands ub ON b.id = ub.brand_id
    WHERE ub.user_id = $1
    ORDER BY b.name
  `, [userId]);
  
  return result.rows;
};

// Kullanıcının erişebileceği branch'leri getir
const getUserBranches = async (userId, userRole, brandId = null) => {
  let query;
  let params;
  
  if (userRole === 'super_admin') {
    // Super admin tüm branch'leri görebilir
    query = brandId 
      ? 'SELECT * FROM branches WHERE brand_id = $1 ORDER BY name'
      : 'SELECT * FROM branches ORDER BY name';
    params = brandId ? [brandId] : [];
  } else {
    // Normal kullanıcı için karmaşık sorgu
    query = `
      SELECT DISTINCT b.*, 
        CASE 
          WHEN ub2.id IS NOT NULL THEN ub2.role
          WHEN ub.role = 'brand_manager' THEN 'brand_manager'
          ELSE NULL
        END as user_role
      FROM branches b
      LEFT JOIN user_brands ub ON b.brand_id = ub.brand_id AND ub.user_id = $1
      LEFT JOIN user_branches ub2 ON b.id = ub2.branch_id AND ub2.user_id = $1
      WHERE (ub.id IS NOT NULL OR ub2.id IS NOT NULL)
      ${brandId ? 'AND b.brand_id = $2' : ''}
      ORDER BY b.name
    `;
    params = brandId ? [userId, brandId] : [userId];
  }
  
  const result = await db.query(query, params);
  return result.rows;
};

module.exports = {
  checkBrandAccess,
  checkBranchAccess,
  checkPermission,
  getUserBrands,
  getUserBranches
};