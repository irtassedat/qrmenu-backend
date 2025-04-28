const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS yapılandırması - Geliştirme ortamı için daha fazla izin ver
const corsOptions = {
  origin: function (origin, callback) {
    // Whitelist - Tüm olası domainleri ekleyin
    const allowedOrigins = [
      'http://localhost:5173',  // Vite dev server
      'http://localhost:5174',  // Alternatif port
      'http://localhost:3000',  // React dev server
      'https://qr.405found.tr',  // Prodüksiyon ortamı
      'https://www.qr.405found.tr',  // www ile
      undefined  // Doğrudan sunucudan yapılan istekler için
    ];
    
    // Debug için origin'i logla
    console.log('Request origin:', origin);
    
    // Origin null olabilir (örn. Postman istekleri)
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

// CORS middleware'i uygula
app.use(cors(corsOptions));

// JSON body parse
app.use(express.json());

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
const themeRouter = require('./routes/theme'); // Tema route'ları

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

// Upload için route (basit implementasyon)
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

// Sunucuyu başlat
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});