// CORS ayarlarını düzeltmek için yardımcı script
const fs = require('fs');
const path = require('path');

const indexJsPath = path.join(__dirname, 'index.js');
let indexContent = fs.readFileSync(indexJsPath, 'utf8');

// Mevcut CORS ayarlarını bul ve değiştir
const corsConfigRegex = /\/\/ CORS yapılandırması[\s\S]*?app\.use\(cors\([^)]*\)\);/;
const newCorsConfig = `// CORS yapılandırması - Basit ve tamamen açık
app.use(cors());

// CORS Pre-flight isteklerini ele al
app.options('*', cors());

// CORS header'larını manuel olarak ekle
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  next();
});`;

// Değiştirme yap
if (corsConfigRegex.test(indexContent)) {
  indexContent = indexContent.replace(corsConfigRegex, newCorsConfig);
  console.log('CORS yapılandırması değiştirildi.');
} else {
  console.log('CORS yapılandırması bulunamadı, kontrol edin.');
}

// Dosyayı kaydet
fs.writeFileSync(indexJsPath, indexContent, 'utf8');
console.log('index.js güncellendi.');