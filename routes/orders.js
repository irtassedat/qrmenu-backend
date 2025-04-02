const express = require("express")
const router = express.Router()
const pool = require('../db')

// GET /api/orders → Tüm siparişleri getir
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC")
    res.json(result.rows)
  } catch (err) {
    console.error("Siparişleri çekerken hata:", err)
    res.status(500).json({ error: "Server error" })
  }
})

// POST /api/orders
router.post("/", async (req, res) => {
  try {
    const { name, tableNumber, totalPrice, items } = req.body

    if (!name || !tableNumber || !totalPrice || !items) {
      return res.status(400).json({ success: false, message: "Eksik alanlar var." })
    }

    await pool.query(
      "INSERT INTO orders (name, table_number, total_price, items) VALUES ($1, $2, $3, $4)",
      [name, tableNumber, totalPrice, JSON.stringify(items)]
    )

    res.json({ success: true, message: "Sipariş alındı, teşekkürler!" })
  } catch (err) {
    console.error("Sipariş kaydedilirken hata:", err)
    res.status(500).json({ success: false, message: "Sunucu hatası" })
  }
})

// PUT /api/orders/:id → Siparişi güncelle
router.put('/:id', async (req, res) => {
  const { id } = req.params
  const { name, table_number } = req.body

  // Validate required fields
  if (!name || !table_number) {
    return res.status(400).json({ 
      success: false, 
      message: 'İsim ve masa numarası zorunludur.' 
    })
  }

  try {
    // Check if order exists
    const orderCheck = await pool.query(
      'SELECT id FROM orders WHERE id = $1',
      [id]
    )

    if (orderCheck.rowCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sipariş bulunamadı.' 
      })
    }

    // Update order
    await pool.query(
      'UPDATE orders SET name = $1, table_number = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name, table_number, id]
    )

    res.json({ success: true, message: 'Sipariş güncellendi.' })
  } catch (err) {
    console.error('Güncelleme hatası:', err)
    res.status(500).json({ success: false, message: 'Bir hata oluştu.' })
  }
})

// DELETE /api/orders/:id → Siparişi sil
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  try {
    await pool.query('DELETE FROM orders WHERE id = $1', [id])
    res.json({ success: true, message: 'Sipariş silindi.' })
  } catch (err) {
    console.error('Silme hatası:', err)
    res.status(500).json({ success: false, message: 'Bir hata oluştu.' })
  }
})

module.exports = router 