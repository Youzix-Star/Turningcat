// src/index.js

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      // 处理回调查询
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
        return new Response('OK', { status: 200 });
      }

      // 处理消息
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text;

        // 优先处理转发消息
        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        // 普通命令
        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '你好！我是你的机器人。\n发送 /genfile 试试看，我会生成一个文件给你。');
        } else if (text === '/genfile') {
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.from.first_name);
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `你说了：${text}`);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('处理出错：', error);
      return new Response('Error', { status: 500 });
    }
  },
};

// ==================== 工具函数 ====================

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text };
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

function formatDate(timestamp) {
  // 北京时间 (UTC+8)
  const beijingTime = new Date((timestamp + 8 * 3600) * 1000);
  const yy = beijingTime.getUTCFullYear().toString().slice(-2);
  const mm = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hh = String(beijingTime.getUTCHours()).padStart(2, '0');
  const min = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const ss = String(beijingTime.getUTCSeconds()).padStart(2, '0');
  return `${yy}.${mm}.${dd} ${hh}:${min}:${ss}`;
}

function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

async function translateText(text, targetLang, env) {
  const apiUrl = env.TRANSLATE_API_URL;
  if (!apiUrl) {
    console.error('翻译代理地址未配置');
    return '[翻译服务未配置]';
  }
  try {
    const url = `${apiUrl}/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data && data.code === 0 && data.text) {
      return data.text;
    } else {
      throw new Error('翻译返回格式错误');
    }
  } catch (e) {
    console.error('翻译失败', e);
    return `[翻译失败] ${text}`;
  }
}

async function sendDocument(token, chatId, fileName, content) {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('document', blob, fileName);
  formData.append('caption', `已生成文件：${fileName}`);
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('发送文件失败：', errorText);
    await sendTelegramMessage(token, chatId, '文件发送失败，请稍后重试。');
  }
}

// ==================== 媒体组处理 ====================

async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;

  const kv = env.MEDIA_GROUP_CAPTIONS;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  // 获取已有组信息
  let groupData = await kv.get(mediaGroupId, { type: 'json' });
  if (!groupData) {
    // 首次创建，保存频道信息和原始发送时间
    groupData = {
      files: [],
      caption: msg.caption || msg.text || '',
      chatId: chatId,
      forwardFromChat: msg.forward_from_chat ? {
        title: msg.forward_from_chat.title,
        username: msg.forward_from_chat.username
      } : null,
      forwardDate: msg.forward_date, // 第一条消息的发送时间
      lastUpdated: Date.now(),
      processed: false
    };
  }

  // 收集文件信息
  if (msg.document) {
    const fullName = msg.document.file_name;
    const lastDot = fullName.lastIndexOf('.');
    const titleBase = lastDot !== -1 ? fullName.substring(0, lastDot) : fullName;
    groupData.files.push({
      file_name: fullName,
      title: titleBase,
      file_id: msg.document.file_id,
      mime_type: msg.document.mime_type
    });
  } else if (msg.photo) {
    // 处理照片（没有文件名，生成一个默认名）
    groupData.files.push({
      file_name: 'photo.jpg',
      title: 'photo',
      file_id: msg.photo[msg.photo.length - 1].file_id,
      mime_type: 'image/jpeg'
    });
  }
  // 可根据需要扩展其他媒体类型

  groupData.lastUpdated = Date.now();
  await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });

  // 延迟3秒后检查是否还有新消息
  ctx.waitUntil(
    new Promise(resolve => {
      setTimeout(async () => {
        try {
          const currentData = await kv.get(mediaGroupId, { type: 'json' });
          if (!currentData) return;
          if (Date.now() - currentData.lastUpdated >= 2000 && !currentData.processed) {
            currentData.processed = true;
            await kv.put(mediaGroupId, JSON.stringify(currentData), { expirationTtl: 300 });
            await sendFileSelection(token, chatId, mediaGroupId, currentData);
          }
        } catch (e) {
          console.error('延迟处理媒体组出错：', e);
        } finally {
          resolve();
        }
      }, 3000);
    })
  );

  return true;
}

async function sendFileSelection(token, chatId, mediaGroupId, groupData) {
  if (groupData.files.length === 0) return;

  const inlineKeyboard = [];
  for (let i = 0; i < groupData.files.length; i++) {
    const file = groupData.files[i];
    const buttonText = file.title || file.file_name || `文件 ${i+1}`;
    inlineKeyboard.push([{
      text: buttonText,
      callback_data: `select_file:${mediaGroupId}:${i}`
    }]);
  }

  const replyMarkup = { inline_keyboard: inlineKeyboard };
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: '检测到多个文件，请选择要生成TXT的文件：',
    reply_markup: replyMarkup
  };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const token = env.TELEGRAM_BOT_TOKEN;

  if (!data.startsWith('select_file:')) return;

  const parts = data.split(':');
  if (parts.length !== 3) return;

  const mediaGroupId = parts[1];
  const fileIndex = parseInt(parts[2], 10);

  const kv = env.MEDIA_GROUP_CAPTIONS;
  const groupData = await kv.get(mediaGroupId, { type: 'json' });
  if (!groupData || !groupData.files[fileIndex]) {
    await sendTelegramMessage(token, chatId, '文件信息已过期，请重新转发。');
    await editMessageRemoveKeyboard(token, chatId, messageId);
    return;
  }

  const file = groupData.files[fileIndex];

  // 构建文件内容
  const now = Math.floor(Date.now() / 1000);
  const forwardDate = groupData.forwardDate || now; // 使用保存的原始发送时间
  const originalText = groupData.caption || '';

  // 生成频道链接
  let channelLink = '无公开链接';
  if (groupData.forwardFromChat && groupData.forwardFromChat.username) {
    channelLink = `https://t.me/${groupData.forwardFromChat.username}`;
  }

  // 翻译部分
  let translationPart = '';
  if (originalText) {
    const isChinese = containsChinese(originalText);
    if (!isChinese && env.TRANSLATE_API_URL) {
      const translated = await translateText(originalText, 'zh', env);
      translationPart = `\n---\n\nGoogle 翻译如下\n\n${translated}\n\n---`;
    }
  }

  const sendTimeFormatted = formatDate(forwardDate);
  const fileEditTimeFormatted = formatDate(now);

  // 组装文件内容
  const safeTitle = sanitizeFilename(file.title || '未命名');
  let fileContent = `${safeTitle}\n`;
  fileContent += `${channelLink}\n\n`;
  fileContent += `---\n\n`;
  fileContent += `更新日志原文如下\n\n`;
  fileContent += `${originalText}\n\n`;

  if (translationPart) {
    fileContent += translationPart;
  } else {
    fileContent += `---\n\n`;
  }

  fileContent += `更新信息\n\n`;
  fileContent += `消息原始发送时间：${sendTimeFormatted}\n`;
  fileContent += `本文件最后编辑时间：${fileEditTimeFormatted}\n`;
  fileContent += `本文件自动生成 @Turningcat_bot 自动生成\n\n`;
  fileContent += `---\n\n`;
  fileContent += `请勿相信任何非管理上传模块 提高防范意识 谢谢`;

  const fileName = `${safeTitle}-Log.txt`;
  await sendDocument(token, chatId, fileName, fileContent);

  // 移除原消息中的键盘
  await editMessageRemoveKeyboard(token, chatId, messageId);

  // 可选：清理 KV
  await kv.delete(mediaGroupId);
}

