const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateCustomer } = require('./customer-auth');
const { authorize } = require('./auth');

// Müşteri endpointleri
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

// Admin endpointleri
router.get('/stats', authorize(['super_admin']), async (req, res) => {
    try {
        const stats = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM loyalty_accounts WHERE is_active = true) as total_accounts,
                (SELECT COUNT(DISTINCT customer_profile_id) 
                 FROM loyalty_accounts 
                 WHERE is_active = true 
                 AND EXISTS (
                    SELECT 1 FROM point_transactions 
                    WHERE loyalty_account_id = loyalty_accounts.id 
                    AND created_at > NOW() - INTERVAL '30 days'
                 )) as active_accounts,
                (SELECT SUM(current_points) FROM loyalty_accounts) as total_points,
                (SELECT COUNT(*) FROM loyalty_campaigns 
                 WHERE is_active = true 
                 AND valid_from <= NOW() 
                 AND valid_until >= NOW()) as active_campaigns,
                (SELECT COUNT(*) FROM point_transactions 
                 WHERE created_at > NOW() - INTERVAL '30 days') as monthly_transactions,
                (SELECT AVG(current_points) FROM loyalty_accounts WHERE current_points > 0) as average_points_per_customer
        `);

        res.json(stats.rows[0]);
    } catch (err) {
        console.error('İstatistikler getirme hatası:', err);
        res.status(500).json({ error: 'İstatistikler getirilemedi' });
    }
});

router.get('/transactions/recent', authorize(['super_admin']), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const transactions = await db.query(`
            SELECT pt.*, 
                   cp.full_name as customer_name,
                   cp.phone_number as customer_phone,
                   b.name as branch_name
            FROM point_transactions pt
            LEFT JOIN loyalty_accounts la ON pt.loyalty_account_id = la.id
            LEFT JOIN customer_profiles cp ON la.customer_profile_id = cp.id
            LEFT JOIN branches b ON pt.branch_id = b.id
            ORDER BY pt.created_at DESC
            LIMIT $1
        `, [limit]);

        res.json(transactions.rows);
    } catch (err) {
        console.error('Son işlemler getirme hatası:', err);
        res.status(500).json({ error: 'Son işlemler getirilemedi' });
    }
});

router.get('/top-customers', authorize(['super_admin']), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const customers = await db.query(`
            SELECT cp.*, 
                   la.current_points,
                   la.lifetime_points,
                   la.tier_level,
                   b.name as brand_name
            FROM customer_profiles cp
            JOIN loyalty_accounts la ON cp.id = la.customer_profile_id
            JOIN brands b ON la.brand_id = b.id
            WHERE la.is_active = true
            ORDER BY la.current_points DESC
            LIMIT $1
        `, [limit]);

        res.json(customers.rows);
    } catch (err) {
        console.error('En iyi müşteriler getirme hatası:', err);
        res.status(500).json({ error: 'En iyi müşteriler getirilemedi' });
    }
});

router.get('/campaigns', authorize(['super_admin']), async (req, res) => {
    try {
        const { active, limit } = req.query;
        let query = `
            SELECT lc.*, b.name as brand_name
            FROM loyalty_campaigns lc
            LEFT JOIN brands b ON lc.brand_id = b.id
            WHERE 1=1
        `;

        const queryParams = [];

        if (active === 'true') {
            query += ` AND lc.is_active = true 
                      AND lc.valid_from <= NOW() 
                      AND lc.valid_until >= NOW()`;
        }

        query += ` ORDER BY lc.created_at DESC`;

        if (limit) {
            query += ` LIMIT $${queryParams.length + 1}`;
            queryParams.push(parseInt(limit));
        }

        const campaigns = await db.query(query, queryParams);
        res.json(campaigns.rows);
    } catch (err) {
        console.error('Kampanyalar getirme hatası:', err);
        res.status(500).json({ error: 'Kampanyalar getirilemedi' });
    }
});

router.post('/campaigns', authorize(['super_admin']), async (req, res) => {
    try {
        const {
            brand_id, name, description, campaign_type, rules,
            valid_from, valid_until, is_active, target_branches, target_tiers
        } = req.body;

        const result = await db.query(`
            INSERT INTO loyalty_campaigns (
                brand_id, name, description, campaign_type, rules,
                valid_from, valid_until, is_active, target_branches, target_tiers,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            brand_id, name, description, campaign_type, rules,
            valid_from, valid_until, is_active,
            target_branches ? `{${target_branches.join(',')}}` : '{}',
            target_tiers ? `{${target_tiers.join(',')}}` : '{}',
            req.user.id
        ]);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Kampanya oluşturma hatası:', err);
        res.status(500).json({ error: 'Kampanya oluşturulamadı' });
    }
});

