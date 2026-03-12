const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const { authorize } = require('./auth');

// ✅ GET /api/branches → Tüm şubeleri getir (rol bazlı filtreleme)
router.get('/', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { role, brand_id: userBrandId, branch_id: userBranchId } = req.user;

    let query = 'SELECT * FROM branches';
    let queryParams = [];
    let whereConditions = [];

    // Rol bazlı filtreleme
    if (role === 'branch_manager') {
      // Branch manager sadece kendi şubesini görür
      whereConditions.push(`id = $${queryParams.length + 1}`);
      queryParams.push(userBranchId);
    } else if (role === 'brand_manager') {
      // Brand manager sadece kendi markasının şubelerini görür
      whereConditions.push(`brand_id = $${queryParams.length + 1}`);
      queryParams.push(userBrandId);
    }
    // super_admin tüm şubeleri görebilir

    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }

    query += ' ORDER BY id ASC';

    const result = await db.query(query, queryParams);

    // theme_settings'ten enable_cart ve enable_popup değerlerini çıkar
    const branches = result.rows.map(b => ({
      ...b,
      enable_cart: b.theme_settings?.cart?.enabled ?? true,
      enable_popup: b.theme_settings?.popup?.enabled ?? true
    }));

    res.json(branches);
  } catch (err) {
    console.error('Şubeler alınırken hata:', err.message);
    res.status(500).json({ error: 'Şubeler getirilemedi' });
  }
});

