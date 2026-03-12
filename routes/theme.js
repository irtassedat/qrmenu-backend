const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = './public/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Varsayılan tema ayarları yapısını oluştur
const getDefaultThemeSettings = () => {
  // Önce default ayarları oluştur
  const defaultSettings = {
    colors: {
      primary: "#022B45",
      secondary: "#D98A3D",
      accent: "#1a9c95",
      light: "#F4F7F8",
      dark: "#343a40",
      success: "#28a745",
      danger: "#dc3545",
      warning: "#ffc107",
      info: "#17a2b8",
      text: "#1f2937",
      background: "#f3f4f6",
      buttonBg: "#D98A3D",
      buttonText: "#ffffff",
      headerBg: "#022B45",
      headerText: "#ffffff",
      priceColor: "#D98A3D",
      categoryBg: "#022B45",
      categoryText: "#ffffff"
    },
    typography: {
      fontFamily: "'Open Sans', sans-serif",
      headingFontFamily: "'Poppins', sans-serif",
      fontSize: "16px",
      headingColor: "#022B45",
      textColor: "#333333"
    },
    components: {
      borderRadius: "8px",
      buttonStyle: "rounded",
      shadowDepth: "medium",
      logo: {
        url: "/logos/sebastian-default.webp",
        height: "60px",
        width: "auto",
      },
      slider: {
        enabled: true,
        autoPlaySpeed: 5000,
        slides: []
      }
    },
    fonts: {
      primary: "Open Sans",
      secondary: "Roboto",
      sizes: {
        small: "12px",
        regular: "14px",
        medium: "16px",
        large: "18px",
        xlarge: "24px"
      }
    },
    header: {
      logoPosition: "left",
      backgroundStyle: "solid",
      backgroundColor: "#FFFFFF",
      textColor: "#022B45",
      showSocialMedia: true
    },
    footer: {
      backgroundColor: "#022B45",
      textColor: "#FFFFFF",
      showCopyright: true
    },
    social: {
      enabled: true,
      platforms: [
        {
          id: "instagram",
          name: "Instagram",
          url: "https://instagram.com/cesmekahve",
          icon: "instagram",
          enabled: true
        },
        {
          id: "facebook",
          name: "Facebook",
          url: "https://facebook.com/cesmekahve",
          icon: "facebook",
          enabled: true
        },
        {
          id: "twitter",
          name: "Twitter",
          url: "https://twitter.com/cesmekahve",
          icon: "twitter",
          enabled: false
        },
        {
          id: "whatsapp",
          name: "WhatsApp",
          url: "https://wa.me/905554443322",
          icon: "whatsapp",
          enabled: true
        }
      ]
    },
    cart: {
      enabled: true,
      showPrices: true,
      allowWaiterCall: true,
      clearAfterCall: true,
      waiterCallMessage: "Garson çağrınız alındı. En kısa sürede size yardımcı olacağız.",
      emptyCartMessage: "Sepetiniz boş"
    },
    feedback: {
      enabled: true,
      buttonText: "Geri Bildirim",
      buttonColor: "#D98A3D",
      buttonIcon: "message-circle",
      emailRecipient: "feedback@cesmekahve.com",
      thankYouMessage: "Geri bildiriminiz için teşekkür ederiz!",
      formTitle: "Geri Bildirim Formu",
      submitButtonText: "GÖNDER",
      questions: [
        {
          id: "firstVisit",
          type: "yes_no",
          text: "İşletmemizi ilk defa mı ziyaret ediyorsunuz?",
          required: false,
          order: 1,
          enabled: true
        },
        {
          id: "newQuestion",
          type: "text",
          text: "Metin Yeni SoruSoruSoruSoruSoruSoruSoru",
          required: false,
          order: 2,
          enabled: true
        },
        {
          id: "generalSatisfaction",
          type: "rating",
          text: "Genel memnuniyetiniz nasıl?",
          required: true,
          order: 3,
          enabled: true
        },
        {
          id: "hygiene",
          type: "rating",
          text: "Hijyeni nasıl değerlendirirsiniz?",
          required: false,
          order: 4,
          enabled: true
        },
        {
          id: "taste",
          type: "rating",
          text: "Yemeklerimizin lezzetini nasıl değerlendirirsiniz?",
          required: false,
          order: 5,
          enabled: true
        },
        {
          id: "willVisitAgain",
          type: "yes_no",
          text: "Tekrar ziyaret etmeyi düşünür müsünüz?",
          required: false,
          order: 6,
          enabled: true
        },
        {
          id: "comments",
          type: "textarea",
          text: "Bizimle paylaşmak istediğiniz başka bir konu var mı?",
          required: false,
          order: 7,
          enabled: true
        },
        {
          id: "name",
          type: "text",
          text: "İsminiz",
          required: true,
          order: 8,
          enabled: true
        },
        {
          id: "email",
          type: "email",
          text: "E-posta adresiniz",
          required: true,
          order: 9,
          enabled: true
        }
      ]
    },
    menu: {
      layout: "grid",
      showPrices: true,
      showImages: true,
      categoryDisplayStyle: "tabs"
    }
  };
  
  // Debug için çıktı göster
  console.log("Varsayılan tema ayarları oluşturuldu");
  console.log("Feedback soruları:", defaultSettings.feedback.questions);
  
  return defaultSettings;
};

