// src/index.js

// 启用 Node.js 的 fs 模块，用于在 Workers 中操作文件
import { writeFileSync } from 'node:fs';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const userId = update.message.from.id;
        const userName = update.message.from.first_name || '用户';

        let replyText = '';
        
        // 处理 /start 命令
        if (text === '/start') {
          replyText = '你好！我是你的机器人。\n发送 /genfile 试试看，我会生成一个文件给你。';
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, replyText);
        }
        // 处理 /genfile 命令 - 生成文件并发送
        else if (text === '/genfile') {
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, userId, userName);
        }
        // 普通消息回复
        else {
          replyText = `你说了：${text}`;
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, replyText);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('处理出错：', error);
      return new Response('Error', { status: 500 });
    }
  },
};

/**
 * 发送普通文本消息
 */
async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * 处理生成文件的请求
 * 创建一个临时 TXT 文件并通过 Telegram 发送
 */
async function handleGenFile(token, chatId, userId, userName) {
  // 1. 生成文件内容
  const now = new Date();
  const content = `这是为您生成的文件，${userName}！\n` +
                  `您的用户ID：${userId}\n` +
                  `生成时间：${now.toLocaleString()}\n` +
                  `文件内容：你可以在这里放入任何想要的文本信息。`;

  // 2. 创建一个唯一的文件名（使用时间戳避免冲突）
  const fileName = `file_${Date.now()}.txt`;
  
  // 3. 在 /tmp 目录下创建临时文件并写入内容 [citation:3]
  // 注意：Workers 的 /tmp 是内存文件系统，每个请求独立，用完即焚
  const filePath = `/tmp/${fileName}`;
  try {
    writeFileSync(filePath, content, 'utf8');
  } catch (fsError) {
    console.error('文件写入失败：', fsError);
    await sendTelegramMessage(token, chatId, '文件生成失败，请稍后重试。');
    return;
  }

  // 4. 准备发送文件
  // 需要构造 multipart/form-data 请求，因为我们要上传文件内容 [citation:2][citation:8]
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  
  // 创建 FormData 对象
  const formData = new FormData();
  formData.append('chat_id', chatId);
  
  // 读取文件内容并作为 Blob 附加 [citation:7]
  // 注意：这里我们重新读取文件（也可以直接用之前的内容构建 Blob，但为了演示文件操作，我们从文件系统读）
  const fileContent = await fs.promises.readFile(filePath, 'utf8');
  const blob = new Blob([fileContent], { type: 'text/plain' });
  formData.append('document', blob, fileName);
  
  // 可选：添加文件说明
  formData.append('caption', `这是为您生成的 ${fileName}`);

  // 5. 发送请求
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  // 6. 清理临时文件（可选，因为 /tmp 在请求结束后会自动清除 [citation:3]）
  // 但显式删除是好习惯
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    // 忽略清理错误
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('发送文件失败：', errorText);
    await sendTelegramMessage(token, chatId, '文件发送失败，请稍后重试。');
  }
}