router.put('/campaigns/:id', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            brand_id, name, description, campaign_type, rules,
            valid_from, valid_until, is_active, target_branches, target_tiers
        } = req.body;

        const result = await db.query(`
            UPDATE loyalty_campaigns 
            SET brand_id = $1, 
                name = $2, 
                description = $3, 
                campaign_type = $4, 
                rules = $5,
                valid_from = $6, 
                valid_until = $7, 
                is_active = $8, 
                target_branches = $9, 
                target_tiers = $10
            WHERE id = $11
            RETURNING *
        `, [
            brand_id, name, description, campaign_type, rules,
            valid_from, valid_until, is_active,
            target_branches ? `{${target_branches.join(',')}}` : '{}',
            target_tiers ? `{${target_tiers.join(',')}}` : '{}',
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Kampanya bulunamadı' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Kampanya güncelleme hatası:', err);
        res.status(500).json({ error: 'Kampanya güncellenemedi' });
    }
});

router.delete('/campaigns/:id', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'DELETE FROM loyalty_campaigns WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Kampanya bulunamadı' });
        }

        res.json({ success: true, message: 'Kampanya silindi' });
    } catch (err) {
        console.error('Kampanya silme hatası:', err);
        res.status(500).json({ error: 'Kampanya silinemedi' });
    }
});

router.get('/customers', authorize(['super_admin']), async (req, res) => {
    try {
        const customers = await db.query(`
            SELECT cp.*, 
                   la.current_points,
                   la.lifetime_points,
                   la.tier_level,
                   la.brand_id,
                   b.name as brand_name
            FROM customer_profiles cp
            LEFT JOIN loyalty_accounts la ON cp.id = la.customer_profile_id
            LEFT JOIN brands b ON la.brand_id = b.id
            ORDER BY cp.created_at DESC
        `);

        res.json(customers.rows);
    } catch (err) {
        console.error('Müşteriler getirme hatası:', err);
        res.status(500).json({ error: 'Müşteriler getirilemedi' });
    }
});

