const express = require('express');
const cors = require('cors');
require('dotenv').config();

const productRoutes = require('./routes/products');
const branchRoutes = require('./routes/branches');
const categoryRoutes = require('./routes/categories');
const orderRoutes = require('./routes/orders');

const app = express();

// Middlewares
app.use(cors()); // Tüm originlerden gelen istekleri kabul eder (güvenlik için prod ortamda sınırlandırılır)
app.use(express.json()); // JSON body parse eder

// Routes
app.use('/api/products', productRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/orders', orderRoutes);

// Test endpoint
app.get('/', (req, res) => {
  res.send('QR Menü Backend çalışıyor ✅');
});

// Sunucuyu başlat
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