// Dosya yükleme konfigürasyonu
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Benzersiz dosya adı ve uzantısı koruyarak kaydetme
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// Desteklenen dosya tiplerini kontrol etme
const fileFilter = (req, file, cb) => {
  // İzin verilen MIME tipleri
  const allowedTypes = [
    'image/jpeg', 
    'image/png', 
    'image/gif', 
    'image/svg+xml',
    'image/webp',
    'video/mp4',
    'video/webm'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF, SVG, WEBP, MP4 ve WEBM desteklenmektedir.'), false);
  }
};

// Dosya boyutu limiti (10MB)
const limits = {
  fileSize: 50 * 1024 * 1024
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: limits
});

// Medya yükleme endpoint'i
router.post('/upload-media', authorize(['super_admin', 'brand_manager', 'branch_manager']), upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya yüklenemedi' });
    }

    // Yüklenen dosyanın URL'sini oluştur
    const fileUrl = `/uploads/${req.file.filename}`;
    
    // Log
    console.log(`Dosya yüklendi: ${req.file.originalname} -> ${fileUrl} (${req.file.mimetype})`);
    
    // Dosya türünü belirle
    const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    
    res.json({
      success: true,
      url: fileUrl,
      type: fileType,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('Medya yüklenirken hata:', err);
    res.status(500).json({ error: 'Medya yüklenemedi', message: err.message });
  }
});

// Logo yükleme endpoint'i
router.post('/upload-logo', authorize(['super_admin', 'brand_manager', 'branch_manager']), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Logo yüklenemedi' });
    }

    // Yüklenen logoyu kaydet
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      url: fileUrl
    });
  } catch (err) {
    console.error('Logo yüklenirken hata:', err);
    res.status(500).json({ error: 'Logo yüklenemedi' });
  }
});

// PUBLIC ROUTE - Tema ayarlarını getir (QR menü için)
router.get('/public/settings/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';

    console.log(`Public tema ayarları istendi - Tip: ${type}, ID: ${id}`);

    // Debug: Check request parameters
    console.log(`Requesting theme settings for ${type} ID ${id} from table ${table}`);

    // Varsayılan tema ayarlarını oluştur
    const defaultSettings = getDefaultThemeSettings();
    console.log("Varsayılan tema ayarlarında soru sayısı:", defaultSettings.feedback?.questions?.length || 0);
    
    // Önce istenen tipte kaydı getirmeye çalış
    const result = await db.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    console.log(`Query result: found ${result.rows.length} rows`);
    
    // Eğer şube ID'si ile istek yapıldıysa, şubeyi bulamadığımızda ilgili marka ayarlarını kontrol et
    if (type === 'branch' && result.rows.length === 0) {
      console.log(`Şube ID ${id} bulunamadı, ilgili marka ayarları kontrol ediliyor...`);
      
      try {
        // Brand_id'yi getirmeye çalış
        const branchResult = await db.query(`
          SELECT brand_id FROM branches WHERE id = $1
        `, [id]);
        
        if (branchResult.rows.length > 0 && branchResult.rows[0].brand_id) {
          const brandId = branchResult.rows[0].brand_id;
          console.log(`Şube (ID: ${id}) için Marka ID ${brandId} bulundu, marka tema ayarları getiriliyor...`);
          
          // Marka tema ayarlarını getir
          const brandResult = await db.query(`
            SELECT theme_settings FROM brands WHERE id = $1
          `, [brandId]);
          
          if (brandResult.rows.length > 0) {
            console.log(`Marka (ID: ${brandId}) tema ayarları bulundu, kullanılıyor...`);
            const brandSettings = brandResult.rows[0].theme_settings || {};
            
            // Marka ayarları ile varsayılan değerleri birleştir
            const mergedSettings = mergeWithDefaultSettings(brandSettings, defaultSettings);
            console.log(`Marka tema ayarları gönderiliyor, logo URL:`, mergedSettings.components?.logo?.url);
            return res.json(mergedSettings);
          }
        }
      } catch (err) {
        console.error('İlgili marka kontrolünde hata:', err);
      }
    }
    
    // Eğer kayıt yoksa varsayılan ayarları döndür
    if (result.rows.length === 0) {
      console.log(`${type} ID ${id} bulunamadı, varsayılan tema ayarları gönderiliyor`);
      return res.json(defaultSettings);
    }

    // Mevcut tema ayarları
    const existingSettings = result.rows[0].theme_settings || {};
    console.log(`${type} ID ${id} için mevcut ayarlar:`, JSON.stringify(existingSettings, null, 2));
    
    // Varsayılan ayarlarla birleştirme işlemi
    const mergedSettings = mergeWithDefaultSettings(existingSettings, defaultSettings);
    
    console.log(`${type} ID ${id} için tema ayarları gönderiliyor, logo URL:`, mergedSettings.components?.logo?.url);
    res.json(mergedSettings);
  } catch (err) {
    console.error('Tema ayarları alınırken hata:', err);
    // Hata durumunda bile varsayılan ayarları gönder
    res.json(getDefaultThemeSettings());
  }
});

