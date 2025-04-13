const express = require('express');
const cors = require('cors');
require('dotenv').config();

const productRoutes = require('./routes/products');
const branchRoutes = require('./routes/branches');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');
const analyticsRoutes = require('./routes/analytics');
const { router: authRoutes } = require('./routes/auth');
const userRoutes = require('./routes/users');
const templatesRoutes = require('./routes/templates');
const integrationsRoutes = require('./routes/integrations');

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
app.use('/api/products', productRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/integrations', integrationsRoutes);
// Test endpoint
app.get('/', (req, res) => {
  res.send('QR Menü Backend çalışıyor ✅');
});

// Sunucuyu başlat
const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});