router.get('/customers/:id/details', authorize(['super_admin']), async (req, res) => {
    try {
        const { id } = req.params;

        // Müşteri bilgileri
        const customerResult = await db.query(`
            SELECT cp.*, 
                   la.current_points,
                   la.lifetime_points,
                   la.tier_level,
                   b.name as brand_name
            FROM customer_profiles cp
            LEFT JOIN loyalty_accounts la ON cp.id = la.customer_profile_id
            LEFT JOIN brands b ON la.brand_id = b.id
            WHERE cp.id = $1
        `, [id]);

        if (customerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        // Son işlemler
        const transactionsResult = await db.query(`
            SELECT pt.*, b.name as branch_name
            FROM point_transactions pt
            LEFT JOIN loyalty_accounts la ON pt.loyalty_account_id = la.id
            LEFT JOIN branches b ON pt.branch_id = b.id
            WHERE la.customer_profile_id = $1
            ORDER BY pt.created_at DESC
            LIMIT 10
        `, [id]);

        const customer = customerResult.rows[0];
        customer.transactions = transactionsResult.rows;

        res.json(customer);
    } catch (err) {
        console.error('Müşteri detayları getirme hatası:', err);
        res.status(500).json({ error: 'Müşteri detayları getirilemedi' });
    }
});

router.post('/manual-transaction', authorize(['super_admin']), async (req, res) => {
    try {
        const { customer_id, transaction_type, points, description, brand_id } = req.body;

        // Müşterinin ilgili markadaki sadakat hesabını bul
        const accountResult = await db.query(
            'SELECT * FROM loyalty_accounts WHERE customer_profile_id = $1 AND brand_id = $2',
            [customer_id, brand_id]
        );

        let loyaltyAccountId;
        if (accountResult.rows.length === 0) {
            // Hesap yoksa oluştur
            const newAccount = await db.query(
                `INSERT INTO loyalty_accounts (customer_profile_id, brand_id, current_points)
                 VALUES ($1, $2, 0) RETURNING id`,
                [customer_id, brand_id]
            );
            loyaltyAccountId = newAccount.rows[0].id;
        } else {
            loyaltyAccountId = accountResult.rows[0].id;
        }

        // Puan işlemini yap
        const actualPoints = transaction_type === 'subtract' ? -points : points;

        await db.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, transaction_type, points, balance_after, description, created_by)
             VALUES ($1, $2, $3, 
                    (SELECT current_points + $3 FROM loyalty_accounts WHERE id = $1),
                    $4, $5)`,
            [
                loyaltyAccountId,
                transaction_type === 'add' ? 'manual_add' : 'manual_deduct',
                actualPoints,
                description,
                req.user.id
            ]
        );

        // Hesap bakiyesini güncelle
        await db.query(
            `UPDATE loyalty_accounts 
             SET current_points = current_points + $1,
                 lifetime_points = CASE 
                    WHEN $1 > 0 THEN lifetime_points + $1 
                    ELSE lifetime_points 
                 END
             WHERE id = $2`,
            [actualPoints, loyaltyAccountId]
        );

        res.json({ success: true, message: 'Puan işlemi başarılı' });
    } catch (err) {
        console.error('Manuel işlem hatası:', err);
        res.status(500).json({ error: 'İşlem başarısız' });
    }
});

router.get('/settings', authorize(['super_admin']), async (req, res) => {
    try {
        // Burada normalde settings tablosundan alınır
        // Şimdilik sabit değerler döndürelim
        const settings = {
            points_per_currency: 1,
            currency_multiplier: 1,
            welcome_points: 100,
            birthday_points: 200,
            referral_points: 500,
            min_points_for_redemption: 100,
            points_expiry_months: 12,
            enable_double_points: true,
            double_points_days: [5, 6], // Cuma, Cumartesi
            enable_tiers: true,
            tier_rules: {
                BRONZE: { min_points: 0, benefits: ["Temel avantajlar"] },
                SILVER: { min_points: 1000, benefits: ["Özel indirimler", "Promosyon günlerinde ekstra puan"] },
                GOLD: { min_points: 5000, benefits: ["VIP müşteri hizmeti", "Ücretsiz içecek hakkı"] },
                PLATINUM: { min_points: 10000, benefits: ["Özel etkinliklere davet", "Ücretsiz doğum günü menüsü"] }
            }
        };

        res.json(settings);
    } catch (err) {
        console.error('Ayarlar getirme hatası:', err);
        res.status(500).json({ error: 'Ayarlar getirilemedi' });
    }
});

router.put('/settings', authorize(['super_admin']), async (req, res) => {
    try {
        // Burada normalde settings tablosuna kaydedilir
        // Şimdilik sadece başarılı yanıt dönelim
        res.json({ success: true, message: 'Ayarlar kaydedildi' });
    } catch (err) {
        console.error('Ayarlar kaydetme hatası:', err);
        res.status(500).json({ error: 'Ayarlar kaydedilemedi' });
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

// Müşteri endpointleri (ikinci dosyadan eklenenler)

// Müşterinin sadakat verilerini getir
router.get('/customer/:id/data', authenticateCustomer, async (req, res) => {
    try {
        const customerId = req.params.id;

        // Müşterinin sadakat hesabını getir
        const accountResult = await db.query(`
            SELECT la.*, b.name as brand_name, b.logo_url,
                   ls.setting_value as tier_rules
            FROM loyalty_accounts la
            JOIN brands b ON la.brand_id = b.id
            LEFT JOIN loyalty_settings ls ON b.id = ls.brand_id AND ls.setting_key = 'tier_rules'
            WHERE la.customer_profile_id = $1 AND la.is_active = true
            LIMIT 1
        `, [customerId]);

        if (accountResult.rows.length === 0) {
            return res.json({
                current_points: 0,
                lifetime_points: 0,
                tier_level: 'BRONZE',
                next_tier: 'SILVER',
                next_tier_requirement: 1000,
                recent_transactions: []
            });
        }

        const account = accountResult.rows[0];
        const tierRules = account.tier_rules || {
            tiers: {
                BRONZE: { min_points: 0 },
                SILVER: { min_points: 1000 },
                GOLD: { min_points: 5000 },
                PLATINUM: { min_points: 10000 }
            }
        };

        // Sonraki seviyeyi belirle
        let nextTier = 'PLATINUM';
        let nextTierRequirement = 0;

        if (account.tier_level === 'BRONZE') {
            nextTier = 'SILVER';
            nextTierRequirement = tierRules.tiers.SILVER.min_points;
        } else if (account.tier_level === 'SILVER') {
            nextTier = 'GOLD';
            nextTierRequirement = tierRules.tiers.GOLD.min_points;
        } else if (account.tier_level === 'GOLD') {
            nextTier = 'PLATINUM';
            nextTierRequirement = tierRules.tiers.PLATINUM.min_points;
        }

        // Son işlemleri getir
        const transactionsResult = await db.query(`
            SELECT pt.*, b.name as branch_name
            FROM point_transactions pt
            LEFT JOIN branches b ON pt.branch_id = b.id
            WHERE pt.loyalty_account_id = $1
            ORDER BY pt.created_at DESC
            LIMIT 10
        `, [account.id]);

        res.json({
            id: account.id,
            current_points: account.current_points,
            lifetime_points: account.lifetime_points,
            tier_level: account.tier_level,
            next_tier: nextTier,
            next_tier_requirement: nextTierRequirement,
            brand_name: account.brand_name,
            brand_logo: account.logo_url,
            recent_transactions: transactionsResult.rows
        });
    } catch (err) {
        console.error('Müşteri sadakat verisi hatası:', err);
        res.status(500).json({ error: 'Sadakat bilgileri alınamadı' });
    }
});

// Müşterinin tüm sadakat hesaplarını getir (birden fazla marka için)
router.get('/customer/:id/all-accounts', authenticateCustomer, async (req, res) => {
    try {
        const customerId = req.params.id;

        const accounts = await db.query(`
            SELECT la.*, b.name as brand_name, b.logo_url,
                   (SELECT COUNT(*) FROM point_transactions WHERE loyalty_account_id = la.id) as transaction_count,
                   (SELECT SUM(CASE WHEN transaction_type = 'earn' THEN points ELSE 0 END)
                    FROM point_transactions WHERE loyalty_account_id = la.id) as total_earned,
                   (SELECT SUM(CASE WHEN transaction_type = 'spend' THEN ABS(points) ELSE 0 END)
                    FROM point_transactions WHERE loyalty_account_id = la.id) as total_spent
            FROM loyalty_accounts la
            JOIN brands b ON la.brand_id = b.id
            WHERE la.customer_profile_id = $1 AND la.is_active = true
            ORDER BY la.current_points DESC
        `, [customerId]);

        res.json(accounts.rows);
    } catch (err) {
        console.error('Müşteri hesapları hatası:', err);
        res.status(500).json({ error: 'Hesaplar getirilemedi' });
    }
});

// Müşterinin puan geçmişi (detaylı)
router.get('/customer/:id/transactions', authenticateCustomer, async (req, res) => {
    try {
        const customerId = req.params.id;
        const { limit = 20, offset = 0, brand_id } = req.query;

        let query = `
            SELECT pt.*, b.name as branch_name, br.name as brand_name
            FROM point_transactions pt
            JOIN loyalty_accounts la ON pt.loyalty_account_id = la.id
            LEFT JOIN branches b ON pt.branch_id = b.id
            LEFT JOIN brands br ON la.brand_id = br.id
            WHERE la.customer_profile_id = $1
        `;

        const queryParams = [customerId];

        if (brand_id) {
            query += ` AND la.brand_id = $${queryParams.length + 1}`;
            queryParams.push(brand_id);
        }

        query += ` ORDER BY pt.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const transactionsResult = await db.query(query, queryParams);

        // Toplam kayıt sayısı
        const countQuery = `
            SELECT COUNT(*) 
            FROM point_transactions pt
            JOIN loyalty_accounts la ON pt.loyalty_account_id = la.id
            WHERE la.customer_profile_id = $1
            ${brand_id ? `AND la.brand_id = $2` : ''}
        `;

        const countParams = brand_id ? [customerId, brand_id] : [customerId];
        const countResult = await db.query(countQuery, countParams);

        res.json({
            transactions: transactionsResult.rows,
            total: parseInt(countResult.rows[0].count),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        console.error('Müşteri işlem geçmişi hatası:', err);
        res.status(500).json({ error: 'İşlem geçmişi getirilemedi' });
    }
});

// Sadakat hesabı oluştur veya mevcut olanı getir (sipariş öncesi)
router.post('/customer/account/ensure', authenticateCustomer, async (req, res) => {
    try {
        const { brand_id, branch_id } = req.body;
        const customerId = req.customer.id;

        // Mevcut hesabı kontrol et
        const existingAccount = await db.query(
            'SELECT * FROM loyalty_accounts WHERE customer_profile_id = $1 AND brand_id = $2',
            [customerId, brand_id]
        );

        if (existingAccount.rows.length > 0) {
            res.json(existingAccount.rows[0]);
        } else {
            // Yeni hesap oluştur
            const newAccount = await db.query(
                `INSERT INTO loyalty_accounts 
                 (customer_profile_id, brand_id, preferred_branch_id, current_points, lifetime_points)
                 VALUES ($1, $2, $3, 0, 0)
                 RETURNING *`,
                [customerId, brand_id, branch_id]
            );

            // Hoşgeldin kampanyası kontrolü
            await applyWelcomeCampaign(newAccount.rows[0].id, brand_id);

            res.status(201).json(newAccount.rows[0]);
        }
    } catch (err) {
        console.error('Hesap oluşturma hatası:', err);
        res.status(500).json({ error: 'Hesap oluşturulamadı' });
    }
});

// Yakın zamanda yapılan kampanyaları getir
router.get('/customer/available-campaigns', authenticateCustomer, async (req, res) => {
    try {
        const { brand_id, branch_id } = req.query;

        const campaigns = await db.query(`
            SELECT lc.*
            FROM loyalty_campaigns lc
            WHERE lc.brand_id = $1 
            AND lc.is_active = true
            AND lc.valid_from <= NOW()
            AND lc.valid_until >= NOW()
            AND (lc.target_branches = '{}' OR $2 = ANY(lc.target_branches))
            ORDER BY lc.campaign_type, lc.created_at DESC
        `, [brand_id, branch_id]);

        res.json(campaigns.rows);
    } catch (err) {
        console.error('Kampanya listesi hatası:', err);
        res.status(500).json({ error: 'Kampanyalar getirilemedi' });
    }
});

// Puan kullanımı kontrolü
router.post('/customer/check-points-redemption', authenticateCustomer, async (req, res) => {
    try {
        const { brand_id, points_to_use, order_total } = req.body;
        const customerId = req.customer.id;

        // Müşterinin mevcut puanlarını kontrol et
        const accountResult = await db.query(
            'SELECT current_points FROM loyalty_accounts WHERE customer_profile_id = $1 AND brand_id = $2',
            [customerId, brand_id]
        );

        if (accountResult.rows.length === 0) {
            return res.json({
                can_redeem: false,
                reason: 'Sadakat hesabı bulunamadı'
            });
        }

        const currentPoints = accountResult.rows[0].current_points;

        // Puan kullanım kurallarını al
        const settingsResult = await db.query(
            'SELECT setting_value FROM loyalty_settings WHERE brand_id = $1 AND setting_key = $2',
            [brand_id, 'point_rules']
        );

        const pointRules = settingsResult.rows[0]?.setting_value || {
            min_points_for_redemption: 100,
            points_to_currency_ratio: 0.01 // 1 puan = 0.01 TL
        };

        // Kontrolleri yap
        if (currentPoints < points_to_use) {
            return res.json({
                can_redeem: false,
                reason: 'Yetersiz puan'
            });
        }

        if (points_to_use < pointRules.min_points_for_redemption) {
            return res.json({
                can_redeem: false,
                reason: `Minimum ${pointRules.min_points_for_redemption} puan kullanılabilir`
            });
        }

        const discountAmount = points_to_use * pointRules.points_to_currency_ratio;
        const maxDiscount = order_total * 0.5; // Maksimum %50 indirim

        if (discountAmount > maxDiscount) {
            return res.json({
                can_redeem: false,
                reason: 'Maksimum indirim limitine ulaşıldı',
                max_points: Math.floor(maxDiscount / pointRules.points_to_currency_ratio)
            });
        }

        res.json({
            can_redeem: true,
            discount_amount: discountAmount,
            remaining_points: currentPoints - points_to_use
        });
    } catch (err) {
        console.error('Puan kullanım kontrolü hatası:', err);
        res.status(500).json({ error: 'Puan kontrolü yapılamadı' });
    }
});

// routes/loyalty.js içine eklenecek endpointler

// GET /api/loyalty/customers - Müşteri arama (search parametresiyle)
router.get('/customers', authorize(['super_admin']), async (req, res) => {
    try {
        const { search } = req.query;
        let query = `
            SELECT cp.*, 
                   la.current_points,
                   la.lifetime_points,
                   la.tier_level,
                   la.brand_id,
                   b.name as brand_name
            FROM customer_profiles cp
            LEFT JOIN loyalty_accounts la ON cp.id = la.customer_profile_id
            LEFT JOIN brands b ON la.brand_id = b.id
            WHERE 1=1
        `;

        const queryParams = [];

        if (search) {
            queryParams.push(`%${search}%`);
            query += ` AND (cp.full_name ILIKE $${queryParams.length} OR cp.phone_number ILIKE $${queryParams.length})`;
        }

        query += ` ORDER BY cp.created_at DESC`;

        const result = await db.query(query, queryParams);
        res.json(result.rows);
    } catch (err) {
        console.error('Müşteri arama hatası:', err);
        res.status(500).json({ error: 'Müşteri araması başarısız' });
    }
});

// GET /api/loyalty/customer/:customerId/accounts/:brandId - Belirli bir markadaki müşteri hesabını getir
router.get('/customer/:customerId/accounts/:brandId', authorize(['super_admin']), async (req, res) => {
    try {
        const { customerId, brandId } = req.params;

        const result = await db.query(
            `SELECT la.*, b.name as brand_name
             FROM loyalty_accounts la
             JOIN brands b ON la.brand_id = b.id
             WHERE la.customer_profile_id = $1 AND la.brand_id = $2`,
            [customerId, brandId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Müşteri hesabı bulunamadı' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Müşteri hesabı getirme hatası:', err);
        res.status(500).json({ error: 'Müşteri hesabı getirilemedi' });
    }
});

// POST /api/loyalty/branch-transfer - Şubeler arası puan transferi
router.post('/branch-transfer', authorize(['super_admin']), async (req, res) => {
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        const {
            customer_id,
            brand_id,
            from_branch_id,
            to_branch_id,
            points_amount,
            transfer_reason
        } = req.body;

        // Validasyonlar
        if (!customer_id || !brand_id || !from_branch_id || !to_branch_id || !points_amount) {
            return res.status(400).json({ error: 'Eksik parametreler' });
        }

        if (from_branch_id === to_branch_id) {
            return res.status(400).json({ error: 'Aynı şubeler arasında transfer yapılamaz' });
        }

        // Şubelerin aynı markaya ait olduğunu kontrol et
        const branchCheck = await client.query(
            `SELECT id FROM branches 
             WHERE id IN ($1, $2) AND brand_id = $3`,
            [from_branch_id, to_branch_id, brand_id]
        );

        if (branchCheck.rows.length !== 2) {
            return res.status(400).json({ error: 'Şubeler aynı markaya ait değil' });
        }

        // Müşterinin ilgili markadaki sadakat hesabını kontrol et
        const accountResult = await client.query(
            `SELECT * FROM loyalty_accounts 
             WHERE customer_profile_id = $1 AND brand_id = $2`,
            [customer_id, brand_id]
        );

        if (accountResult.rows.length === 0) {
            return res.status(404).json({ error: 'Müşteri sadakat hesabı bulunamadı' });
        }

        const loyaltyAccount = accountResult.rows[0];

        // Yeterli puan kontrolü
        if (loyaltyAccount.current_points < points_amount) {
            return res.status(400).json({ error: 'Yetersiz puan' });
        }

        // Transfer işlemini kaydet - Kaynak şubeden puan çıkışı
        await client.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, branch_id, transaction_type, points, balance_after, description, created_by, metadata)
             VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6, $7)`,
            [
                loyaltyAccount.id,
                from_branch_id,
                -points_amount,
                loyaltyAccount.current_points - points_amount,
                `Şube transferi: ${transfer_reason || 'Transfer'}`,
                req.user.id,
                JSON.stringify({
                    transfer_type: 'branch_transfer',
                    from_branch_id,
                    to_branch_id,
                    reason: transfer_reason
                })
            ]
        );

        // Transfer işlemini kaydet - Hedef şubeye puan girişi
        await client.query(
            `INSERT INTO point_transactions 
             (loyalty_account_id, branch_id, transaction_type, points, balance_after, description, created_by, metadata)
             VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6, $7)`,
            [
                loyaltyAccount.id,
                to_branch_id,
                points_amount,
                loyaltyAccount.current_points - points_amount,
                `Şube transferi: ${transfer_reason || 'Transfer'}`,
                req.user.id,
                JSON.stringify({
                    transfer_type: 'branch_transfer',
                    from_branch_id,
                    to_branch_id,
                    reason: transfer_reason
                })
            ]
        );

        // Sadakat hesabını güncelle - Puan miktarı değişmez, sadece preferred_branch güncellenir
        await client.query(
            `UPDATE loyalty_accounts 
             SET preferred_branch_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [to_branch_id, loyaltyAccount.id]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Transfer başarıyla tamamlandı',
            data: {
                customer_id,
                from_branch_id,
                to_branch_id,
                points_amount,
                new_preferred_branch: to_branch_id
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Şube transferi hatası:', err);
        res.status(500).json({ error: 'Transfer yapılamadı' });
    } finally {
        client.release();
    }
});

