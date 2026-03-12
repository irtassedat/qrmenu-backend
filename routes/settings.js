const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { authorize } = require('./auth');

const router = express.Router();

const SETTINGS_FILE_PATH = path.join(__dirname, '..', 'default-settings.json');
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const DEFAULT_PRODUCT_IMAGE_FILENAME = 'default-product.webp';
const DEFAULT_PRODUCT_IMAGE_URL = `/uploads/${DEFAULT_PRODUCT_IMAGE_FILENAME}`;

const ensureUploadDir = () => {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
};

const parseBrandId = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const normalizeSettings = (settings = {}) => {
  const normalized = { ...settings };

  if (typeof normalized.default_product_image !== 'string') {
    normalized.default_product_image = DEFAULT_PRODUCT_IMAGE_URL;
  }

  if (
    !normalized.brand_default_images
    || typeof normalized.brand_default_images !== 'object'
    || Array.isArray(normalized.brand_default_images)
  ) {
    normalized.brand_default_images = {};
  }

  return normalized;
};

const readSettings = () => {
  try {
    if (!fs.existsSync(SETTINGS_FILE_PATH)) {
      return normalizeSettings({});
    }

    const raw = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
    return normalizeSettings(raw ? JSON.parse(raw) : {});
  } catch (err) {
    console.error('Default settings okunamadı:', err.message);
    return normalizeSettings({});
  }
};

const writeSettings = (settings) => {
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(normalized, null, 2), 'utf8');
};

const commonUploadOptions = {
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file?.mimetype?.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Yalnızca görsel dosyaları yüklenebilir'));
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, DEFAULT_PRODUCT_IMAGE_FILENAME);
  }
});

const upload = multer({
  storage,
  ...commonUploadOptions
});

const brandUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.tmp';
    cb(null, `brand-default-temp-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  }
});

const brandUpload = multer({
  storage: brandUploadStorage,
  ...commonUploadOptions
});

const removeUploadedFileIfExists = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.error('Yüklenen dosya temizlenemedi:', cleanupError.message);
    }
  }
};

// GET /api/settings/default-image (PUBLIC)
router.get('/default-image', (req, res) => {
  const settings = readSettings();
  const savedImageUrl = settings.default_product_image || '';

  res.json({
    default_image_url: savedImageUrl
  });
});

// GET /api/settings/brand-default-image/:brandId (PUBLIC)
router.get('/brand-default-image/:brandId', (req, res) => {
  const brandId = parseBrandId(req.params.brandId);
  if (!brandId) {
    return res.status(400).json({ error: 'Geçersiz brandId' });
  }

  const settings = readSettings();
  const globalDefaultImage = settings.default_product_image || '';
  const brandDefaults = settings.brand_default_images || {};
  const brandDefaultImage = brandDefaults[String(brandId)] || '';

  return res.json({
    default_image_url: brandDefaultImage || globalDefaultImage || '',
    brand_image_url: brandDefaultImage || '',
    global_default_image_url: globalDefaultImage || '',
    uses_global_default: !brandDefaultImage
  });
});

// POST /api/settings/default-image (SUPER ADMIN)
router.post('/default-image', authorize(['super_admin']), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('Varsayılan görsel yükleme hatası:', err.message);
      return res.status(400).json({ error: err.message || 'Görsel yüklenemedi' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'image alanı zorunludur' });
    }

    try {
      const settings = readSettings();
      settings.default_product_image = DEFAULT_PRODUCT_IMAGE_URL;
      writeSettings(settings);

      return res.json({
        success: true,
        default_image_url: DEFAULT_PRODUCT_IMAGE_URL
      });
    } catch (writeErr) {
      console.error('Varsayılan görsel ayarı kaydedilemedi:', writeErr.message);
      return res.status(500).json({ error: 'Ayar kaydedilemedi' });
    }
  });
});

// POST /api/settings/brand-default-image (SUPER ADMIN ve BRAND MANAGER)
router.post('/brand-default-image', authorize(['super_admin', 'brand_manager']), (req, res) => {
  brandUpload.single('image')(req, res, async (err) => {
    if (err) {
      console.error('Marka varsayılan görsel yükleme hatası:', err.message);
      return res.status(400).json({ error: err.message || 'Görsel yüklenemedi' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'image alanı zorunludur' });
    }

    const cleanupFile = () => removeUploadedFileIfExists(req.file?.path);

    try {
      let targetBrandId = null;

      if (req.user?.role === 'super_admin') {
        targetBrandId = parseBrandId(req.body?.brand_id);
        if (!targetBrandId) {
          cleanupFile();
          return res.status(400).json({ error: 'Super admin için brand_id zorunludur' });
        }
      } else {
        targetBrandId = parseBrandId(req.user?.brand_id);
        if (!targetBrandId) {
          cleanupFile();
          return res.status(400).json({ error: 'Kullanıcı için brand_id bulunamadı' });
        }
      }

      const brandCheck = await db.query('SELECT id FROM brands WHERE id = $1 LIMIT 1', [targetBrandId]);
      if (brandCheck.rows.length === 0) {
        cleanupFile();
        return res.status(400).json({ error: 'Geçersiz brand_id' });
      }

      const targetFilename = `brand-${targetBrandId}-default.webp`;
      const targetFilePath = path.join(UPLOAD_DIR, targetFilename);
      const targetImageUrl = `/uploads/${targetFilename}`;

      if (req.file.path !== targetFilePath) {
        fs.renameSync(req.file.path, targetFilePath);
      }

      const settings = readSettings();
      settings.brand_default_images[String(targetBrandId)] = targetImageUrl;
      writeSettings(settings);

      return res.json({
        success: true,
        brand_id: targetBrandId,
        default_image_url: targetImageUrl,
        brand_image_url: targetImageUrl,
        global_default_image_url: settings.default_product_image || '',
        uses_global_default: false
      });
    } catch (writeErr) {
      cleanupFile();
      console.error('Marka varsayılan görsel ayarı kaydedilemedi:', writeErr.message);
      return res.status(500).json({ error: 'Ayar kaydedilemedi' });
    }
  });
});

module.exports = router;
