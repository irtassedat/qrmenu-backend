const express = require('express');
const router = express.Router();
const pool = require('../db');

// WebSocket için event emitter
const EventEmitter = require('events');
const waiterCallEvents = new EventEmitter();

// Yeni garson çağrısı geldiğinde event emit et
router.post('/new-call', async (req, res) => {
  const { branchId, tableNumber, cartItems, totalPrice } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO waiter_calls 
       (branch_id, table_number, cart_items, total_price) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [branchId, tableNumber, JSON.stringify(cartItems), totalPrice]
    );
    
    const waiterCall = result.rows[0];
    
    // Event emit et - gerçek zamanlı bildirim için
    waiterCallEvents.emit('newCall', {
      branchId,
      call: waiterCall
    });
    
    res.json({ success: true, waiterCall });
  } catch (err) {
    console.error('Garson çağrısı hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// Aktif garson çağrılarını getir
router.get('/active-calls/:branchId', async (req, res) => {
  const { branchId } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT wc.*, 
              to_char(wc.called_at, 'HH24:MI') as call_time,
              EXTRACT(EPOCH FROM (NOW() - wc.called_at))/60 as waiting_minutes
       FROM waiter_calls wc
       WHERE wc.branch_id = $1 
       AND wc.status = 'pending'
       ORDER BY wc.called_at ASC`,
      [branchId]
    );
    
    res.json({ 
      success: true, 
      calls: result.rows.map(call => ({
        ...call,
        waiting_minutes: Math.floor(call.waiting_minutes),
        priority: call.waiting_minutes > 10 ? 'high' : 'normal'
      }))
    });
    
  } catch (err) {
    console.error('Aktif çağrılar getirme hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// Garson çağrısını tamamla
router.put('/complete-call/:callId', async (req, res) => {
  const { callId } = req.params;
  const { respondedBy } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE waiter_calls 
       SET status = 'completed', 
           responded_at = NOW(),
           responded_by = $2
       WHERE id = $1 
       RETURNING *`,
      [callId, respondedBy]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Çağrı bulunamadı' });
    }
    
    res.json({ 
      success: true, 
      call: result.rows[0],
      message: 'Çağrı tamamlandı'
    });
    
  } catch (err) {
    console.error('Çağrı tamamlama hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// İstatistikler
router.get('/stats/:branchId', async (req, res) => {
  const { branchId } = req.params;
  
  try {
    // Bugünkü istatistikler
    const todayStats = await pool.query(
      `SELECT 
        COUNT(*) as total_calls,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_calls,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_calls,
        AVG(EXTRACT(EPOCH FROM (responded_at - called_at))/60) as avg_response_time
       FROM waiter_calls
       WHERE branch_id = $1
       AND DATE(called_at) = CURRENT_DATE`,
      [branchId]
    );
    
    // En çok çağrı yapan masalar
    const topTables = await pool.query(
      `SELECT 
        table_number,
        COUNT(*) as call_count
       FROM waiter_calls
       WHERE branch_id = $1
       AND DATE(called_at) = CURRENT_DATE
       GROUP BY table_number
       ORDER BY call_count DESC
       LIMIT 5`,
      [branchId]
    );
    
    res.json({
      success: true,
      stats: {
        today: todayStats.rows[0],
        topTables: topTables.rows,
        avgResponseTime: Math.floor(todayStats.rows[0].avg_response_time || 0)
      }
    });
    
  } catch (err) {
    console.error('İstatistik hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// Event listener export et
router.events = waiterCallEvents;

module.exports = router;