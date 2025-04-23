const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateCustomer } = require('./customer-auth');

// Müşterinin sadakat hesaplarını getir
router.get('/accounts', authenticateCustomer, async (req, res) => {
    try {
        const customerId = req.customer.id;

        const accounts = await db.query(
            `SELECT la.*, b.name as brand_name, b.logo_url
             FROM loyalty_accounts la
             JOIN brands b ON la.brand_id = b.id
             WHERE la.customer_profile_id = $1 AND la.is_active = true`,
            [customerId]
        );

        res.json(accounts.rows);
    } catch (err) {
        console.error('Sadakat hesapları getirme hatası:', err);
        res.status(500).json({ error: 'Sadakat hesapları getirilemedi' });
    }
});

// Belirli bir marka için sadakat hesabı oluştur veya getir
router.post('/accounts/create-or-get', authenticateCustomer, async (req, res) => {
    try {
        const { brand_id, preferred_branch_id } = req.body;
        const customerId = req.customer.id;

        // Mevcut hesabı kontrol et
        const existingAccount = await db.query(
            'SELECT * FROM loyalty_accounts WHERE customer_profile_id = $1 AND brand_id = $2',
            [customerId, brand_id]
        );

        if (existingAccount.rows.length > 0) {
            // Varsa getir
            res.json(existingAccount.rows[0]);
        } else {
            // Yoksa oluştur
            const newAccount = await db.query(
                `INSERT INTO loyalty_accounts 
                 (customer_profile_id, brand_id, preferred_branch_id)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [customerId, brand_id, preferred_branch_id]
            );

            // Hoşgeldin kampanyası varsa uygula
            await applyWelcomeCampaign(newAccount.rows[0].id, brand_id);

            res.status(201).json(newAccount.rows[0]);
        }
    } catch (err) {
        console.error('Sadakat hesabı oluşturma hatası:', err);
        res.status(500).json({ error: 'Sadakat hesabı oluşturulamadı' });
    }
});

// Puan kazanma (Sipariş sonrası)
router.post('/earn-points', async (req, res) => {
    try {
        const { order_id } = req.body;

        // Siparişi getir
        const orderResult = await db.query(
            `SELECT o.*, b.brand_id 
             FROM orders o
             JOIN branches b ON o.branch_id = b.id
             WHERE o.id = $1`,
            [order_id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Sipariş bulunamadı' });
        }

        const order = orderResult.rows[0];

        // Müşteri profilini kontrol et
        if (!order.customer_profile_id) {
            return res.status(400).json({ error: 'Siparişe müşteri atanmamış' });
        }

        // Sadakat hesabını getir veya oluştur
        let loyaltyAccount = await db.query(
            `SELECT * FROM loyalty_accounts 
             WHERE customer_profile_id = $1 AND brand_id = $2`,
            [order.customer_profile_id, order.brand_id]
        );

        if (loyaltyAccount.rows.length === 0) {
            // Hesap yoksa oluştur
            const newAccount = await db.query(
                `INSERT INTO loyalty_accounts 
                 (customer_profile_id, brand_id, preferred_branch_id)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [order.customer_profile_id, order.brand_id, order.branch_id]
            );
            loyaltyAccount = newAccount;
        }

        // Puan hesapla (örnek: her 1 TL = 1 puan)
        const basePoints = Math.floor(order.total_price);
        
        // Aktif kampanyaları kontrol et
        const campaigns = await getActiveCampaigns(order.brand_id, order.branch_id);
        let totalPoints = basePoints;
        let campaignBonuses = [];

        // Kampanya bonuslarını hesapla
        for (const campaign of campaigns) {
            const bonus = await calculateCampaignBonus(campaign, order, basePoints);
            if (bonus > 0) {
                totalPoints += bonus;
                campaignBonuses.push({
                    campaign_id: campaign.id,
                    campaign_name: campaign.name,
                    bonus_points: bonus
                });
            }
        }

        // Puan işlemini kaydet
        const pointTransaction = await db.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, branch_id, order_id, transaction_type, points, balance_after, description, metadata)
             VALUES ($1, $2, $3, 'earn', $4, $5, $6, $7)
             RETURNING *`,
            [
                loyaltyAccount.rows[0].id,
                order.branch_id,
                order_id,
                totalPoints,
                loyaltyAccount.rows[0].current_points + totalPoints,
                `Sipariş puanı (${campaignBonuses.length > 0 ? 'kampanya bonusu dahil' : 'standart'})`,
                JSON.stringify({ base_points: basePoints, campaign_bonuses: campaignBonuses })
            ]
        );

        // Siparişi güncelle
        await db.query(
            `UPDATE orders 
             SET points_earned = $1, loyalty_account_id = $2
             WHERE id = $3`,
            [totalPoints, loyaltyAccount.rows[0].id, order_id]
        );

        res.json({
            success: true,
            points_earned: totalPoints,
            base_points: basePoints,
            campaign_bonuses: campaignBonuses,
            new_balance: loyaltyAccount.rows[0].current_points + totalPoints
        });
    } catch (err) {
        console.error('Puan kazanma hatası:', err);
        res.status(500).json({ error: 'Puan kazanma işlemi başarısız' });
    }
});

// Yardımcı fonksiyonlar
async function applyWelcomeCampaign(loyaltyAccountId, brandId) {
    // Hoşgeldin kampanyası varsa uygula
    const welcomeCampaign = await db.query(
        `SELECT * FROM loyalty_campaigns 
         WHERE brand_id = $1 AND campaign_type = 'welcome' AND is_active = true 
         AND valid_from <= NOW() AND valid_until >= NOW()`,
        [brandId]
    );

    if (welcomeCampaign.rows.length > 0) {
        const campaign = welcomeCampaign.rows[0];
        const welcomePoints = campaign.rules.welcome_points || 100;

        await db.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, transaction_type, points, balance_after, description, metadata)
             VALUES ($1, 'bonus', $2, $2, 'Hoşgeldin bonusu', $3)`,
            [loyaltyAccountId, welcomePoints, JSON.stringify({ campaign_id: campaign.id })]
        );
    }
}

async function getActiveCampaigns(brandId, branchId) {
    const campaigns = await db.query(
        `SELECT * FROM loyalty_campaigns 
         WHERE brand_id = $1 AND is_active = true 
         AND valid_from <= NOW() AND valid_until >= NOW()
         AND (target_branches = '{}' OR $2 = ANY(target_branches))`,
        [brandId, branchId]
    );
    return campaigns.rows;
}

async function calculateCampaignBonus(campaign, order, basePoints) {
    switch (campaign.campaign_type) {
        case 'double_points':
            return basePoints * (campaign.rules.multiplier - 1);
        case 'category_bonus':
            // Kategori bazlı bonus hesaplama
            let categoryBonus = 0;
            for (const item of order.items) {
                if (item.category_id === campaign.rules.target_category_id) {
                    categoryBonus += Math.floor(item.price * item.quantity * campaign.rules.bonus_rate);
                }
            }
            return categoryBonus;
        // Diğer kampanya tipleri için hesaplamalar...
        default:
            return 0;
    }
}

module.exports = router;