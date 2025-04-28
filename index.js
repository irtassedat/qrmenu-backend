const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// CORS yapılandırması 
const corsOptions = {
  origin: function (origin, callback) {
    // Whitelist
    const allowedOrigins = [
      'http://localhost:5173',  // Vite dev server
      'http://localhost:5174',  // Alternatif port
      'http://localhost:3000',  // React dev server
      'https://qr.405found.tr',  // Prodüksiyon ortamı
      'https://www.qr.405found.tr',
      undefined  // Doğrudan sunucudan yapılan istekler
    ];
    				
    console.log('Request origin:', origin);
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.error('CORS blocked origin:', origin);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,  // withCredentials için gerekli
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS"
};

app.use(cors(corsOptions));

// JSON body parse ayarlarını güncelle - boyut limitlerini artır
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

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

// Route tanımlamaları
app.use('/api/products', productsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/auth', authRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/users', usersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/customer-auth', customerAuthRouter);
app.use('/api/theme', themeRouter); // Tema route'ları

// Upload için route (artık kullanılmıyor - theme.js'de yeni implementasyon var)
// Geriye dönük uyumluluk için tutulabilir (önerilmez)
app.post('/api/upload', (req, res) => {
  // Burada gerçek upload işlemi yapılacak
  // Şimdilik örnek bir URL dönüyoruz
  res.json({ url: '/uploads/example-image.jpg' });
});

// Test endpoint
app.get('/', (req, res) => {
  res.send('QR Menü Backend çalışıyor ✅');
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