// Varsayılan temalar ile mevcut temaları birleştiren yardımcı fonksiyon
function mergeWithDefaultSettings(existingSettings, defaultSettings) {
  // Deep copy of default settings
  const mergedSettings = JSON.parse(JSON.stringify(defaultSettings));
  
  // Üst seviye nesneleri birleştir
  Object.keys(existingSettings).forEach(key => {
    if (existingSettings[key]) {
      // Özel durumlar - Nested objeler için
      if (key === 'social' || key === 'feedback' || key === 'components') {
        mergedSettings[key] = mergedSettings[key] || {};
        Object.keys(existingSettings[key]).forEach(subKey => {
          // Diziler ve özel durumlar
          if (subKey === 'platforms' && key === 'social') {
            // Social platformlar - mevcut platformları kullan
            mergedSettings[key][subKey] = existingSettings[key][subKey] || defaultSettings[key][subKey];
          } else if (subKey === 'questions' && key === 'feedback') {
            // Feedback soruları - mevcut soruları kullan, yoksa varsayılanı
            mergedSettings[key][subKey] = existingSettings[key][subKey] || defaultSettings[key][subKey];
          } else if (subKey === 'logo' && key === 'components') {
            // Logo - varsayılan değerleri mevcut değerlerle birleştir
            mergedSettings[key][subKey] = {
              ...defaultSettings[key][subKey],
              ...existingSettings[key][subKey]
            };
          } else if (subKey === 'slider' && key === 'components') {
            // Slider - varsayılan değerleri mevcut değerlerle birleştir 
            mergedSettings[key][subKey] = {
              ...defaultSettings[key][subKey],
              ...existingSettings[key][subKey]
            };
            // Slides dizisini özel olarak kopyala
            if (existingSettings[key][subKey] && existingSettings[key][subKey].slides) {
              mergedSettings[key][subKey].slides = [...existingSettings[key][subKey].slides];
            }
          } else {
            // Diğer nested objeler
            mergedSettings[key][subKey] = existingSettings[key][subKey];
          }
        });
      } else {
        // Normal değerler
        mergedSettings[key] = existingSettings[key];
      }
    }
  });
  
  // Logo bilgilerini kontrol et - ÖNEMLİ: HER DURUMDA KONTROL ET
  console.log("Logo kontrolü yapılıyor...");
  if (!mergedSettings.components) {
    console.log("components nesnesi eksik, varsayılan değer ekleniyor");
    mergedSettings.components = JSON.parse(JSON.stringify(defaultSettings.components));
  } 
  
  if (!mergedSettings.components.logo) {
    console.log("logo nesnesi eksik, varsayılan değer ekleniyor");
    mergedSettings.components.logo = JSON.parse(JSON.stringify(defaultSettings.components.logo));
  } else {
    console.log("Mevcut logo ayarları:", mergedSettings.components.logo);
    // Logo URL'si yoksa veya boşsa, varsayılan URL'yi ekle
    if (!mergedSettings.components.logo.url) {
      console.log("Logo URL'si eksik, varsayılan URL ekleniyor");
      mergedSettings.components.logo.url = defaultSettings.components.logo.url;
    }
  }
  
  // Feedback soruları kontrol
  if (!mergedSettings.feedback || !mergedSettings.feedback.questions) {
    console.log("Feedback soruları eksik, varsayılan soruları ekliyorum");
    mergedSettings.feedback = mergedSettings.feedback || {};
    mergedSettings.feedback.questions = defaultSettings.feedback.questions;
  } else {
    console.log(`Feedback soruları mevcut: ${mergedSettings.feedback.questions.length} adet`);
  }
  
  // Social kontrol 
  if (!mergedSettings.social || !mergedSettings.social.platforms) {
    console.log("Social platformlar eksik, varsayılan platformları ekliyorum");
    mergedSettings.social = mergedSettings.social || {};
    mergedSettings.social.platforms = defaultSettings.social.platforms;
  } else {
    console.log(`Social platformlar mevcut: ${mergedSettings.social.platforms.length} adet`);
  }

  return mergedSettings;
}

