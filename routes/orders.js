// routes/orders.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');

// Puan kazanma fonksiyonu
async function earnPointsForOrder(order, transaction) {
    try {
        // Şube bilgilerini al (marka ID'si için)
        const branchResult = await transaction.query(
            'SELECT brand_id FROM branches WHERE id = $1',
            [order.branch_id]
        );

        if (branchResult.rows.length === 0) {
            throw new Error('Şube bulunamadı');
        }

        const brandId = branchResult.rows[0].brand_id;

        // Müşteri giriş yapmışsa puan kazandır
        if (order.customer_profile_id) {
            // Sadakat hesabını bul veya oluştur
            let loyaltyAccount = await transaction.query(
                `SELECT * FROM loyalty_accounts 
                 WHERE customer_profile_id = $1 AND brand_id = $2`,
                [order.customer_profile_id, brandId]
            );

            if (loyaltyAccount.rows.length === 0) {
                // Yeni hesap oluştur
                const newAccount = await transaction.query(
                    `INSERT INTO loyalty_accounts 
                     (customer_profile_id, brand_id, current_points, lifetime_points, preferred_branch_id)
                     VALUES ($1, $2, 0, 0, $3)
                     RETURNING *`,
                    [order.customer_profile_id, brandId, order.branch_id]
                );
                loyaltyAccount = newAccount;

                // Hoşgeldin kampanyası kontrolü
                await applyWelcomeCampaign(newAccount.rows[0].id, brandId, transaction);
            }

            const loyaltyAccountId = loyaltyAccount.rows[0].id;

            // Marka için puan ayarlarını al
            const settingsResult = await transaction.query(
                `SELECT setting_value FROM loyalty_settings 
                 WHERE brand_id = $1 AND setting_key = 'point_rules'`,
                [brandId]
            );

            const pointRules = settingsResult.rows[0]?.setting_value || {
                points_per_currency: 1,
                enable_double_points: false,
                double_points_days: []
            };

            // Puan hesapla
            let basePoints = Math.floor(order.total_price * pointRules.points_per_currency);

            // Çift puan kontrolü
            const orderDay = new Date().getDay();
            if (pointRules.enable_double_points && 
                pointRules.double_points_days.includes(orderDay)) {
                basePoints *= 2;
            }

            // Aktif kampanyaları kontrol et
            const campaigns = await getActiveCampaigns(brandId, order.branch_id, transaction);
            let totalPoints = basePoints;
            let campaignBonuses = [];

            // Kampanya bonuslarını hesapla
            for (const campaign of campaigns) {
                const bonus = await calculateCampaignBonus(campaign, order, basePoints, transaction);
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
            await transaction.query(
                `INSERT INTO point_transactions 
                 (loyalty_account_id, branch_id, order_id, transaction_type, points, balance_after, description, metadata)
                 VALUES ($1, $2, $3, 'earn', $4, $5, $6, $7)`,
                [
                    loyaltyAccountId,
                    order.branch_id,
                    order.id,
                    totalPoints,
                    loyaltyAccount.rows[0].current_points + totalPoints,
                    `Sipariş puanı${campaignBonuses.length > 0 ? ' (kampanya bonusu dahil)' : ''}`,
                    JSON.stringify({ base_points: basePoints, campaign_bonuses: campaignBonuses })
                ]
            );

            // Sadakat hesabını güncelle
            await transaction.query(
                `UPDATE loyalty_accounts 
                 SET current_points = current_points + $1,
                     lifetime_points = lifetime_points + $1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [totalPoints, loyaltyAccountId]
            );

            // Tier seviyesi kontrolü ve güncellemesi
            await updateTierLevel(loyaltyAccountId, transaction);

            return {
                points_earned: totalPoints,
                base_points: basePoints,
                campaign_bonuses: campaignBonuses,
                new_balance: loyaltyAccount.rows[0].current_points + totalPoints
            };
        }

        return null;
    } catch (err) {
        console.error('Puan kazanma hatası:', err);
        return null;
    }
}

// Hoşgeldin kampanyası uygulama
async function applyWelcomeCampaign(loyaltyAccountId, brandId, transaction) {
    const welcomeCampaign = await transaction.query(
        `SELECT * FROM loyalty_campaigns 
         WHERE brand_id = $1 AND campaign_type = 'welcome' AND is_active = true 
         AND valid_from <= NOW() AND valid_until >= NOW()`,
        [brandId]
    );

    if (welcomeCampaign.rows.length > 0) {
        const campaign = welcomeCampaign.rows[0];
        const welcomePoints = campaign.rules.points || campaign.rules.welcome_points || 100;

        await transaction.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, transaction_type, points, balance_after, description, metadata)
             VALUES ($1, 'bonus', $2, $2, 'Hoşgeldin bonusu', $3)`,
            [loyaltyAccountId, welcomePoints, JSON.stringify({ campaign_id: campaign.id })]
        );

        await transaction.query(
            `UPDATE loyalty_accounts 
             SET current_points = current_points + $1,
                 lifetime_points = lifetime_points + $1
             WHERE id = $2`,
            [welcomePoints, loyaltyAccountId]
        );
    }
}

// Aktif kampanyaları getir
async function getActiveCampaigns(brandId, branchId, transaction) {
    const campaigns = await transaction.query(
        `SELECT * FROM loyalty_campaigns 
         WHERE brand_id = $1 AND is_active = true 
         AND valid_from <= NOW() AND valid_until >= NOW()
         AND (target_branches = '{}' OR $2 = ANY(target_branches))`,
        [brandId, branchId]
    );
    return campaigns.rows;
}

// Kampanya bonusu hesapla
async function calculateCampaignBonus(campaign, order, basePoints, transaction) {
    switch (campaign.campaign_type) {
        case 'double_points':
            return basePoints * (campaign.rules.multiplier - 1);
        
        case 'category_bonus':
            // Siparişteki kategorileri kontrol et
            let categoryBonus = 0;
            for (const item of order.items) {
                const productResult = await transaction.query(
                    'SELECT category_id FROM products WHERE id = $1',
                    [item.product_id]
                );
                
                if (productResult.rows[0]?.category_id === campaign.rules.target_category_id) {
                    categoryBonus += Math.floor(item.price * item.quantity * campaign.rules.bonus_rate);
                }
            }
            return categoryBonus;
        
        case 'spending_goal':
            // Harcama hedefi kontrolü
            if (order.total_price >= campaign.rules.min_amount) {
                return campaign.rules.bonus_points;
            }
            return 0;
        
        default:
            return 0;
    }
}

// Tier seviyesi güncelleme
async function updateTierLevel(loyaltyAccountId, transaction) {
    const account = await transaction.query(
        `SELECT la.*, ls.setting_value as tier_rules
         FROM loyalty_accounts la
         JOIN loyalty_settings ls ON la.brand_id = ls.brand_id AND ls.setting_key = 'tier_rules'
         WHERE la.id = $1`,
        [loyaltyAccountId]
    );

    if (account.rows.length > 0) {
        const data = account.rows[0];
        const tierRules = data.tier_rules;
        
        let newTier = 'BRONZE';
        if (data.lifetime_points >= tierRules.tiers.PLATINUM.min_points) {
            newTier = 'PLATINUM';
        } else if (data.lifetime_points >= tierRules.tiers.GOLD.min_points) {
            newTier = 'GOLD';
        } else if (data.lifetime_points >= tierRules.tiers.SILVER.min_points) {
            newTier = 'SILVER';
        }

        if (newTier !== data.tier_level) {
            await transaction.query(
                `UPDATE loyalty_accounts 
                 SET tier_level = $1, tier_expiry_date = CURRENT_TIMESTAMP + INTERVAL '1 year'
                 WHERE id = $2`,
                [newTier, loyaltyAccountId]
            );
        }
    }
}

// POST /api/orders - Sipariş oluşturma (puan harcama ve kazanma)
router.post('/', async (req, res) => {
    const client = await db.getClient();
    
    try {
        await client.query('BEGIN');
        
        const { 
            items, 
            name, 
            table_number, 
            branch_id,
            customer_profile_id,
            used_points,
            discount_amount,
            phone
        } = req.body;

        // Eğer customer_profile_id varsa, müşterinin bilgilerini çekelim
        let customerName = name;
        let customerPhone = phone;
        
        if (customer_profile_id) {
            const customerResult = await client.query(
                'SELECT full_name, phone_number FROM customer_profiles WHERE id = $1',
                [customer_profile_id]
            );
            
            if (customerResult.rows.length > 0) {
                customerName = customerResult.rows[0].full_name || customerName;
                customerPhone = customerResult.rows[0].phone_number || customerPhone;
            }
        }

        // Toplam tutarı hesapla (indirim uygulanmış)
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const total_price = subtotal - (discount_amount || 0);

        // Siparişi oluştur
        const result = await client.query(
            `INSERT INTO orders 
             (items, name, table_number, branch_id, total_price, customer_profile_id, 
              used_points, discount_amount, phone) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             RETURNING *`,
            [
                JSON.stringify(items),
                customerName || "Anonim",
                table_number,
                branch_id || 1,
                total_price,
                customer_profile_id,
                used_points || 0,
                discount_amount || 0,
                customerPhone
            ]
        );

        const order = result.rows[0];

        // Sipariş detaylarını kaydet
        for (const item of items) {
            await client.query(
                `INSERT INTO order_items 
                 (order_id, product_id, quantity, price) 
                 VALUES ($1, $2, $3, $4)`,
                [order.id, item.id, item.quantity, item.price]
            );
        }

        // Puan harcama işlemi
        if (used_points > 0 && customer_profile_id) {
            // Şube bilgilerini al (marka ID'si için)
            const branchResult = await client.query(
                'SELECT brand_id FROM branches WHERE id = $1',
                [branch_id]
            );

            if (branchResult.rows.length > 0) {
                const brandId = branchResult.rows[0].brand_id;

                // Müşterinin sadakat hesabını bul
                const loyaltyAccount = await client.query(
                    `SELECT * FROM loyalty_accounts 
                     WHERE customer_profile_id = $1 AND brand_id = $2`,
                    [customer_profile_id, brandId]
                );

                if (loyaltyAccount.rows.length > 0) {
                    const accountId = loyaltyAccount.rows[0].id;
                    const currentPoints = loyaltyAccount.rows[0].current_points;

                    // Yeterli puan kontrolü
                    if (currentPoints >= used_points) {
                        // Puan harcama işlemini kaydet
                        await client.query(
                            `INSERT INTO point_transactions 
                             (loyalty_account_id, branch_id, order_id, transaction_type, points, 
                              balance_after, description)
                             VALUES ($1, $2, $3, 'spend', $4, $5, $6)`,
                            [
                                accountId,
                                branch_id,
                                order.id,
                                -used_points,
                                currentPoints - used_points,
                                `Sipariş indirimi (${discount_amount} TL)`
                            ]
                        );

                        // Sadakat hesabını güncelle
                        await client.query(
                            `UPDATE loyalty_accounts 
                             SET current_points = current_points - $1,
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = $2`,
                            [used_points, accountId]
                        );
                    }
                }
            }
        }

        // Puan kazandır (indirimli tutar üzerinden)
        const pointsData = await earnPointsForOrder(order, client);

        // Transaction'ı tamamla
        await client.query('COMMIT');

        // Sipariş ve puan bilgisini döndür
        res.status(201).json({
            success: true,
            order: order,
            points: pointsData
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Sipariş oluşturma hatası:', err);
        res.status(500).json({ 
            error: 'Sipariş oluşturulamadı', 
            details: err.message 
        });
    } finally {
        client.release();
    }
});

// GET /api/orders/:id - Sipariş detaylarını getir
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Sipariş detaylarını al
        const orderResult = await db.query(
            `SELECT o.*, b.name as branch_name, b.brand_id,
                    cp.full_name as customer_name, cp.phone_number as customer_phone
             FROM orders o
             LEFT JOIN branches b ON o.branch_id = b.id
             LEFT JOIN customer_profiles cp ON o.customer_profile_id = cp.id
             WHERE o.id = $1`,
            [id]
        );

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ error: 'Sipariş bulunamadı' });
        }

        const order = orderResult.rows[0];

        // Puan işlemlerini al
        const transactionsResult = await db.query(
            `SELECT pt.*, 
                    CASE WHEN pt.transaction_type = 'earn' THEN 'Kazanılan' 
                         WHEN pt.transaction_type = 'spend' THEN 'Harcanan'
                         ELSE 'Diğer' END as transaction_label
             FROM point_transactions pt
             WHERE pt.order_id = $1
             ORDER BY pt.created_at`,
            [id]
        );

        order.point_transactions = transactionsResult.rows;

        res.json(order);
    } catch (err) {
        console.error('Sipariş detayı hatası:', err);
        res.status(500).json({ error: 'Sipariş detayı alınamadı' });
    }
});

// GET /api/orders - Tüm siparişleri listele
router.get('/', async (req, res) => {
    try {
        const { branch_id, status, limit = 50, offset = 0 } = req.query;
        
        let query = `
            SELECT o.*, b.name as branch_name
            FROM orders o
            LEFT JOIN branches b ON o.branch_id = b.id
            WHERE 1=1
        `;
        
        const queryParams = [];
        
        if (branch_id) {
            queryParams.push(branch_id);
            query += ` AND o.branch_id = $${queryParams.length}`;
        }
        
        if (status) {
            queryParams.push(status);
            query += ` AND o.status = $${queryParams.length}`;
        }
        
        query += ` ORDER BY o.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);
        
        const orders = await db.query(query, queryParams);
        res.json(orders.rows);
    } catch (err) {
        console.error('Siparişler getirme hatası:', err);
        res.status(500).json({ error: 'Siparişler getirilemedi' });
    }
});

// PATCH /api/orders/:id/status - Sipariş durumunu güncelle
router.patch('/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const result = await db.query(
            'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sipariş bulunamadı' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Sipariş durumu güncelleme hatası:', err);
        res.status(500).json({ error: 'Sipariş durumu güncellenemedi' });
    }
});

module.exports = router;