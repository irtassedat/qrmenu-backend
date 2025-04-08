// routes/analytics.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // veritabanı bağlantınız

// 1. Olay izleme endpoint'i - frontend'den gelen olayları kaydet
router.post('/events/track', async (req, res) => {
  try {
    const { 
      event_type,         // olay tipi (ör. 'page_view', 'product_click')
      product_id,         // ilgili ürün ID'si (varsa)
      user_id,            // kullanıcı ID'si (varsa)
      session_id,         // oturum ID'si (gerekli)
      page_url,           // olay sayfası URL'si
      element_id,         // tıklanan elementin ID'si
      element_class,      // tıklanan elementin sınıfı
      element_tag,        // tıklanan elementin tag'i
      element_text,       // tıklanan elementin metni
      x, y,               // tıklama koordinatları
      screen_x, screen_y, // ekran koordinatları
      window_width,
      window_height,
      metadata            // diğer bilgiler JSON olarak
    } = req.body;
    
    // Zorunlu alanları kontrol et
    if (!event_type || !session_id || !page_url) {
      return res.status(400).json({ error: 'Zorunlu alanlar eksik: event_type, session_id, page_url' });
    }
    
    // Olayı veritabanına kaydet
    const result = await db.query(`
      INSERT INTO events (
        event_type, product_id, user_id, session_id, page_url,
        element_id, element_class, element_tag, element_text,
        x, y, screen_x, screen_y, window_width, window_height,
        metadata, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id
    `, [
      event_type, product_id, user_id, session_id, page_url,
      element_id, element_class, element_tag, element_text,
      x, y, screen_x, screen_y, window_width, window_height,
      metadata ? JSON.stringify(metadata) : null
    ]);
    
    res.json({ 
      success: true, 
      id: result.rows[0].id,
      message: `${event_type} olayı başarıyla kaydedildi` 
    });
  } catch (err) {
    console.error('Olay izleme hatası:', err.message);
    res.status(500).json({ error: 'Olay kaydedilemedi', details: err.message });
  }
});

// 2. Popüler ürünleri getirme endpoint'i
router.get('/popular-products', async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    // Zaman aralığını hesapla
    let interval;
    switch (timeRange) {
      case 'day': interval = '1 day'; break;
      case 'week': interval = '7 days'; break;
      case 'month': interval = '30 days'; break;
      case 'quarter': interval = '90 days'; break;
      default: interval = '7 days';
    }
    
    // En çok görüntülenen ve sepete eklenen ürünleri getir
    const result = await db.query(`
      WITH product_views AS (
        SELECT 
          product_id,
          COUNT(*) as view_count
        FROM events
        WHERE 
          event_type = 'product_view'
          AND created_at > NOW() - INTERVAL '${interval}'
          AND product_id IS NOT NULL
        GROUP BY product_id
      ),
      cart_adds AS (
        SELECT 
          product_id,
          COUNT(*) as cart_count
        FROM events
        WHERE 
          event_type = 'add_to_cart'
          AND created_at > NOW() - INTERVAL '${interval}'
          AND product_id IS NOT NULL
        GROUP BY product_id
      )
      SELECT 
        p.id, 
        p.name, 
        p.category_id, 
        c.name as category_name,
        COALESCE(pv.view_count, 0) as view_count,
        COALESCE(ca.cart_count, 0) as cart_count,
        (COALESCE(pv.view_count, 0) + COALESCE(ca.cart_count, 0) * 2) as total_score
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN product_views pv ON p.id = pv.product_id
      LEFT JOIN cart_adds ca ON p.id = ca.product_id
      WHERE (pv.view_count > 0 OR ca.cart_count > 0)
      ORDER BY total_score DESC
      LIMIT 10
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Popüler ürünler alınırken hata:', err.message);
    res.status(500).json({ error: 'Veriler alınamadı', details: err.message });
  }
});

// 3. Sayfa görüntülemelerini getirme endpoint'i
router.get('/page-views', async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    // Zaman aralığını ve format'ı belirle
    let interval, format;
    switch (timeRange) {
      case 'day': 
        interval = '1 day'; 
        format = 'HH24:MI';
        break;
      case 'week': 
        interval = '7 days'; 
        format = 'DD/MM';
        break;
      case 'month': 
        interval = '30 days'; 
        format = 'DD/MM';
        break;
      case 'quarter': 
        interval = '90 days'; 
        format = 'MM/YYYY';
        break;
      default: 
        interval = '7 days'; 
        format = 'DD/MM';
    }
    
    // Sayfa görüntülemelerini zaman bazlı getir
    const result = await db.query(`
      SELECT 
        TO_CHAR(DATE_TRUNC('day', created_at), '${format}') as date,
        COUNT(*) as views
      FROM events
      WHERE 
        event_type = 'page_view'
        AND created_at > NOW() - INTERVAL '${interval}'
      GROUP BY DATE_TRUNC('day', created_at), date
      ORDER BY DATE_TRUNC('day', created_at)
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Sayfa görüntülemeleri alınırken hata:', err.message);
    res.status(500).json({ error: 'Veriler alınamadı', details: err.message });
  }
});