async function editMessageRemoveKeyboard(token, chatId, messageId) {
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] }
  };
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

// ==================== 单条转发消息处理 ====================

async function handleForwardedMessage(msg, env, ctx) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  // 如果是媒体组，交给媒体组处理器
  if (msg.media_group_id) {
    const handled = await handleMediaGroupMessage(msg, env, ctx);
    if (handled) return;
  }

  // 单条消息处理（原有逻辑）
  const forwardDate = msg.forward_date;
  const forwardFromChat = msg.forward_from_chat;
  let originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(token, chatId, '转发的消息没有文字内容，无法生成文件。');
    return;
  }

  let channelLink = '无公开链接';
  if (forwardFromChat && forwardFromChat.username) {
    channelLink = `https://t.me/${forwardFromChat.username}`;
  } else if (forwardFromChat) {
    channelLink = '私有频道，无公开链接';
  } else {
    await sendTelegramMessage(token, chatId, '只支持处理来自频道的转发消息。');
    return;
  }

  // 翻译
  let translationPart = '';
  if (originalText) {
    const isChinese = containsChinese(originalText);
    if (!isChinese && env.TRANSLATE_API_URL) {
      const translated = await translateText(originalText, 'zh', env);
      translationPart = `\n---\n\nGoogle 翻译如下\n\n${translated}\n\n---`;
    }
  }

  const sendTimeFormatted = formatDate(forwardDate);
  const now = Math.floor(Date.now() / 1000);
  const fileEditTimeFormatted = formatDate(now);

  // 生成标题
  let titleBase = '';
  if (msg.document) {
    const fullName = msg.document.file_name;
    const lastDot = fullName.lastIndexOf('.');
    titleBase = lastDot !== -1 ? fullName.substring(0, lastDot) : fullName;
  } else if (originalText) {
    titleBase = originalText.split('\n')[0].trim();
  } else {
    titleBase = '未命名';
  }
  titleBase = titleBase.substring(0, 50);
  const safeTitle = sanitizeFilename(titleBase);
  const fileName = `${safeTitle}-Log.txt`;

  // 组装内容
  let fileContent = `${safeTitle}\n`;
  fileContent += `${channelLink}\n\n`;
  fileContent += `---\n\n`;
  fileContent += `更新日志原文如下\n\n`;
  fileContent += `${originalText}\n\n`;

  if (translationPart) {
    fileContent += translationPart;
  } else {
    fileContent += `---\n\n`;
  }

  fileContent += `更新信息\n\n`;
  fileContent += `消息原始发送时间：${sendTimeFormatted}\n`;
  fileContent += `本文件最后编辑时间：${fileEditTimeFormatted}\n`;
  fileContent += `本文件自动生成 @Turningcat_bot 自动生成\n\n`;
  fileContent += `---\n\n`;
  fileContent += `请勿相信任何非管理上传模块 提高防范意识 谢谢`;

  await sendDocument(token, chatId, fileName, fileContent);
}

// ==================== /genfile 功能 ====================

async function handleGenFile(token, chatId, userId, userName) {
  const now = Math.floor(Date.now() / 1000);
  const formattedNow = formatDate(now);
  const content = `这是为您生成的文件，${userName}！\n` +
                  `您的用户ID：${userId}\n` +
                  `生成时间：${formattedNow}\n` +
                  `文件内容：你可以在这里放入任何想要的文本信息。`;
  const fileName = `file_${Date.now()}.txt`;
  await sendDocument(token, chatId, fileName, content);
}