// PROTECTED ROUTE - Tema ayarlarını getir (Admin panel için)
router.get('/settings/:type/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';

    console.log(`Admin tema ayarları istendi - Tip: ${type}, ID: ${id}, Kullanıcı: ${req.user.username} (${req.user.role})`);

    // Authorization checks based on user role
    if (req.user.role === 'branch_manager') {
      if (type === 'branch' && req.user.branch_id !== parseInt(id)) {
        console.log(`Yetki hatası: Branch manager branch_id=${req.user.branch_id}, Erişilmeye çalışılan branch_id=${id}`);
        return res.status(403).json({ error: 'Bu şubenin tema ayarlarına erişim yetkiniz yok' });
      }
      if (type === 'brand') {
        return res.status(403).json({ error: 'Şube yöneticileri marka tema ayarlarına erişemez' });
      }
    } else if (req.user.role === 'brand_manager') {
      if (type === 'brand' && req.user.brand_id !== parseInt(id)) {
        console.log(`Yetki hatası: Brand manager brand_id=${req.user.brand_id}, Erişilmeye çalışılan brand_id=${id}`);
        return res.status(403).json({ error: 'Bu markanın tema ayarlarına erişim yetkiniz yok' });
      }
      if (type === 'branch') {
        // Check if the branch belongs to the brand manager's brand
        const branchCheck = await db.query(
          'SELECT brand_id FROM branches WHERE id = $1',
          [id]
        );
        if (branchCheck.rows.length === 0 || branchCheck.rows[0].brand_id !== req.user.brand_id) {
          return res.status(403).json({ error: 'Bu şubenin tema ayarlarına erişim yetkiniz yok' });
        }
      }
    }

    const result = await db.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    // Varsayılan tema ayarlarını oluştur
    const defaultSettings = getDefaultThemeSettings();
    console.log("Varsayılan tema ayarlarında soru sayısı:", defaultSettings.feedback?.questions?.length || 0);
    
    if (result.rows.length === 0) {
      console.log(`${type} ID ${id} bulunamadı, varsayılan tema ayarları gönderiliyor`);
      return res.json(defaultSettings);
    }

    // Mevcut tema ayarları
    const existingSettings = result.rows[0].theme_settings || {};
    console.log(`Admin: ${type} ID ${id} için mevcut ayarlar:`, JSON.stringify(existingSettings, null, 2));
    
    // Varsayılan ayarlarla birleştir için DEEP MERGE yapılmalı
    const mergedSettings = JSON.parse(JSON.stringify(defaultSettings)); // Deep copy
    
    // Üst seviye nesneleri birleştir
    Object.keys(existingSettings).forEach(key => {
      if (existingSettings[key]) {
        // Özel durumlar - Nested objeler için
        if (key === 'social' || key === 'feedback' || key === 'components') {
          mergedSettings[key] = mergedSettings[key] || {};
          Object.keys(existingSettings[key]).forEach(subKey => {
            // Diziler ve özel durumlar
            if (subKey === 'platforms' && key === 'social') {
              // Social platformlar - mevcut platformları kullan
              mergedSettings[key][subKey] = existingSettings[key][subKey] || defaultSettings[key][subKey];
            } else if (subKey === 'questions' && key === 'feedback') {
              // Feedback soruları - mevcut soruları kullan, yoksa varsayılanı
              mergedSettings[key][subKey] = existingSettings[key][subKey] || defaultSettings[key][subKey];
            } else if (subKey === 'logo' && key === 'components') {
              // Logo - varsayılan değerleri mevcut değerlerle birleştir
              mergedSettings[key][subKey] = {
                ...defaultSettings[key][subKey],
                ...existingSettings[key][subKey]
              };
            } else {
              // Diğer nested objeler
              mergedSettings[key][subKey] = existingSettings[key][subKey];
            }
          });
        } else {
          // Normal değerler
          mergedSettings[key] = existingSettings[key];
        }
      }
    });
    
    // Logo bilgilerini kontrol et - ÖNEMLİ: HER DURUMDA KONTROL ET
    console.log("Admin: Logo kontrolü yapılıyor...");
    if (!mergedSettings.components) {
      console.log("components nesnesi eksik, varsayılan değer ekleniyor");
      mergedSettings.components = JSON.parse(JSON.stringify(defaultSettings.components));
    } 
    
    if (!mergedSettings.components.logo) {
      console.log("logo nesnesi eksik, varsayılan değer ekleniyor");
      mergedSettings.components.logo = JSON.parse(JSON.stringify(defaultSettings.components.logo));
    } else {
      console.log("Mevcut logo ayarları:", mergedSettings.components.logo);
      // Logo URL'si yoksa veya boşsa, varsayılan URL'yi ekle
      if (!mergedSettings.components.logo.url) {
        console.log("Logo URL'si eksik, varsayılan URL ekleniyor");
        mergedSettings.components.logo.url = defaultSettings.components.logo.url;
      }
    }
    
    // Feedback soruları kontrol
    if (!mergedSettings.feedback || !mergedSettings.feedback.questions) {
      console.log("Feedback soruları eksik, varsayılan soruları ekliyorum");
      mergedSettings.feedback = mergedSettings.feedback || {};
      mergedSettings.feedback.questions = defaultSettings.feedback.questions;
    } else {
      console.log(`Feedback soruları mevcut: ${mergedSettings.feedback.questions.length} adet`);
    }
    
    // Social kontrol 
    if (!mergedSettings.social || !mergedSettings.social.platforms) {
      console.log("Social platformlar eksik, varsayılan platformları ekliyorum");
      mergedSettings.social = mergedSettings.social || {};
      mergedSettings.social.platforms = defaultSettings.social.platforms;
    } else {
      console.log(`Social platformlar mevcut: ${mergedSettings.social.platforms.length} adet`);
    }

    console.log(`${type} ID ${id} için tema ayarları gönderiliyor (admin), logo URL:`, mergedSettings.components?.logo?.url);
    res.json(mergedSettings);
  } catch (err) {
    console.error('Tema ayarları alınırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları alınamadı' });
  }
});

