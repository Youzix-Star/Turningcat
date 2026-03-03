export default {
  async fetch(request, env, ctx) {
    // 只处理 POST 请求（Telegram 发来的更新）
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;

        let replyText = '';
        if (text === '/start') {
          replyText = '你好！我是从安卓手机部署的机器人 🤖';
        } else {
          replyText = `你说了：${text}`;
        }

        // 发送回复
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, replyText);
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      return new Response('Error', { status: 500 });
    }
  },
};

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