// POST /api/branches → Yeni şube ekle (sadece super_admin ve brand_manager)
router.post('/', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  try {
    const { name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id } = req.body;
    const { role, brand_id: userBrandId } = req.user;

    // Brand manager sadece kendi markasına şube ekleyebilir
    let targetBrandId = brand_id;
    if (role === 'brand_manager') {
      targetBrandId = userBrandId;
    }

    // Temel doğrulama
    if (!name || !address) {
      return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
    }

    // Yeni şubeyi veritabanına ekle
    const result = await db.query(`
      INSERT INTO branches (
        name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      name,
      address,
      phone || null,
      email || null,
      manager_name || null,
      opening_hours || null,
      description || null,
      is_active !== false, // undefined ise true kabul et
      targetBrandId || null // rol bazlı brand_id kullanımı
    ]);

    // Şube oluşturulduktan sonra, tema ayarlarını uygula
    try {
      let themeToApply = null;

      // Önce markanın tema ayarlarını kontrol et
      if (result.rows[0].brand_id) {
        const brandTheme = await db.query(
          'SELECT theme_settings FROM brands WHERE id = $1',
          [result.rows[0].brand_id]
        );

        if (brandTheme.rows.length > 0 && brandTheme.rows[0].theme_settings) {
          const theme = brandTheme.rows[0].theme_settings;
          // Tema tam mı kontrol et (gerekli alanlar var mı)
          if (theme.colors?.background && theme.fonts && theme.components?.slider) {
            themeToApply = theme;
            console.log(`Marka ID ${result.rows[0].brand_id} tema ayarları kullanılacak`);
          }
        }
      }

      // Marka teması eksikse, Branch 1'in temasını kullan (default tam tema)
      if (!themeToApply) {
        const defaultTheme = await db.query(
          'SELECT theme_settings FROM branches WHERE id = 1'
        );
        if (defaultTheme.rows.length > 0 && defaultTheme.rows[0].theme_settings) {
          themeToApply = defaultTheme.rows[0].theme_settings;
          console.log(`Default tema (Branch 1) yeni şube için kullanılacak`);
        }
      }

      // Temayı şubeye uygula
      if (themeToApply) {
        await db.query(
          'UPDATE branches SET theme_settings = $1 WHERE id = $2',
          [themeToApply, result.rows[0].id]
        );
        console.log(`Tema ayarları yeni şube ID ${result.rows[0].id} için uygulandı`);
      }
    } catch (themeErr) {
      console.error("Tema ayarları yeni şubeye uygulanırken hata:", themeErr);
      // Tema ayarları uygulanamasa bile şube oluşturma işlemine devam et
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Şube eklenirken hata:', err.message);
    res.status(500).json({ error: 'Şube eklenemedi', details: err.message });
  }
});

// PUT /api/branches/:id → Şube bilgilerini güncelle (super_admin ve brand_manager)
router.put('/:id', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone, email, manager_name, opening_hours, description, is_active, brand_id } = req.body;
    const { role, brand_id: userBrandId } = req.user;

    // Temel doğrulama
    if (!name || !address) {
      return res.status(400).json({ error: 'Şube adı ve adres zorunludur' });
    }

    // Şubenin mevcut olup olmadığı ve erişim kontrolü
    const checkResult = await db.query('SELECT id, brand_id FROM branches WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Brand manager sadece kendi markasındaki şubeleri güncelleyebilir
    if (role === 'brand_manager' && checkResult.rows[0].brand_id !== userBrandId) {
      return res.status(403).json({ error: 'Bu şubeyi güncelleme yetkiniz yok' });
    }

    // Brand manager brand_id'yi değiştiremez
    let targetBrandId = brand_id;
    if (role === 'brand_manager') {
      targetBrandId = userBrandId;
    }

    // Şubeyi güncelle - rol bazlı brand_id kullanımı
    const result = await db.query(`
      UPDATE branches SET
        name = $1,
        address = $2,
        phone = $3,
        email = $4,
        manager_name = $5,
        opening_hours = $6,
        description = $7,
        is_active = $8,
        brand_id = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [
      name,
      address,
      phone || null,
      email || null,
      manager_name || null,
      opening_hours || null,
      description || null,
      is_active !== false, // undefined ise true kabul et
      targetBrandId || null, // rol bazlı brand_id kullanımı
      id
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Şube güncellenemedi', details: err.message });
  }
});

// GET /api/branches/:id - Şube detaylarını getir (rol bazlı erişim)
router.get('/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, brand_id: userBrandId, branch_id: userBranchId } = req.user;
    console.log(`Şube #${id} detayı istendi - Kullanıcı: ${req.user.username}, Rol: ${role}`);

    // Şubeyi şablon bilgileriyle birlikte getir
    const result = await db.query(`
      SELECT b.*,
             m.name as menu_template_name,
             p.name as price_template_name
      FROM branches b
      LEFT JOIN menu_templates m ON b.menu_template_id = m.id
      LEFT JOIN price_templates p ON b.price_template_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    const branch = result.rows[0];

    // Erişim kontrolü
    if (role === 'branch_manager' && parseInt(id) !== userBranchId) {
      return res.status(403).json({ error: 'Bu şubeyi görüntüleme yetkiniz yok' });
    }

    if (role === 'brand_manager' && branch.brand_id !== userBrandId) {
      return res.status(403).json({ error: 'Bu şubeyi görüntüleme yetkiniz yok' });
    }

    // Logo URL için cache busting ekleyin
    if (result.rows[0].logo_url) {
      const separator = result.rows[0].logo_url.includes('?') ? '&' : '?';
      result.rows[0].logo_url = `${result.rows[0].logo_url}${separator}v=${result.rows[0].logo_version || 1}`;
      console.log(`Şube logo URL'si: ${result.rows[0].logo_url}`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Şube detayları alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube detayları getirilemedi' });
  }
});

// DELETE /api/branches/:id → Şubeyi sil (sadece super_admin)
router.delete('/:id', authorize(['super_admin']), async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await db.query('SELECT id, brand_id FROM branches WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Şubeyi sil
    await db.query('DELETE FROM branches WHERE id = $1', [id]);

    res.json({ message: 'Şube başarıyla silindi' });
  } catch (err) {
    console.error('Şube silinirken hata:', err.message);
    res.status(500).json({ error: 'Şube silinemedi', details: err.message });
  }
});

