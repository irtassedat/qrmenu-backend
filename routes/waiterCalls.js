const express = require('express');
const router = express.Router();
const pool = require('../db');

// Create waiter calls table if not exists
const createWaiterCallsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waiter_calls (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER REFERENCES branches(id),
        table_number VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        cart_items JSONB,
        total_price DECIMAL(10,2),
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        responded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (error) {
    console.error('Error creating waiter_calls table:', error);
  }
};

// Initialize table
createWaiterCallsTable();

// Create new waiter call
router.post('/', async (req, res) => {
  try {
    const { branch_id, table_number, cart_items, total_price } = req.body;

    const result = await pool.query(
      `INSERT INTO waiter_calls 
       (branch_id, table_number, cart_items, total_price) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [branch_id, table_number, JSON.stringify(cart_items), total_price]
    );

    // Burada gerçek uygulamada:
    // 1. WebSocket ile gerçek zamanlı bildirim gönderilebilir
    // 2. SMS/Push notification gönderilebilir
    // 3. Restoran POS sistemine entegre edilebilir

    console.log(`Garson çağrısı alındı - Masa: ${table_number}, Şube: ${branch_id}`);

    res.json({
      success: true,
      message: 'Garson çağrısı başarıyla alındı',
      waiter_call: result.rows[0]
    });

  } catch (error) {
    console.error('Garson çağrısı hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Garson çağrısı alınamadı' 
    });
  }
});

// Get active waiter calls for a branch
router.get('/branch/:branchId', async (req, res) => {
  try {
    const { branchId } = req.params;

    const result = await pool.query(
      `SELECT * FROM waiter_calls 
       WHERE branch_id = $1 AND status = 'pending' 
       ORDER BY called_at DESC`,
      [branchId]
    );

    res.json({
      success: true,
      waiter_calls: result.rows
    });

  } catch (error) {
    console.error('Garson çağrıları getirme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Garson çağrıları getirilemedi' 
    });
  }
});

// Update waiter call status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      `UPDATE waiter_calls 
       SET status = $1, responded_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [status, id]
    );

    res.json({
      success: true,
      waiter_call: result.rows[0]
    });

  } catch (error) {
    console.error('Garson çağrısı güncelleme hatası:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Garson çağrısı güncellenemedi' 
    });
  }
});

module.exports = router;