// Tema ayarlarını güncelle
router.put('/settings/:type/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { type, id } = req.params;
    const { settings } = req.body;
    const table = type === 'brand' ? 'brands' : 'branches';

    console.log(`Tema ayarları güncelleniyor - Tip: ${type}, ID: ${id}, Tablo: ${table}`);
    console.log('Ayarlar:', JSON.stringify(settings, null, 2));

    // İlgili kaydın var olduğunu kontrol et
    const checkQuery = await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);

    if (checkQuery.rows.length === 0) {
      console.log(`HATA: ${id} ID'li ${type} bulunamadı!`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Kayıt bulunamadı' });
    }

    // Authorization checks based on user role
    if (req.user.role === 'branch_manager') {
      if (type === 'branch' && req.user.branch_id !== parseInt(id)) {
        console.log(`HATA: Branch manager (ID: ${req.user.id}) yetki hatası - Kendi şubesi: ${req.user.branch_id}, Güncellenmeye çalışılan şube: ${id}`);
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Bu şubenin tema ayarlarını güncelleme yetkiniz yok' });
      }
      if (type === 'brand') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Şube yöneticileri marka tema ayarlarını güncelleyemez' });
      }
    } else if (req.user.role === 'brand_manager') {
      if (type === 'brand' && req.user.brand_id !== parseInt(id)) {
        console.log(`HATA: Brand manager (ID: ${req.user.id}) yetki hatası - Kendi markası: ${req.user.brand_id}, Güncellenmeye çalışılan marka: ${id}`);
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Bu markanın tema ayarlarını güncelleme yetkiniz yok' });
      }
      if (type === 'branch') {
        // Check if the branch belongs to the brand manager's brand
        const record = checkQuery.rows[0];
        if (record.brand_id !== req.user.brand_id) {
          console.log(`HATA: Brand manager (ID: ${req.user.id}) yetki hatası - Şube ${id} markası ${record.brand_id}, kullanıcı markası ${req.user.brand_id}`);
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Bu şubenin tema ayarlarını güncelleme yetkiniz yok' });
        }
      }
    }

    // Mevcut ayarları al
    const currentResult = await client.query(`
      SELECT theme_settings 
      FROM ${table} 
      WHERE id = $1
    `, [id]);

    const oldSettings = currentResult.rows[0]?.theme_settings || {};
    
    // Varsayılan tema ayarlarıyla birleştir, eksik kalan ayarlar varsayılan değerleri alır
    const defaultSettings = getDefaultThemeSettings();
    const mergedSettings = { ...defaultSettings, ...settings };
    
    // Özel olarak social ve feedback alanlarını işle
    if (!mergedSettings.social) {
      mergedSettings.social = defaultSettings.social;
    } else if (!mergedSettings.social.platforms) {
      mergedSettings.social.platforms = defaultSettings.social.platforms;
    }
    
    if (!mergedSettings.feedback) {
      mergedSettings.feedback = defaultSettings.feedback;
    } else if (!mergedSettings.feedback.questions) {
      mergedSettings.feedback.questions = defaultSettings.feedback.questions;
    }
    
    // Logo bilgilerini kontrol et - ÖNEMLİ: HER DURUMDA KONTROL ET
    console.log("Güncelleme: Logo kontrolü yapılıyor...");
    if (!mergedSettings.components) {
      console.log("components nesnesi eksik, varsayılan değer ekleniyor");
      mergedSettings.components = JSON.parse(JSON.stringify(defaultSettings.components));
    } 
    
    if (!mergedSettings.components.logo) {
      console.log("logo nesnesi eksik, varsayılan değer ekleniyor");
      mergedSettings.components.logo = JSON.parse(JSON.stringify(defaultSettings.components.logo));
    } else {
      console.log("Mevcut logo ayarları:", mergedSettings.components.logo);
      // Logo URL'si yoksa veya boşsa, varsayılan URL'yi ekle
      if (!mergedSettings.components.logo.url) {
        console.log("Logo URL'si eksik, varsayılan URL ekleniyor");
        mergedSettings.components.logo.url = defaultSettings.components.logo.url;
      }
    }

    // Ayarları güncelle
    const updateResult = await client.query(`
      UPDATE ${table}
      SET theme_settings = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, theme_settings
    `, [mergedSettings, id]);

    // Eğer veriler güncellenmediyse (örneğin, ID bulunamadı), hata ver
    if (updateResult.rows.length === 0) {
      console.log(`HATA: ${id} ID'li ${type} güncellenemedi!`);
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `${type === 'brand' ? 'Marka' : 'Şube'} bulunamadı veya güncellenemedi` });
    }

    // Değişiklik logunu kaydet
    try {
      await client.query(`
        INSERT INTO theme_change_logs 
        (${type}_id, changed_by, old_settings, new_settings)
        VALUES ($1, $2, $3, $4)
      `, [id, req.user.id, oldSettings, mergedSettings]);

      console.log(`Tema değişiklik logu kaydedildi - ${type}_id: ${id}, user_id: ${req.user.id}`);
    } catch (logError) {
      // Log kaydı hatası olsa bile işleme devam et
      console.warn('Tema değişiklik logu kaydedilirken hata:', logError.message);
    }

    await client.query('COMMIT');

    console.log('Güncelleme başarılı - Sonuç:', updateResult.rows);

    // Başarılı yanıt
    res.json({
      success: true,
      message: 'Tema ayarları güncellendi',
      settings: updateResult.rows[0].theme_settings
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tema ayarları güncellenirken hata:', err);
    res.status(500).json({ error: 'Tema ayarları güncellenemedi', details: err.message });
  } finally {
    client.release();
  }
});

