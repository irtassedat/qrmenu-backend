const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authorize } = require('./auth');

// Kategori resimlerini yüklemek için multer konfigürasyonu
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = path.join(__dirname, '../public/category');
    // Dizin yoksa oluştur
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    // Dosya adını kategoriye göre ayarlayalım
    let filename = '';
    
    if (req.body.categoryName) {
      // Kategori adını URL-friendly formata çevir
      filename = req.body.categoryName
        .toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-]/g, '');
    } else {
      // Kategori adı yoksa timestamp kullan
      filename = Date.now();
    }
    
    // Dosya uzantısını ekle
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${filename}${ext}`);
  }
});

// Sadece resim dosyalarını kabul et
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF ve WebP formatları kabul edilir.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const parseBrandId = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const getUserBrandId = async (user) => {
  if (!user) return null;

  if (user.brand_id !== undefined && user.brand_id !== null) {
    const parsedBrandId = Number.parseInt(user.brand_id, 10);
    if (!Number.isNaN(parsedBrandId)) {
      return parsedBrandId;
    }
  }

  if (user.branch_id) {
    const branchResult = await db.query(
      'SELECT brand_id FROM branches WHERE id = $1 LIMIT 1',
      [user.branch_id]
    );

    if (branchResult.rows.length > 0) {
      return branchResult.rows[0].brand_id;
    }
  }

  return null;
};

// ✅ GET /api/categories → Tüm kategorileri getir
router.get('/', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    console.log('Kategoriler getiriliyor...');

    // Eğer includeHidden parametresi varsa tüm kategorileri getir (admin için)
    const includeHidden = req.query.includeHidden === 'true';
    const brandIdParam = req.query.brand_id ?? req.query.brandId;

    const requestedBrandId = parseBrandId(brandIdParam);
    if ((brandIdParam ?? '') !== '' && requestedBrandId === null) {
      return res.status(400).json({ error: 'Geçersiz brand_id parametresi' });
    }

    const userRole = req.user.role;
    const userBrandId = await getUserBrandId(req.user);

    if (requestedBrandId !== null && userRole !== 'super_admin') {
      if (!userBrandId) {
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }

      if (requestedBrandId !== userBrandId) {
        return res.status(403).json({ error: 'Farklı marka kategorilerine erişim yetkiniz yok' });
      }
    }

    let effectiveBrandId = requestedBrandId;
    if (effectiveBrandId === null && userRole !== 'super_admin') {
      if (!userBrandId) {
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }
      effectiveBrandId = userBrandId;
    }

    let query;
    let params = [];

    if (effectiveBrandId !== null) {
      query = 'SELECT * FROM categories WHERE brand_id = $1';
      params = [effectiveBrandId];

      if (!includeHidden) {
        query += ' AND is_visible = true';
      }
    } else {
      query = 'SELECT * FROM categories';
      if (!includeHidden) {
        query += ' WHERE is_visible = true';
      }
    }

    query += ' ORDER BY sort_order ASC, id ASC';

    const result = await db.query(query, params);

    // Cache busting için image_url'e sürüm ekle
    const categoriesWithCacheBusting = result.rows.map(category => {
      if (category.image_url) {
        const separator = category.image_url.includes('?') ? '&' : '?';
        category.image_url = `${category.image_url}${separator}v=${category.image_version || 1}`;
      }
      return category;
    });
    
    console.log(`${categoriesWithCacheBusting.length} kategori bulundu`);
    res.json(categoriesWithCacheBusting);
  } catch (err) {
    console.error('Kategoriler alınırken hata:', err.message);
    res.status(500).json({ error: 'Kategoriler getirilemedi' });
  }
});

// ✅ POST /api/categories → Yeni kategori ekle (super_admin ve brand_manager)
router.post('/', authorize(['super_admin', 'brand_manager']), upload.single('media'), async (req, res) => {
  const { name, image_url, brand_id } = req.body;
  const cleanupUploadedFile = () => {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Yüklenen kategori görseli temizlenemedi:', cleanupError.message);
      }
    }
  };

  if (!name || !String(name).trim()) {
    cleanupUploadedFile();
    return res.status(400).json({ error: 'Kategori adı zorunludur' });
  }

  try {
    const trimmedName = String(name).trim();
    const userRole = req.user.role;
    const requesterBrandId = await getUserBrandId(req.user);
    const requestedBrandId = parseBrandId(brand_id);

    let targetBrandId = null;
    if (userRole === 'super_admin') {
      if (requestedBrandId === null) {
        cleanupUploadedFile();
        return res.status(400).json({ error: 'Super admin için brand_id zorunludur' });
      }
      targetBrandId = requestedBrandId;
    } else {
      if (!requesterBrandId) {
        cleanupUploadedFile();
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }
      targetBrandId = requesterBrandId;
    }

    const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [targetBrandId]);
    if (brandCheck.rows.length === 0) {
      cleanupUploadedFile();
      return res.status(400).json({ error: 'Geçersiz brand_id' });
    }

    const duplicateCheck = await db.query(
      'SELECT id FROM categories WHERE brand_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
      [targetBrandId, trimmedName]
    );

    if (duplicateCheck.rows.length > 0) {
      cleanupUploadedFile();
      return res.status(409).json({ error: 'Bu marka için aynı isimde kategori zaten mevcut' });
    }

    let normalizedImageUrl = null;
    if (req.file) {
      normalizedImageUrl = `/category/${req.file.filename}`;
    } else if (typeof image_url === 'string' && image_url.trim()) {
      normalizedImageUrl = image_url.trim();
    }

    console.log('Yeni kategori ekleniyor:', {
      name: trimmedName,
      image_url: normalizedImageUrl,
      targetBrandId
    });

    const result = await db.query(
      `INSERT INTO categories (name, image_url, brand_id) VALUES ($1, $2, $3) RETURNING *`,
      [trimmedName, normalizedImageUrl, targetBrandId]
    );

    console.log('Kategori eklendi:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    cleanupUploadedFile();
    console.error('Kategori eklenirken hata:', err.message);
    res.status(500).json({ error: 'Kategori eklenemedi' });
  }
});

// ✅ PUT /api/categories/:id → Kategori güncelle (super_admin ve brand_manager)
router.put('/:id', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  const { id } = req.params;
  const { name, image_url, brand_id } = req.body;
  console.log(`Kategori #${id} güncelleniyor:`, req.body);

  try {
    const categoryResult = await db.query('SELECT * FROM categories WHERE id = $1 LIMIT 1', [id]);
    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Kategori bulunamadı' });
    }

    const existingCategory = categoryResult.rows[0];
    const userRole = req.user.role;
    const requesterBrandId = await getUserBrandId(req.user);

    if (userRole !== 'super_admin') {
      if (!requesterBrandId) {
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }

      if (existingCategory.brand_id !== requesterBrandId) {
        return res.status(403).json({ error: 'Bu kategoriyi güncelleme yetkiniz yok' });
      }
    }

    let targetBrandId = existingCategory.brand_id;
    if (userRole === 'super_admin' && hasOwn(req.body, 'brand_id')) {
      const requestedBrandId = parseBrandId(brand_id);
      if (requestedBrandId === null) {
        return res.status(400).json({ error: 'Geçersiz brand_id' });
      }
      targetBrandId = requestedBrandId;
    } else {
      targetBrandId = requesterBrandId || existingCategory.brand_id;
    }

    if (!targetBrandId) {
      return res.status(400).json({ error: 'Kategori için brand_id zorunludur' });
    }

    const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [targetBrandId]);
    if (brandCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Geçersiz brand_id' });
    }

    const nextName = (typeof name === 'string' ? name.trim() : existingCategory.name);
    if (!nextName) {
      return res.status(400).json({ error: 'Kategori adı zorunludur' });
    }

    const hasImageInPayload = hasOwn(req.body, 'image_url');
    const nextImageUrl = hasImageInPayload ? (image_url || null) : existingCategory.image_url;
    const shouldIncreaseImageVersion = hasImageInPayload && nextImageUrl !== existingCategory.image_url;

    const duplicateCheck = await db.query(
      `SELECT id
       FROM categories
       WHERE brand_id = $1
         AND LOWER(name) = LOWER($2)
         AND id <> $3
       LIMIT 1`,
      [targetBrandId, nextName, id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Bu marka için aynı isimde kategori zaten mevcut' });
    }

    const result = await db.query(
      `UPDATE categories
       SET name = $1,
           image_url = $2,
           brand_id = $3,
           image_version = CASE WHEN $4 THEN COALESCE(image_version, 1) + 1 ELSE image_version END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5
       RETURNING *`,
      [nextName, nextImageUrl, targetBrandId, shouldIncreaseImageVersion, id]
    );

    // Cache busting için image_url'e sürüm ekle
    if (result.rows[0].image_url) {
      const separator = result.rows[0].image_url.includes('?') ? '&' : '?';
      result.rows[0].image_url = `${result.rows[0].image_url}${separator}v=${result.rows[0].image_version || 1}`;
    }
    
    console.log('Kategori güncellendi:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kategori güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Kategori güncellenemedi' });
  }
});