// POST /api/branches/:id/upload-logo - Şube logosu yükleme endpoint'i
router.post('/:id/upload-logo', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  try {
    const { id } = req.params;
    const { role, brand_id: userBrandId } = req.user;
    console.log(`Şube #${id} için logo yükleme isteği alındı`);
    
    // Multer middleware'ini burada manuel olarak uygulamak için path ve multer modüllerini kullanıyoruz
    const multer = require('multer');
    
    // Upload klasörü oluştur
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    // Storage konfigürasyonu
    const storage = multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, uploadDir);
      },
      filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.floor(Math.random() * 1000000000);
        const ext = path.extname(file.originalname);
        cb(null, uniqueSuffix + ext);
      }
    });
    
    // Dosya türü filtreleme
    const fileFilter = (req, file, cb) => {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF, SVG ve WebP dosyaları kabul edilir.'), false);
      }
    };
    
    // Multer ayarları
    const upload = multer({
      storage: storage,
      fileFilter: fileFilter,
      limits: { fileSize: 5 * 1024 * 1024 } // 5MB
    }).single('logo');
    
    // Şube varlığını kontrol et
    const branchCheck = await db.query('SELECT id, name, brand_id FROM branches WHERE id = $1', [id]);
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Brand manager erişim kontrolü
    if (role === 'brand_manager' && branchCheck.rows[0].brand_id !== userBrandId) {
      return res.status(403).json({ error: 'Bu şubeye logo yükleme yetkiniz yok' });
    }

    // Upload işlemini başlat
    upload(req, res, async function (err) {
      if (err) {
        console.error('Logo yükleme hatası:', err.message);
        return res.status(400).json({ 
          success: false, 
          error: 'Logo yüklenemedi: ' + err.message 
        });
      }
      
      // Dosya yoksa hata döndür
      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: 'Yüklenecek logo bulunamadı' 
        });
      }
      
      console.log('Yüklenen logo:', req.file);
      
      // Logo URL'sini oluştur
      const logoUrl = `/uploads/${req.file.filename}`;
      console.log(`Oluşturulan logo URL'si: ${logoUrl}`);
      
      // Veritabanında güncelle
      try {
        // Sürüm numarasını artır
        const updateResult = await db.query(`
          UPDATE branches 
          SET logo_url = $1, 
              logo_version = COALESCE(logo_version, 0) + 1,
              updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2 
          RETURNING *
        `, [logoUrl, id]);
        
        if (updateResult.rows.length === 0) {
          return res.status(500).json({ 
            success: false, 
            error: 'Logo URL kaydedilemedi' 
          });
        }
        
        const branch = updateResult.rows[0];
        
        // Cache busting için URL parametresi ekle
        const logoUrlWithVersion = `${logoUrl}?v=${branch.logo_version}`;
        
        res.json({
          success: true,
          message: 'Logo başarıyla yüklendi',
          branch_id: branch.id,
          branch_name: branch.name,
          logo_url: logoUrlWithVersion,
          logo_version: branch.logo_version
        });
        
      } catch (dbError) {
        console.error('Logo URL kaydedilirken veritabanı hatası:', dbError);
        
        // Yüklenen dosyayı sil
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkErr) {
          console.error('Yüklenen dosya silinemedi:', unlinkErr);
        }
        
        res.status(500).json({ 
          success: false, 
          error: 'Logo URL kaydedilemedi: ' + dbError.message 
        });
      }
    });
    
  } catch (err) {
    console.error('Logo yükleme hatası:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Logo yükleme işlemi sırasında bir hata oluştu' 
    });
  }
});

