const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Request Logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// CORS yapılandırması - Basit ve tamamen açık
app.use(cors());

// CORS Pre-flight isteklerini ele al
app.options('*', cors());

// CORS header'larını manuel olarak ekle
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  next();
});

// JSON body parse ayarlarını güncelle - boyut limitlerini artır
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static dosya klasörleri
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use('/category', express.static(path.join(__dirname, 'public/category')));

// Routes
const productsRouter = require('./routes/products');
const categoriesRouter = require('./routes/categories');
const branchesRouter = require('./routes/branches');
const ordersRouter = require('./routes/orders');
const { router: authRouter } = require('./routes/auth');
const templatesRouter = require('./routes/templates');
const integrationsRouter = require('./routes/integrations');
const usersRouter = require('./routes/users');
const analyticsRouter = require('./routes/analytics');
const brandsRouter = require('./routes/brands');
const dashboardRouter = require('./routes/dashboard');
const loyaltyRouter = require('./routes/loyalty');
const { router: customerAuthRouter } = require('./routes/customer-auth');
const themeRouter = require('./routes/theme');
const waiterCallsRouter = require('./routes/waiterCalls');
const waiterDashboardRouter = require('./routes/waiterDashboard');
const cartSettingsRouter = require('./routes/cart-settings');
const adminRouter = require('./routes/admin');
const categoryManagementRouter = require('./routes/categoryManagement');
const permissionsRouter = require('./routes/permissions');
const settingsRouter = require('./routes/settings');
const { checkMasterPassword } = require('./middleware/licenseCheck');

// Route tanımlamaları
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auth', authRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/users', checkMasterPassword, usersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/customer-auth', customerAuthRouter);
app.use('/api/theme', themeRouter); // Tema route'ları
app.use('/api/waiter-calls', waiterCallsRouter); // Garson çağrı route'ları
app.use('/api/waiter-dashboard', waiterDashboardRouter); // Garson dashboard route'ları
app.use('/api/cart-settings', cartSettingsRouter); // Sepet ayarları route'ları
app.use('/api/admin', adminRouter); // Admin paneli route'ları
app.use('/api/category-management', categoryManagementRouter); // Kategori yönetimi route'ları
app.use('/api/permissions', permissionsRouter); // Yetkilendirme route'ları
app.use('/api/settings', settingsRouter); // Genel ayarlar route'ları

// Upload için route (artık kullanılmıyor - theme.js'de yeni implementasyon var)
// Geriye dönük uyumluluk için tutulabilir (önerilmez)
app.post('/api/upload', (req, res) => {
  // Burada gerçek upload işlemi yapılacak
  // Şimdilik örnek bir URL dönüyoruz
  res.json({ url: '/uploads/example-image.jpg' });
});

// Slug-based public menu routing - MUST be before static files!
// Bu route static file serving'den ÖNCE olmalı
app.get('/:brand_slug/:branch_slug', async (req, res, next) => {
  try {
    const { brand_slug, branch_slug } = req.params;
    const full_slug = `${brand_slug}/${branch_slug}`;

    // Skip if this looks like an admin route, API route, or file request
    if (req.path.startsWith('/admin') ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/assets') ||
        req.path.startsWith('/uploads') ||
        req.path.startsWith('/logos') ||
        req.path.startsWith('/category') ||
        req.path.includes('.') || // Skip file requests (has extension)
        brand_slug === 'menu') { // Skip /menu/... routes
      return next();
    }

    // Check if this is a valid branch full_slug
    const db = require('./db');
    const result = await db.query('SELECT id FROM branches WHERE full_slug = $1', [full_slug]);

    if (result.rows.length > 0) {
      // Redirect to /menu/:id for React Router to handle
      console.log(`✅ Slug routing: ${full_slug} -> /menu/${result.rows[0].id}`);
      return res.redirect(301, `/menu/${result.rows[0].id}`);
    }

    // Not a branch slug, continue to next middleware
    next();
  } catch (err) {
    console.error('❌ Slug routing error:', err);
    next();
  }
});

// Serve static frontend files (AFTER slug routing)
app.use(express.static(path.join(__dirname, 'public')));

// Test endpoint - Ana sayfa React app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SPA fallback - Frontend routing için (admin, menu, vb.)
app.get('*', (req, res, next) => {
  // API route'ları için fallback yapma
  if (req.path.startsWith('/api/')) {
    return next();
  }
  // Frontend route'ları için index.html döndür
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hata yakalama middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Sunucu hatası',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📁 Uploads accessible at: http://localhost:${PORT}/uploads`);
});