// ✅ DELETE /api/categories/:id → Kategori sil (super_admin ve kendi markası için brand_manager)
router.delete('/:id', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  const { id } = req.params;
  console.log(`Kategori #${id} siliniyor`);

  try {
    const categoryResult = await db.query('SELECT * FROM categories WHERE id = $1 LIMIT 1', [id]);
    if (categoryResult.rows.length === 0) {
      return res.status(404).json({ error: 'Kategori bulunamadı' });
    }

    const existingCategory = categoryResult.rows[0];
    const userRole = req.user.role;
    const requesterBrandId = await getUserBrandId(req.user);

    if (userRole !== 'super_admin') {
      if (!requesterBrandId) {
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }

      if (existingCategory.brand_id !== requesterBrandId) {
        return res.status(403).json({ error: 'Bu kategoriyi silme yetkiniz yok' });
      }
    }

    // İlk önce bu kategoriye bağlı ürünleri kontrol et
    const productCheck = await db.query(
      'SELECT COUNT(*) FROM products WHERE category_id = $1 AND is_deleted = false',
      [id]
    );
    
    if (parseInt(productCheck.rows[0].count) > 0) {
      console.warn(`Kategori #${id} silinemedi - ${productCheck.rows[0].count} ürüne bağlı`);
      return res.status(400).json({ 
        error: 'Bu kategoriye bağlı ürünler bulunduğu için silinemez',
        count: parseInt(productCheck.rows[0].count)
      });
    }
    
    const result = await db.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kategori bulunamadı' });
    }
    
    console.log('Kategori silindi:', result.rows[0]);
    res.json({ success: true, message: 'Kategori başarıyla silindi', data: result.rows[0] });
  } catch (err) {
    console.error('Kategori silinirken hata:', err.message);
    res.status(500).json({ error: 'Kategori silinemedi' });
  }
});