// POST /api/branches/update-brand - Özel bir şubenin marka bilgisini güncelle (sadece super_admin)
router.post('/update-brand', authorize(['super_admin']), async (req, res) => {
  try {
    const { branch_id, brand_id } = req.body;

    if (!branch_id || !brand_id) {
      return res.status(400).json({ error: 'Şube ID ve Marka ID zorunludur' });
    }

    // Şubenin var olup olmadığını kontrol et
    const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1', [branch_id]);
    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    // Markanın var olup olmadığını kontrol et
    const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1', [brand_id]);
    if (brandCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }

    // Şubenin markasını güncelle
    const result = await db.query(`
      UPDATE branches SET 
        brand_id = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [brand_id, branch_id]);

    // Marka değiştirildiğinde, yeni markanın tema ayarlarını şubeye uygulama opsiyonu ekleyelim
    try {
      // Markanın tema ayarlarını al
      const brandTheme = await db.query(
        'SELECT theme_settings FROM brands WHERE id = $1',
        [brand_id]
      );
      
      if (brandTheme.rows.length > 0 && brandTheme.rows[0].theme_settings) {
        // Tema ayarlarını şubeye uygula
        await db.query(
          'UPDATE branches SET theme_settings = $1 WHERE id = $2',
          [brandTheme.rows[0].theme_settings, branch_id]
        );
        
        console.log(`Marka değişimi: Marka ID ${brand_id} tema ayarları şube ID ${branch_id} için uygulandı`);
      }
    } catch (themeErr) {
      console.error("Marka değişiminde tema ayarları şubeye uygulanırken hata:", themeErr);
      // Tema ayarları uygulanamasa bile işleme devam et
    }

    res.json({
      success: true,
      message: 'Şube markası başarıyla güncellendi',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Şube markası güncellenirken hata:', err.message);
    res.status(500).json({ error: 'Şube markası güncellenemedi', details: err.message });
  }
});

// ✅ GET /api/branches/:id/public → QR Menü için şube bilgilerini getir (AUTH GEREKMİYOR)
router.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[PUBLIC] Şube #${id} detayı istendi (QR Menü)`);

    // Şubeyi marka ve şablon bilgileriyle birlikte getir - SADECE GEREKLİ ALANLAR
    const result = await db.query(`
      SELECT
        b.id,
        b.name,
        b.address,
        b.phone,
        b.opening_hours,
        b.description,
        b.is_active,
        b.logo_url,
        b.logo_version,
        b.theme_settings,
        b.menu_template_id,
        b.price_template_id,
        b.brand_id,
        br.name as brand_name,
        m.name as menu_template_name,
        p.name as price_template_name
      FROM branches b
      LEFT JOIN brands br ON b.brand_id = br.id
      LEFT JOIN menu_templates m ON b.menu_template_id = m.id
      LEFT JOIN price_templates p ON b.price_template_id = p.id
      WHERE b.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    const branch = result.rows[0];

    // Şube aktif değilse hata döndür
    if (!branch.is_active) {
      return res.status(404).json({ error: 'Şube şu anda aktif değil' });
    }

    // Logo URL için cache busting ekle
    if (branch.logo_url) {
      const separator = branch.logo_url.includes('?') ? '&' : '?';
      branch.logo_url = `${branch.logo_url}${separator}v=${branch.logo_version || 1}`;
    }

    console.log(`[PUBLIC] Şube #${id} bilgileri gönderildi: ${branch.name}`);
    res.json(branch);
  } catch (err) {
    console.error('[PUBLIC] Şube detayları alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube detayları getirilemedi' });
  }
});

