// src/index.js
export default {
  async fetch(request, env, ctx) {
    // 只处理 POST 请求（Telegram 发送更新时使用 POST）
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      // 解析 Telegram 发送的 JSON 更新
      const update = await request.json();

      // 检查是否有消息
      if (update.message) {
        const chatId = update.message.chat.id;          // 发送者的聊天 ID
        const text = update.message.text;                // 消息文本
        const userId = update.message.from.id;            // 用户 ID
        const userName = update.message.from.first_name || '用户'; // 用户名

        // 处理不同的命令
        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, 
            '你好！我是你的机器人。\n发送 /genfile 试试看，我会生成一个文件给你。');
        } 
        else if (text === '/genfile') {
          // 调用生成文件的函数
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, userId, userName);
        } 
        else {
          // 普通消息回复
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `你说了：${text}`);
        }
      }

      // 告诉 Telegram 已成功接收（避免重复推送）
      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('处理出错：', error);
      return new Response('Error', { status: 500 });
    }
  },
};

/**
 * 发送普通文本消息到 Telegram
 */
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('发送消息失败：', errorText);
  }
}

/**
 * 生成 TXT 文件并通过 Telegram 发送给用户
 */
async function handleGenFile(token, chatId, userId, userName) {
  // 1. 生成文件内容
  const now = new Date();
  const content = `这是为您生成的文件，${userName}！\n` +
                  `您的用户ID：${userId}\n` +
                  `生成时间：${now.toLocaleString()}\n` +
                  `文件内容：你可以在这里放入任何想要的文本信息。`;

  // 2. 创建文件名（使用时间戳避免重复）
  const fileName = `file_${Date.now()}.txt`;

  // 3. 构建 FormData，直接附加文件内容
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);

  // 将内容转为 Blob，指定 MIME 类型为 text/plain
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('document', blob, fileName);

  // 可选：添加文件说明
  formData.append('caption', `这是为您生成的 ${fileName}`);

  // 4. 发送请求
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('发送文件失败：', errorText);
    // 如果文件发送失败，可以尝试用文本消息告知用户
    await sendTelegramMessage(token, chatId, '文件发送失败，请稍后重试。');
  }
}