// ✅ GET /api/categories/:id → Kategori detayı getir
router.get('/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { id } = req.params;
  console.log(`Kategori #${id} detayı istendi`);

  try {
    const result = await db.query('SELECT * FROM categories WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Kategori bulunamadı' });
    }
    
    const requesterBrandId = await getUserBrandId(req.user);
    if (req.user.role !== 'super_admin') {
      if (!requesterBrandId) {
        return res.status(400).json({ error: 'Kullanıcı için marka bilgisi bulunamadı' });
      }
      if (result.rows[0].brand_id !== requesterBrandId) {
        return res.status(403).json({ error: 'Bu kategoriye erişim yetkiniz yok' });
      }
    }

    // Cache busting için image_url'e sürüm ekle
    if (result.rows[0].image_url) {
      const separator = result.rows[0].image_url.includes('?') ? '&' : '?';
      result.rows[0].image_url = `${result.rows[0].image_url}${separator}v=${result.rows[0].image_version || 1}`;
    }
    
    console.log('Kategori detayı bulundu:', result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Kategori detayı alınırken hata:', err.message);
    res.status(500).json({ error: 'Kategori detayı alınamadı' });
  }
});

// ✅ GET /api/categories/:id/image → Kategori resmi serve et (redirect değil)
router.get('/:id/image', async (req, res) => {
  const { id } = req.params;
  console.log(`=============================================`);
  console.log(`Kategori #${id} resmi istendi - ${new Date().toISOString()}`);
  console.log(`Query parametreleri:`, req.query);

  try {
    // DB'den kategoriyi getir
    const result = await db.query('SELECT id, name, image_url, image_version FROM categories WHERE id = $1', [id]);
    console.log(`Kategori DB bilgileri:`, result.rows[0] || 'Bulunamadı');
    
    if (result.rows.length === 0) {
      console.log(`Kategori #${id} bulunamadı, varsayılan resme yönlendiriliyor`);
      return res.sendFile(path.join(__dirname, '../public/uploads/default.jpg'));
    }
    
    if (!result.rows[0].image_url) {
      console.log(`Kategori #${id} için resim URL'si yok, varsayılan resme yönlendiriliyor`);
      return res.sendFile(path.join(__dirname, '../public/uploads/default.jpg'));
    }
    
    // Resim URL'sini doğrula ve düzelt
    let imageUrl = result.rows[0].image_url;
    
    // Cache busting parametrelerini temizle
    if (imageUrl.includes('?')) {
      imageUrl = imageUrl.substring(0, imageUrl.indexOf('?'));
    }

    console.log("Kategori resim URL temizlenmiş hali:", imageUrl);
    
    // 1. UPLOADS KLASÖRÜNDE ARA - Doğrudan dosya adı
    const uploadFileName = path.basename(imageUrl);
    const uploadFilePath = path.join(__dirname, '../public/uploads', uploadFileName);
    
    console.log(`1. Uploads klasöründe dosya adı ile aranıyor: ${uploadFilePath}`);
    
    if (fs.existsSync(uploadFilePath)) {
      console.log(`Başarı! Kategori #${id} resmi uploads klasöründen doğrudan gönderiliyor: ${uploadFilePath}`);
      return res.sendFile(uploadFilePath);
    }
    
    // 2. UPLOADS YOLU İLE - Tam yol kontrolı
    if (imageUrl.includes('/uploads/')) {
      const cleanImageUrl = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
      const uploadsFullPath = path.join(__dirname, '../public', cleanImageUrl);
      
      console.log(`2. Uploads tam yol ile kontrol ediliyor: ${uploadsFullPath}`);
      
      if (fs.existsSync(uploadsFullPath)) {
        console.log(`Başarı! Kategori #${id} resmi uploads tam yol ile gönderiliyor: ${uploadsFullPath}`);
        return res.sendFile(uploadsFullPath);
      }
    }
    
    // 3. CATEGORY KLASÖRÜNDE ARA
    if (imageUrl.includes('/category/')) {
      const cleanImageUrl = imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl;
      const categoryPath = path.join(__dirname, '../public', cleanImageUrl);
      
      console.log(`3. Category klasörü kontrol ediliyor: ${categoryPath}`);
      
      if (fs.existsSync(categoryPath)) {
        console.log(`Başarı! Kategori #${id} resmi category yolu ile gönderiliyor: ${categoryPath}`);
        return res.sendFile(categoryPath);
      }
    }
    
    // 4. SADECE DOSYA ADI İLE CATEGORY KLASÖRÜNDE ARA
    const categoryFilePath = path.join(__dirname, '../public/category', uploadFileName);
    
    console.log(`4. Category klasöründe dosya adı ile aranıyor: ${categoryFilePath}`);
    
    if (fs.existsSync(categoryFilePath)) {
      console.log(`Başarı! Kategori #${id} resmi category klasöründen dosya adı ile gönderiliyor: ${categoryFilePath}`);
      return res.sendFile(categoryFilePath);
    }
    
    // 5. TÜM UPLOADS DOSYALARI LİSTELE VE EşLEŞEN VAR MI BAK
    const uploadsDir = path.join(__dirname, '../public/uploads');
    try {
      console.log(`5. Uploads klasöründeki tüm dosyalar aranıyor...`);
      // uploads klasörü varsa
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        console.log(`Uploads klasöründe ${files.length} dosya bulundu`)
        
        // Eğer uploads'ta varsayalim 1747310054771-439243358.png gibi bir dosya var mi diye bak
        // Ve image_url'de de /uploads/1747310054771-439243358.png varsa, bunun eşleştiğini biliyoruz
        const matchingFiles = files.filter(file => file === uploadFileName);
        
        if (matchingFiles.length > 0) {
          const matchedFile = matchingFiles[0];
          const matchedFilePath = path.join(uploadsDir, matchedFile);
          console.log(`Başarı! Eşleşen dosya bulundu: ${matchedFile}`);
          return res.sendFile(matchedFilePath);
        } else {
          console.log(`Uploads klasöründe eşleşen dosya bulunamadı`)
        }
      }
    } catch (dirError) {
      console.error(`Uploads klasörü listelenirken hata:`, dirError.message);
    }
    
    // 6. GELEN İSTEğİN TÜM PARAMETRELERİNİ LOGLA VE HEADER EKLE (Debug için)
    console.log('Request headers:', req.headers);
    console.log('Request URL:', req.originalUrl);
    console.log('Request path:', req.path);
    
    // 7. HİÇBİRİ ÇALIŞMADI, DEFAULT.JPG GÖNDER
    console.warn(`Hiçbir yolda kategori #${id} için resim bulunamadı, varsayılan resim kullanılıyor`)
    console.warn(`Aranan yollar: \n1. ${uploadFilePath}\n2. ${imageUrl.includes('/uploads/') ? path.join(__dirname, '../public', imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl) : 'Uploads yok'}\n3. ${imageUrl.includes('/category/') ? path.join(__dirname, '../public', imageUrl.startsWith('/') ? imageUrl.substring(1) : imageUrl) : 'Category yok'}\n4. ${categoryFilePath}`);
    return res.sendFile(path.join(__dirname, '../public/uploads/default.jpg'));
    
  } catch (err) {
    console.error('Kategori resmi gönderme hatası:', err.message);
    res.sendFile(path.join(__dirname, '../public/uploads/default.jpg'));
  } finally {
    console.log(`=============================================`);
  }
});