// ✅ GET /api/branches/:id/logo → Şube logosunu serve et
router.get('/:id/logo', async (req, res) => {
  const branchId = req.params.id;
  console.log(`=============================================`);
  console.log(`Şube #${branchId} logosu istendi - ${new Date().toISOString()}`);
  console.log(`Query parametreleri:`, req.query);

  try {
    // DB'den şubeyi getir
    const result = await db.query('SELECT id, name, logo_url, logo_version FROM branches WHERE id = $1', [branchId]);
    console.log(`Şube DB bilgileri:`, result.rows[0] || 'Bulunamadı');
    
    if (result.rows.length === 0) {
      console.log(`Şube #${branchId} bulunamadı, varsayılan logoya yönlendiriliyor`);
      return res.sendFile(path.join(__dirname, '../public/logos/default-logo.png'));
    }
    
    if (!result.rows[0].logo_url) {
      console.log(`Şube #${branchId} için logo URL'si yok, varsayılan logoya yönlendiriliyor`);
      return res.sendFile(path.join(__dirname, '../public/logos/default-logo.png'));
    }
    
    // Logo URL'sini doğrula ve düzelt
    let logoUrl = result.rows[0].logo_url;
    
    // Cache busting parametrelerini temizle
    if (logoUrl.includes('?')) {
      logoUrl = logoUrl.substring(0, logoUrl.indexOf('?'));
    }

    console.log("Şube logo URL temizlenmiş hali:", logoUrl);
    
    // 1. UPLOADS KLASÖRÜNDE ARA - Doğrudan dosya adı
    const uploadFileName = path.basename(logoUrl);
    const uploadFilePath = path.join(__dirname, '../public/uploads', uploadFileName);
    
    console.log(`1. Uploads klasöründe dosya adı ile aranıyor: ${uploadFilePath}`);
    
    if (fs.existsSync(uploadFilePath)) {
      console.log(`Başarı! Şube #${branchId} logosu uploads klasöründen doğrudan gönderiliyor: ${uploadFilePath}`);
      return res.sendFile(uploadFilePath);
    }
    
    // 2. UPLOADS YOLU İLE - Tam yol kontrolü
    if (logoUrl.includes('/uploads/')) {
      const cleanLogoUrl = logoUrl.startsWith('/') ? logoUrl.substring(1) : logoUrl;
      const uploadsFullPath = path.join(__dirname, '../public', cleanLogoUrl);
      
      console.log(`2. Uploads tam yol ile kontrol ediliyor: ${uploadsFullPath}`);
      
      if (fs.existsSync(uploadsFullPath)) {
        console.log(`Başarı! Şube #${branchId} logosu uploads tam yol ile gönderiliyor: ${uploadsFullPath}`);
        return res.sendFile(uploadsFullPath);
      }
    }
    
    // 3. LOGOS KLASÖRÜNDE ARA
    if (logoUrl.includes('/logos/')) {
      const cleanLogoUrl = logoUrl.startsWith('/') ? logoUrl.substring(1) : logoUrl;
      const logosPath = path.join(__dirname, '../public', cleanLogoUrl);
      
      console.log(`3. Logos klasörü kontrol ediliyor: ${logosPath}`);
      
      if (fs.existsSync(logosPath)) {
        console.log(`Başarı! Şube #${branchId} logosu logos yolu ile gönderiliyor: ${logosPath}`);
        return res.sendFile(logosPath);
      }
    }
    
    // 4. SADECE DOSYA ADI İLE LOGOS KLASÖRÜNDE ARA
    const logoFilePath = path.join(__dirname, '../public/logos', uploadFileName);
    
    console.log(`4. Logos klasöründe dosya adı ile aranıyor: ${logoFilePath}`);
    
    if (fs.existsSync(logoFilePath)) {
      console.log(`Başarı! Şube #${branchId} logosu logos klasöründen dosya adı ile gönderiliyor: ${logoFilePath}`);
      return res.sendFile(logoFilePath);
    }
    
    // 5. TÜM UPLOADS DOSYALARI LİSTELE VE EşLEŞEN VAR MI BAK
    const uploadsDir = path.join(__dirname, '../public/uploads');
    try {
      console.log(`5. Uploads klasöründeki tüm dosyalar aranıyor...`);
      // uploads klasörü varsa
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        console.log(`Uploads klasöründe ${files.length} dosya bulundu`)
        
        // Eğer eşleşen dosya varsa
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
    
    // 7. HİÇBİRİ ÇALIŞMADI, DEFAULT LOGO GÖNDER
    console.warn(`Hiçbir yolda şube #${branchId} için logo bulunamadı, varsayılan logo kullanılıyor`)
    console.warn(`Aranan yollar: \n1. ${uploadFilePath}\n2. ${logoUrl.includes('/uploads/') ? path.join(__dirname, '../public', logoUrl.startsWith('/') ? logoUrl.substring(1) : logoUrl) : 'Uploads yok'}\n3. ${logoUrl.includes('/logos/') ? path.join(__dirname, '../public', logoUrl.startsWith('/') ? logoUrl.substring(1) : logoUrl) : 'Logos yok'}\n4. ${logoFilePath}`);
    return res.sendFile(path.join(__dirname, '../public/logos/default-logo.png'));
    
  } catch (err) {
    console.error('Şube logosu gönderme hatası:', err.message);
    res.sendFile(path.join(__dirname, '../public/logos/default-logo.png'));
  } finally {
    console.log(`=============================================`);
  }
});

// ✅ GET /api/branches/:id/products → Şubeye özel ürünleri getir
router.get('/:id/products', async (req, res) => {
  const branchId = req.params.id;

  try {
    const result = await db.query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      INNER JOIN branch_products bp ON p.id = bp.product_id
      WHERE bp.branch_id = $1
        AND bp.is_visible = true
        AND (
          p.is_deleted = false
          OR (p.is_deleted = true AND c.name = 'Çaylar')
        )
      ORDER BY c.name, p.name
    `, [branchId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Şube ürünleri alınırken hata:', err.message);
    res.status(500).json({ error: 'Şube ürünleri getirilemedi' });
  }
});

router.patch("/branch-product", async (req, res) => {
  const { branch_id, product_id, is_visible, stock_count } = req.body;

  // Middleware'de gerekli kontrolleri yaptıktan sonra...
  try {
    console.log('Gelen PATCH isteği verisi:', req.body); // Debug amaçlı

    // Branch-product kaydını kontrol et
    const checkQuery = await db.query(
      "SELECT * FROM branch_products WHERE branch_id = $1 AND product_id = $2",
      [branch_id, product_id]
    );

    let result;
    if (checkQuery.rows.length > 0) {
      // Mevcut kaydı güncelle - is_visible ve stock_count değerlerini ayrı ayrı işle
      let query = `UPDATE branch_products SET updated_at = CURRENT_TIMESTAMP`;
      const values = [];
      let paramCounter = 1;

      // is_visible parametresi belirtilmişse
      if (is_visible !== undefined) {
        query += `, is_visible = $${paramCounter}`;
        values.push(is_visible);
        paramCounter++;
      }

      // stock_count parametresi belirtilmişse
      if (stock_count !== undefined) {
        query += `, stock_count = $${paramCounter}`;
        values.push(stock_count);
        paramCounter++;
      }

      query += ` WHERE branch_id = $${paramCounter} AND product_id = $${paramCounter + 1} RETURNING *`;
      values.push(branch_id, product_id);

      console.log('Çalıştırılacak sorgu:', query, values); // Debug amaçlı
      result = await db.query(query, values);
    } else {
      // Yeni bir kayıt oluştur
      result = await db.query(
        `INSERT INTO branch_products (branch_id, product_id, is_visible, stock_count) 
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [branch_id, product_id, is_visible !== undefined ? is_visible : true, stock_count !== undefined ? stock_count : 0]
      );
    }

    // Başarılı yanıt
    res.json({
      success: true,
      message: "Ürün durumu başarıyla güncellendi",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("Branch-product güncelleme hatası:", err);
    res.status(500).json({
      success: false,
      error: "Ürün durumu güncellenemedi",
      details: err.message
    });
  }
});

router.get('/:id/menu', async (req, res) => {
  const branchId = req.params.id;

  try {
    // Debug için detaylı log ekleyelim
    console.log(`Şube ${branchId} için menü getiriliyor`);

    // Önce şubenin mevcut olup olmadığını kontrol edelim
    const branchCheck = await db.query('SELECT id, name, menu_template_id, price_template_id FROM branches WHERE id = $1', [branchId]);

    if (branchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }

    const branch = branchCheck.rows[0];
    console.log('Şube bilgileri:', branch);

    // Eğer şubenin menü şablonu yoksa, tüm ürünleri göster (geriye uyumluluk için)
    if (!branch.menu_template_id) {
      console.log('Şube için menü şablonu bulunamadı, tüm ürünleri getiriyorum');

      const productsResult = await db.query(`
        SELECT p.*, c.name as category_name, bp.stock_count, p.price as display_price
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $1
        WHERE p.is_deleted = false AND (bp.is_visible IS NULL OR bp.is_visible = true)
        ORDER BY c.name, p.name
      `, [branchId]);

      console.log(`${productsResult.rows.length} ürün bulundu`);

      return res.json({
        branch: {
          id: branch.id,
          name: branch.name
        },
        products: productsResult.rows
      });
    }

    // Şubenin seçtiği menü şablonu varsa, o şablona göre getir
    console.log(`Menü şablonu ID: ${branch.menu_template_id}, Fiyat şablonu ID: ${branch.price_template_id}`);

    // Şubenin seçtiği menü şablonundaki ürünleri getir.
    // Parametre indekslerini sabit tutuyoruz:
    // $1 => menu_template_id, $2 => price_template_id (null olabilir), $3 => branch_id
    const query = `
      SELECT 
        p.*, 
        c.name as category_name,
        COALESCE(bp.stock_count, 0) as stock_count,
        mtp.is_visible,
        COALESCE(ptp.price, p.price) as display_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN menu_template_products mtp ON p.id = mtp.product_id AND mtp.menu_template_id = $1
      LEFT JOIN price_template_products ptp ON p.id = ptp.product_id AND ptp.price_template_id = $2
      LEFT JOIN branch_products bp ON p.id = bp.product_id AND bp.branch_id = $3
      WHERE mtp.product_id IS NOT NULL
      AND (mtp.is_visible = true OR mtp.is_visible IS NULL)
      AND p.is_deleted = false
      ORDER BY c.name, p.name
    `;

    const queryParams = [branch.menu_template_id, branch.price_template_id || null, branchId];
    const result = await db.query(query, queryParams);
    console.log(`${result.rows.length} ürün bulundu`);

    // Eğer hiç ürün bulunamadıysa, şablon ürünlerini kontrol edelim
    if (result.rows.length === 0) {
      console.log("Menü şablonunda görünür ürün bulunamadı, şablondaki tüm ürünleri kontrol ediyoruz");

      // Şablondaki tüm ürünleri (görünür olmasa bile) kontrol edelim
      const templateCheck = await db.query(`
        SELECT COUNT(*) as count FROM menu_template_products 
        WHERE menu_template_id = $1
      `, [branch.menu_template_id]);

      console.log(`Şablonda toplam ${templateCheck.rows[0].count} ürün kaydı var`);

      // Eğer şablonda hiç ürün yoksa, admin uyarısı ekleyelim
      if (parseInt(templateCheck.rows[0].count) === 0) {
        console.log("UYARI: Şablonda hiç ürün kaydı bulunmuyor!");
      }
    }

    // Kategori bilgilerini getir - görsel URL'lerini eklemek için
    const categoriesResult = await db.query(`
      SELECT c.id, c.name, c.image_url, c.image_version 
      FROM categories c
      JOIN (
        SELECT DISTINCT category_id 
        FROM products p
        JOIN menu_template_products mtp ON p.id = mtp.product_id
        WHERE mtp.menu_template_id = $1
      ) as cats ON cats.category_id = c.id
    `, [branch.menu_template_id]);
    
    console.log(`${categoriesResult.rows.length} kategori bulundu`);
    
    // Kategori resimlerine önbellek kırıcı parametreleri ekle
    const categories = categoriesResult.rows.map(cat => {
      if (cat.image_url) {
        const separator = cat.image_url.includes('?') ? '&' : '?';
        cat.image_url = `${cat.image_url}${separator}v=${cat.image_version || 1}`;
      }
      return cat;
    });
    
    res.json({
      branch: {
        id: branch.id,
        name: branch.name
      },
      products: result.rows,
      categories: categories
    });
  } catch (err) {
    console.error('Şube menüsü alınırken hata:', err);
    res.status(500).json({ error: 'Şube menüsü getirilemedi', details: err.message });
  }
});

module.exports = router;