// GET /api/loyalty/transfer-history - Transfer geçmişini görüntüle
router.get('/transfer-history', authorize(['super_admin']), async (req, res) => {
    try {
        const { brand_id, branch_id, customer_id, limit = 50 } = req.query;

        let query = `
            SELECT pt.*, 
                   cp.full_name as customer_name, 
                   cp.phone_number as customer_phone,
                   b.name as branch_name,
                   br.name as brand_name,
                   u.username as created_by_username
            FROM point_transactions pt
            JOIN loyalty_accounts la ON pt.loyalty_account_id = la.id
            JOIN customer_profiles cp ON la.customer_profile_id = cp.id
            LEFT JOIN branches b ON pt.branch_id = b.id
            LEFT JOIN brands br ON la.brand_id = br.id
            LEFT JOIN users u ON pt.created_by = u.id
            WHERE pt.transaction_type IN ('transfer_in', 'transfer_out')
        `;

        const queryParams = [];

        if (brand_id) {
            queryParams.push(brand_id);
            query += ` AND la.brand_id = $${queryParams.length}`;
        }

        if (branch_id) {
            queryParams.push(branch_id);
            query += ` AND pt.branch_id = $${queryParams.length}`;
        }

        if (customer_id) {
            queryParams.push(customer_id);
            query += ` AND la.customer_profile_id = $${queryParams.length}`;
        }

        query += ` ORDER BY pt.created_at DESC LIMIT $${queryParams.length + 1}`;
        queryParams.push(limit);

        const result = await db.query(query, queryParams);

        res.json(result.rows);
    } catch (err) {
        console.error('Transfer geçmişi hatası:', err);
        res.status(500).json({ error: 'Transfer geçmişi getirilemedi' });
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