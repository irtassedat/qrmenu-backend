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

module.exports = router 