// 4. Tıklama (ısı haritası) verilerini getirme endpoint'i
router.get('/clicks', async (req, res) => {
  try {
    const { timeRange = 'week', page = 'all' } = req.query;
    
    // Zaman aralığını hesapla
    let interval;
    switch (timeRange) {
      case 'day': interval = '1 day'; break;
      case 'week': interval = '7 days'; break;
      case 'month': interval = '30 days'; break;
      case 'quarter': interval = '90 days'; break;
      default: interval = '7 days';
    }
    
    // Sayfa filtresi
    let pageFilter = '';
    if (page !== 'all') {
      pageFilter = `AND page_url LIKE '%/${page}%'`;
    }
    
    // Tıklama koordinatlarını getir
    const result = await db.query(`
      SELECT 
        x, 
        y,
        COUNT(*) as value
      FROM events
      WHERE 
        event_type = 'click'
        AND created_at > NOW() - INTERVAL '${interval}'
        AND x IS NOT NULL
        AND y IS NOT NULL
        ${pageFilter}
      GROUP BY x, y
      HAVING COUNT(*) > 1
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Tıklama verileri alınırken hata:', err.message);
    res.status(500).json({ error: 'Veriler alınamadı', details: err.message });
  }
});

// 5. Genel istatistik bilgilerini getirme endpoint'i
router.get('/stats', async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    // Zaman aralığını hesapla
    let interval;
    switch (timeRange) {
      case 'day': interval = '1 day'; break;
      case 'week': interval = '7 days'; break;
      case 'month': interval = '30 days'; break;
      case 'quarter': interval = '90 days'; break;
      default: interval = '7 days';
    }
    
    // Dönüşüm oranı: (sipariş tamamlama / ürün detayı görüntüleme)
    const conversionResult = await db.query(`
      WITH order_sessions AS (
        SELECT COUNT(DISTINCT session_id) as count
        FROM events
        WHERE 
          event_type = 'order_complete'
          AND created_at > NOW() - INTERVAL '${interval}'
      ),
      product_view_sessions AS (
        SELECT COUNT(DISTINCT session_id) as count
        FROM events
        WHERE 
          event_type = 'product_view'
          AND created_at > NOW() - INTERVAL '${interval}'
      )
      SELECT 
        COALESCE(
          ROUND((o.count::numeric / NULLIF(p.count, 0)::numeric) * 100, 1),
          0
        ) as conversion_rate
      FROM order_sessions o, product_view_sessions p
    `);
    
    // Ortalama oturum süresi
    const timeResult = await db.query(`
      WITH session_times AS (
        SELECT 
          session_id,
          MAX(created_at) - MIN(created_at) as session_duration
        FROM events
        WHERE 
          created_at > NOW() - INTERVAL '${interval}'
        GROUP BY session_id
        HAVING COUNT(*) > 1
      )
      SELECT 
        CONCAT(
          EXTRACT(MINUTE FROM AVG(session_duration))::integer, 
          ':', 
          LPAD(EXTRACT(SECOND FROM AVG(session_duration))::integer::text, 2, '0')
        ) as average_time
      FROM session_times
    `);
    
    // Toplam tıklama sayısı
    const clicksResult = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE 
        event_type = 'click'
        AND created_at > NOW() - INTERVAL '${interval}'
    `);
    
    // Toplam sayfa görüntüleme
    const viewsResult = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE 
        event_type = 'page_view'
        AND created_at > NOW() - INTERVAL '${interval}'
    `);
    
    res.json({
      conversion_rate: conversionResult.rows[0]?.conversion_rate || 0,
      average_time: timeResult.rows[0]?.average_time || '0:00',
      clicks: parseInt(clicksResult.rows[0]?.count || 0),
      views: parseInt(viewsResult.rows[0]?.count || 0)
    });
  } catch (err) {
    console.error('İstatistik verileri alınırken hata:', err.message);
    res.status(500).json({ error: 'Veriler alınamadı', details: err.message });
  }
});

// 6. Kategori bazlı popülerlik analizi
router.get('/category-popularity', async (req, res) => {
  try {
    const { timeRange = 'week' } = req.query;
    
    // Zaman aralığını hesapla
    let interval;
    switch (timeRange) {
      case 'day': interval = '1 day'; break;
      case 'week': interval = '7 days'; break;
      case 'month': interval = '30 days'; break;
      case 'quarter': interval = '90 days'; break;
      default: interval = '7 days';
    }
    
    // Her kategori için ürün görüntüleme ve sepete ekleme sayılarını hesapla
    const result = await db.query(`
      WITH category_events AS (
        SELECT 
          c.id as category_id,
          c.name as category_name,
          e.event_type,
          COUNT(*) as event_count
        FROM events e
        JOIN products p ON e.product_id = p.id
        JOIN categories c ON p.category_id = c.id
        WHERE 
          e.created_at > NOW() - INTERVAL '${interval}'
          AND e.event_type IN ('product_view', 'add_to_cart')
        GROUP BY c.id, c.name, e.event_type
      )
      SELECT 
        ce.category_id,
        ce.category_name,
        SUM(CASE WHEN ce.event_type = 'product_view' THEN ce.event_count ELSE 0 END) as view_count,
        SUM(CASE WHEN ce.event_type = 'add_to_cart' THEN ce.event_count ELSE 0 END) as cart_count,
        SUM(ce.event_count) as total_interactions
      FROM category_events ce
      GROUP BY ce.category_id, ce.category_name
      ORDER BY total_interactions DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Kategori popülerliği alınırken hata:', err.message);
    res.status(500).json({ error: 'Veriler alınamadı', details: err.message });
  }
});

module.exports = router;