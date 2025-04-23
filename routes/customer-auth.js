const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET || 'cesme-kahve-customer-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

// Test modu kontrolü
const isTestMode = process.env.NODE_ENV === 'development' || process.env.SMS_TEST_MODE === 'true';

// OTP oluşturma
const generateOTP = () => {
    // Test modunda sabit OTP kullan
    if (isTestMode) {
        return '123456';
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// NETGSM ile SMS gönderme
const sendSMSviaNetGSM = async (phoneNumber, otp) => {
    try {
        const username = process.env.NETGSM_USERNAME;
        const password = process.env.NETGSM_PASSWORD;
        const header = process.env.NETGSM_HEADER || 'CESME KAHVE';
        
        if (!username || !password) {
            console.error('NETGSM kimlik bilgileri eksik!');
            return false;
        }
        
        const message = `Çeşme Kahve doğrulama kodunuz: ${otp}`;
        
        const response = await axios.get('https://api.netgsm.com.tr/sms/send/get', {
            params: {
                usercode: username,
                password: password,
                gsmno: phoneNumber,
                message: message,
                msgheader: header,
                dil: 'TR'
            }
        });
        
        console.log('NETGSM yanıtı:', response.data);
        
        // NETGSM yanıt kontrolü
        return response.data.includes('00') || response.data.includes('01');
    } catch (error) {
        console.error('NETGSM SMS gönderim hatası:', error);
        return false;
    }
};

// Test modunda SMS gönderme
const sendSMSTestMode = async (phoneNumber, otp) => {
    console.log(`[TEST MODE] SMS gönderildi: ${phoneNumber} -> OTP: ${otp}`);
    console.log(`[TEST MODE] Bu OTP'yi kullanın: 123456`);
    return true;
};

// Ana SMS gönderme fonksiyonu
const sendOTP = async (phoneNumber, otp) => {
    if (isTestMode) {
        return await sendSMSTestMode(phoneNumber, otp);
    }
    
    // Gerçek SMS gönderimi
    return await sendSMSviaNetGSM(phoneNumber, otp);
};

// Müşteri auth middleware
const authenticateCustomer = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Yetkilendirme gerekli' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Müşteri bilgilerini getir
        const result = await db.query(
            'SELECT * FROM customer_profiles WHERE id = $1',
            [decoded.customerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Müşteri bulunamadı' });
        }

        req.customer = result.rows[0];
        next();
    } catch (err) {
        res.status(401).json({ error: 'Geçersiz token' });
    }
};

// OTP gönder endpoint'i
router.post('/send-otp', async (req, res) => {
    try {
        const { phone_number, otp_type } = req.body;

        // Telefon numarası formatı kontrolü
        if (!phone_number || !/^[0-9]{10}$/.test(phone_number.replace(/\D/g, ''))) {
            return res.status(400).json({ error: 'Geçersiz telefon numarası' });
        }

        const formattedPhone = phone_number.replace(/\D/g, '');
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dakika geçerli

        // Eski OTP kayıtlarını temizle
        await db.query(
            'DELETE FROM customer_verifications WHERE phone_number = $1 AND verified = false',
            [formattedPhone]
        );

        // Yeni OTP oluştur
        await db.query(
            `INSERT INTO customer_verifications (phone_number, otp_code, otp_type, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [formattedPhone, otp, otp_type, expiresAt]
        );

        // SMS gönder
        const smsSent = await sendOTP(formattedPhone, otp);

        if (!smsSent) {
            return res.status(500).json({ error: 'SMS gönderilemedi' });
        }

        res.json({ 
            success: true, 
            message: 'OTP başarıyla gönderildi',
            phone_number: formattedPhone,
            // Test modunda OTP'yi göster
            ...(isTestMode && { test_otp: otp })
        });
    } catch (err) {
        console.error('OTP gönderimi hatası:', err);
        res.status(500).json({ error: 'OTP gönderilemedi' });
    }
});

// OTP doğrulama endpoint'i
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone_number, otp_code } = req.body;
        const formattedPhone = phone_number.replace(/\D/g, '');

        // OTP kontrolü
        const verificationResult = await db.query(
            `SELECT * FROM customer_verifications 
             WHERE phone_number = $1 AND otp_code = $2 AND expires_at > NOW() AND verified = false
             ORDER BY created_at DESC LIMIT 1`,
            [formattedPhone, otp_code]
        );

        if (verificationResult.rows.length === 0) {
            return res.status(400).json({ error: 'Geçersiz veya süresi dolmuş OTP' });
        }

        // OTP'yi doğrulanmış olarak işaretle
        await db.query(
            'UPDATE customer_verifications SET verified = true WHERE id = $1',
            [verificationResult.rows[0].id]
        );

        // Müşteri profilini kontrol et veya oluştur
        let customerProfile = await db.query(
            'SELECT * FROM customer_profiles WHERE phone_number = $1',
            [formattedPhone]
        );

        if (customerProfile.rows.length === 0) {
            // Yeni müşteri oluştur
            const result = await db.query(
                `INSERT INTO customer_profiles (phone_number, phone_verified, status)
                 VALUES ($1, true, 'active')
                 RETURNING *`,
                [formattedPhone]
            );
            customerProfile = result;

            // Müşteri aktivitesi kaydet
            await db.query(
                `INSERT INTO customer_activities (customer_profile_id, activity_type, activity_data)
                 VALUES ($1, 'register', $2)`,
                [result.rows[0].id, JSON.stringify({ method: 'phone' })]
            );
        } else {
            // Var olan müşteriyi güncelle
            await db.query(
                `UPDATE customer_profiles 
                 SET phone_verified = true, last_login = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [customerProfile.rows[0].id]
            );

            // Müşteri aktivitesi kaydet
            await db.query(
                `INSERT INTO customer_activities (customer_profile_id, activity_type, activity_data)
                 VALUES ($1, 'login', $2)`,
                [customerProfile.rows[0].id, JSON.stringify({ method: 'phone' })]
            );
        }

        // JWT token oluştur
        const token = jwt.sign(
            { 
                customerId: customerProfile.rows[0].id,
                phone: formattedPhone
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            token,
            customer: {
                id: customerProfile.rows[0].id,
                phone_number: customerProfile.rows[0].phone_number,
                full_name: customerProfile.rows[0].full_name,
                email: customerProfile.rows[0].email
            }
        });
    } catch (err) {
        console.error('OTP doğrulama hatası:', err);
        res.status(500).json({ error: 'Doğrulama işlemi başarısız' });
    }
});

// Müşteri profili güncelleme
router.put('/profile', authenticateCustomer, async (req, res) => {
    try {
        const { full_name, email, birth_date, gender } = req.body;
        const customerId = req.customer.id;

        const result = await db.query(
            `UPDATE customer_profiles 
             SET full_name = $1, email = $2, birth_date = $3, gender = $4, updated_at = CURRENT_TIMESTAMP
             WHERE id = $5
             RETURNING *`,
            [full_name, email, birth_date, gender, customerId]
        );

        res.json({
            success: true,
            customer: result.rows[0]
        });
    } catch (err) {
        console.error('Profil güncelleme hatası:', err);
        res.status(500).json({ error: 'Profil güncellenemedi' });
    }
});

module.exports = { router, authenticateCustomer };