// Tema şablonlarını getir
router.get('/templates', authorize(['super_admin']), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM theme_templates ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Tema şablonları alınırken hata:', err);
    res.status(500).json({ error: 'Tema şablonları alınamadı' });
  }
});

// Tema şablonu oluştur
router.post('/templates', authorize(['super_admin']), async (req, res) => {
  try {
    const { name, description, settings, is_default } = req.body;

    if (is_default) {
      // Mevcut varsayılanı kaldır
      await db.query('UPDATE theme_templates SET is_default = false WHERE is_default = true');
    }

    const result = await db.query(`
      INSERT INTO theme_templates (name, description, settings, is_default)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, description, settings, is_default || false]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Tema şablonu oluşturulurken hata:', err);
    res.status(500).json({ error: 'Tema şablonu oluşturulamadı' });
  }
});

// Tema şablonunu uygula
router.post('/apply-template/:templateId/:type/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { templateId, type, id } = req.params;
    const table = type === 'brand' ? 'brands' : 'branches';

    // Authorization checks
    if (req.user.role === 'branch_manager') {
      if (type === 'branch' && req.user.branch_id !== parseInt(id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Bu şubeye tema şablonu uygulama yetkiniz yok' });
      }
      if (type === 'brand') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Şube yöneticileri markaya tema şablonu uygulayamaz' });
      }
    } else if (req.user.role === 'brand_manager') {
      if (type === 'brand' && req.user.brand_id !== parseInt(id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Bu markaya tema şablonu uygulama yetkiniz yok' });
      }
      if (type === 'branch') {
        // Check if the branch belongs to the brand manager's brand
        const branchCheck = await client.query(
          'SELECT brand_id FROM branches WHERE id = $1',
          [id]
        );
        if (branchCheck.rows.length === 0 || branchCheck.rows[0].brand_id !== req.user.brand_id) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Bu şubeye tema şablonu uygulama yetkiniz yok' });
        }
      }
    }

    // Şablonu al
    const templateResult = await client.query('SELECT settings FROM theme_templates WHERE id = $1', [templateId]);

    if (templateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tema şablonu bulunamadı' });
    }

    // Ayarları uygula
    const settings = templateResult.rows[0].settings;

    await client.query(`
      UPDATE ${table}
      SET theme_settings = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [settings, id]);

    // Log kaydet
    await client.query(`
      INSERT INTO theme_change_logs 
      (${type}_id, changed_by, old_settings, new_settings)
      VALUES ($1, $2, $3, $4)
    `, [id, req.user.id, {}, settings]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Tema şablonu uygulandı',
      settings
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Tema şablonu uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema şablonu uygulanamadı' });
  } finally {
    client.release();
  }
});

// Tema değişiklik geçmişini getir
router.get('/change-logs/:type/:id', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    // Authorization checks
    if (req.user.role === 'branch_manager') {
      if (type === 'branch' && req.user.branch_id !== parseInt(id)) {
        return res.status(403).json({ error: 'Bu şubenin değişiklik geçmişine erişim yetkiniz yok' });
      }
      if (type === 'brand') {
        return res.status(403).json({ error: 'Şube yöneticileri marka değişiklik geçmişine erişemez' });
      }
    } else if (req.user.role === 'brand_manager') {
      if (type === 'brand' && req.user.brand_id !== parseInt(id)) {
        return res.status(403).json({ error: 'Bu markanın değişiklik geçmişine erişim yetkiniz yok' });
      }
      if (type === 'branch') {
        // Check if the branch belongs to the brand manager's brand
        const branchCheck = await db.query(
          'SELECT brand_id FROM branches WHERE id = $1',
          [id]
        );
        if (branchCheck.rows.length === 0 || branchCheck.rows[0].brand_id !== req.user.brand_id) {
          return res.status(403).json({ error: 'Bu şubenin değişiklik geçmişine erişim yetkiniz yok' });
        }
      }
    }

    const result = await db.query(`
      SELECT 
        tcl.*,
        u.username as changed_by_username
      FROM theme_change_logs tcl
      LEFT JOIN users u ON tcl.changed_by = u.id
      WHERE tcl.${type}_id = $1
      ORDER BY tcl.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    res.json(result.rows);
  } catch (err) {
    console.error('Tema değişiklik logları alınırken hata:', err);
    res.status(500).json({ error: 'Değişiklik logları alınamadı' });
  }
});

// Markanın tema ayarlarını şubelerine uygula
router.post('/apply-brand-theme/:brandId', authorize(['super_admin', 'brand_manager']), async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const { brandId } = req.params;
    const { applyToAll = false, branchIds = [] } = req.body;
    
    // Authorization check for brand managers
    if (req.user.role === 'brand_manager' && req.user.brand_id !== parseInt(brandId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu markaya tema uygulama yetkiniz yok' });
    }
    
    // Markanın mevcut tema ayarlarını al
    const brandThemeResult = await client.query(
      'SELECT theme_settings FROM brands WHERE id = $1',
      [brandId]
    );
    
    if (brandThemeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    const brandThemeSettings = brandThemeResult.rows[0].theme_settings;
    
    if (!brandThemeSettings) {
      return res.status(400).json({ error: 'Markaya ait tema ayarları bulunamadı' });
    }
    
    // Hedef şubeleri belirle
    let targetBranchIds = [];
    
    if (applyToAll) {
      // Tüm şubelerin ID'lerini al
      const branchesResult = await client.query(
        'SELECT id FROM branches WHERE brand_id = $1',
        [brandId]
      );
      targetBranchIds = branchesResult.rows.map(branch => branch.id);
    } else {
      // Sadece belirtilen şubeleri kullan
      targetBranchIds = branchIds;
    }
    
    if (targetBranchIds.length === 0) {
      return res.status(400).json({ 
        error: 'Tema ayarlarını uygulanacak şube bulunamadı',
        message: 'Lütfen şubeleri seçin veya tüm şubelere uygula seçeneğini işaretleyin'
      });
    }
    
    // Her bir şubeye tema ayarlarını uygula
    for (const branchId of targetBranchIds) {

  // 1️⃣ Önce eski ayarları al (LOG İÇİN)
  const oldResult = await client.query(
    'SELECT theme_settings FROM branches WHERE id = $1',
    [branchId]
  );
  const oldSettings = oldResult.rows[0]?.theme_settings || {};

  // 2️⃣ JSON'u GÜVENLİ hale getir
  const safeThemeSettings =
    typeof brandThemeSettings === 'string'
      ? brandThemeSettings
      : JSON.stringify(brandThemeSettings);

  // 3️⃣ UPDATE → jsonb cast ile
  await client.query(
    `
    UPDATE branches
    SET theme_settings = $1::jsonb,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    `,
    [safeThemeSettings, branchId]
  );

  // 4️⃣ LOG → doğru eski + yeni
  await client.query(
    `
    INSERT INTO theme_change_logs
    (branch_id, changed_by, old_settings, new_settings, change_source)
    VALUES ($1, $2, $3, $4, 'brand_theme_sync')
    `,
    [
      branchId,
      req.user.id,
      oldSettings,
      safeThemeSettings
    ]
  );
}

    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: `Tema ayarları ${targetBranchIds.length} şubeye başarıyla uygulandı`,
      applied_to: targetBranchIds
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marka tema ayarları şubelere uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları uygulanamadı', details: err.message });
  } finally {
    client.release();
  }
});

// Yeni endpoint: Default ayarları al ve şubeye uygula
router.post('/apply-brand-defaults/:branchId', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const { branchId } = req.params;
    
    // Authorization check for branch managers
    if (req.user.role === 'branch_manager' && req.user.branch_id !== parseInt(branchId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu şubeye varsayılan tema uygulama yetkiniz yok' });
    }
    
    // Şubenin marka bilgisini al
    const branchResult = await client.query(
      'SELECT brand_id FROM branches WHERE id = $1',
      [branchId]
    );
    
    if (branchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Şube bulunamadı' });
    }
    
    const brandId = branchResult.rows[0].brand_id;
    
    if (!brandId) {
      return res.status(400).json({ error: 'Bu şube herhangi bir markaya ait değil' });
    }
    
    // Authorization check for brand managers
    if (req.user.role === 'brand_manager' && req.user.brand_id !== brandId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Bu şubeye varsayılan tema uygulama yetkiniz yok' });
    }
    
    // Markanın tema ayarlarını al
    const brandThemeResult = await client.query(
      'SELECT theme_settings FROM brands WHERE id = $1',
      [brandId]
    );
    
    if (brandThemeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marka bulunamadı' });
    }
    
    const brandThemeSettings = brandThemeResult.rows[0].theme_settings;
    
    if (!brandThemeSettings) {
      return res.status(400).json({ error: 'Markaya ait tema ayarları bulunamadı' });
    }
    
    // Şubenin mevcut tema ayarlarını kaydet (log için)
    const currentSettings = await client.query(
      'SELECT theme_settings FROM branches WHERE id = $1',
      [branchId]
    );
    
    // Tema ayarlarını şubeye uygula
    await client.query(
      'UPDATE branches SET theme_settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [brandThemeSettings, branchId]
    );
    
    // Tema değişiklik logu ekle
    await client.query(
    `INSERT INTO theme_change_logs
    (branch_id, changed_by, old_settings, new_settings, change_source)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, 'brand_default_applied')
    `,
  [
  branchId,
  req.user.id,
  JSON.stringify(currentSettings.rows[0].theme_settings || {}),
  JSON.stringify(brandThemeSettings)
  ]
  );

    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Marka varsayılan tema ayarları şubeye başarıyla uygulandı',
      branch_id: branchId,
      brand_id: brandId
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Marka varsayılan ayarları şubeye uygulanırken hata:', err);
    res.status(500).json({ error: 'Tema ayarları uygulanamadı', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