// ✅ POST /api/categories/upload-image → Kategori için resim yükle (super_admin ve brand_manager)
router.post('/upload-image', authorize(['super_admin', 'brand_manager']), upload.single('media'), async (req, res) => {
  try {
    console.log('Kategori resim yükleme isteği:', req.body);
    
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Yüklenecek resim bulunamadı'
      });
    }
    
    console.log('Yüklenen dosya bilgileri:', req.file);
    
    // Yüklenen dosyayı uploads klasörüne de kopyala (frontend için)
    const uploadsDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const uploadFilename = `${Date.now()}-${Math.floor(Math.random() * 1000000000)}.${req.file.originalname.split('.').pop()}`;
    const uploadPath = path.join(uploadsDir, uploadFilename);
    
    // Dosyayı uploads klasörüne kopyala
    fs.copyFileSync(req.file.path, uploadPath);
    console.log(`Dosya ayrıca uploads klasörüne kopyalandı: ${uploadPath}`);
    
    // Veritabanında kullanılacak yol
    const imageUrl = `/uploads/${uploadFilename}`;
    
    // Kategori ID'si varsa, o kategoriyi güncelle
    const categoryId = req.body.categoryId;
    if (categoryId) {
      console.log(`Kategori ID: ${categoryId} için resim yüklendi:`, uploadFilename);

      const categoryResult = await db.query('SELECT id, brand_id FROM categories WHERE id = $1 LIMIT 1', [categoryId]);
      if (categoryResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Güncelleme yapmak için kategori bulunamadı'
        });
      }

      if (req.user.role !== 'super_admin') {
        const requesterBrandId = await getUserBrandId(req.user);
        if (!requesterBrandId || categoryResult.rows[0].brand_id !== requesterBrandId) {
          return res.status(403).json({
            success: false,
            error: 'Bu kategori görselini güncelleme yetkiniz yok'
          });
        }
      }
      
      const result = await db.query(
        `UPDATE categories 
         SET image_url = $1, 
             image_version = COALESCE(image_version, 1) + 1,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING *`,
        [imageUrl, categoryId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Güncelleme yapmak için kategori bulunamadı' 
        });
      }
      
      // Cache busting için image_url'e sürüm ekle
      let responseObject = result.rows[0];
      if (responseObject.image_url) {
        const separator = responseObject.image_url.includes('?') ? '&' : '?';
        responseObject.image_url = `${responseObject.image_url}${separator}v=${responseObject.image_version || 1}`;
      }
      
      // Frontend'e event gönderilmesi için debug bilgisi
      console.log('Frontend için güncellenmiş kategori bilgileri:', {
        id: responseObject.id,
        name: responseObject.name,
        image_url: responseObject.image_url,
        image_version: responseObject.image_version
      });
      
      return res.json({ 
        success: true, 
        message: 'Kategori görseli başarıyla yüklendi',
        url: imageUrl,
        category: responseObject
      });
    }
    
    // Eğer kategori ID'si yoksa, sadece resim yükleme işlemini gerçekleştir
    res.json({
      success: true,
      message: 'Resim başarıyla yüklendi',
      url: imageUrl,
      filename: uploadFilename
    });
    
  } catch (err) {
    console.error('Kategori resmi yüklenirken hata:', err.message);
    
    // Dosya yüklenmişse ama veritabanı hatası oluştuysa dosyayı temizle
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Temizleme hatası:', cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'Resim yüklenirken bir hata oluştu: ' + err.message 
    });
  }
});

module.exports = router;
