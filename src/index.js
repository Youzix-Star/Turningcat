// src/index.js

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
        return new Response('OK', { status: 200 });
      }

      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '转发频道消息给我，即可导出为 TXT 或 MD 文件，并可选翻译为简体中文。\n\n/rank 查看使用次数排行\n/help 查看所有命令');
        } else if (text === '/genfile') {
          await incrementUserStat(env, msg.from);
          await handleGenFile(env, chatId, msg.from.id, msg.from.first_name);
        } else if (text === '/rank') {
          await handleRank(env.TELEGRAM_BOT_TOKEN, chatId, env);
        } else if (text.startsWith('/addquote')) {
          await handleAddQuote(msg, env);
        } else if (text === '/help') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '<b>可用命令</b>\n/start - 开始使用\n/genfile - 生成示例文件\n/rank - 查看使用排行\n/help - 显示帮助\n\n转发频道消息即可生成文件。');
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('Error:', error);
      return new Response('Error', { status: 500 });
    }
  },
};

// ==================== 备用语录 ====================
const DEFAULT_QUOTES = [
  "文件已生成。",
  "导出完成。",
  "已处理。",
  "完成。"
];

async function getRandomQuote(env) {
  const kv = env.USER_STATS_KV;
  let quotes = DEFAULT_QUOTES;
  if (kv) {
    const stored = await kv.get('cat_quotes', { type: 'json' });
    if (stored && stored.length > 0) quotes = stored;
  }
  return quotes[Math.floor(Math.random() * quotes.length)];
}

async function handleAddQuote(msg, env) {
  const adminId = env.ADMIN_ID;
  if (!adminId || msg.from.id.toString() !== adminId.toString()) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '无权限。');
    return;
  }
  const newQuote = msg.text.replace('/addquote', '').trim();
  if (!newQuote) return;
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  let quotes = await kv.get('cat_quotes', { type: 'json' }) || DEFAULT_QUOTES;
  quotes.push(newQuote);
  await kv.put('cat_quotes', JSON.stringify(quotes));
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `已添加语录：${newQuote}`);
}

// ==================== 统计 ====================
async function incrementUserStat(env, user) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  try {
    let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
    const userId = user.id.toString();
    const userName = user.first_name || user.username || '未知用户';
    if (!stats[userId]) stats[userId] = { name: userName, count: 0 };
    stats[userId].name = userName;
    stats[userId].count += 1;
    await kv.put('global_leaderboard', JSON.stringify(stats));
  } catch (e) { console.error(e); }
}

async function handleRank(token, chatId, env) {
  const kv = env.USER_STATS_KV;
  let stats = kv ? await kv.get('global_leaderboard', { type: 'json' }) || {} : {};
  const sortedUsers = Object.values(stats).sort((a, b) => b.count - a.count);
  if (sortedUsers.length === 0) {
    await sendTelegramMessage(token, chatId, '暂无使用数据。');
    return;
  }
  let msg = '<b>使用次数排行</b>\n';
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    msg += `${i + 1}. ${sortedUsers[i].name}：${sortedUsers[i].count} 次\n`;
  }
  await sendTelegramMessage(token, chatId, msg);
}

// ==================== 工具函数 ====================
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

async function editMessageText(token, chatId, messageId, text, replyMarkup = null) {
  const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
  if (replyMarkup !== null) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function formatDate(timestamp) {
  const date = new Date((timestamp + 8 * 3600) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear().toString().slice(-2)}.${pad(date.getUTCMonth()+1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

function getBaseName(fullName) {
  const lastDot = fullName.lastIndexOf('.');
  return lastDot !== -1 ? fullName.substring(0, lastDot) : fullName;
}

async function sendDocument(token, chatId, fileName, content, quote, format = 'txt') {
  const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([content], { type: mimeType }), fileName);
  formData.append('caption', `${fileName}\n${quote}`);
  formData.append('parse_mode', 'HTML');
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    await sendTelegramMessage(token, chatId, '文件发送失败，请重试。');
  }
}

async function editMessageRemoveKeyboard(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  });
}

// ==================== 翻译 ====================
async function translateTextViaMyMemory(text, email) {
  const MAX_CHARS = 500;
  let textToTranslate = text;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    textToTranslate = text.substring(0, MAX_CHARS);
    truncated = true;
  }
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|zh-CN&de=${encodeURIComponent(email)}`;
  
  let resp, data;
  try {
    resp = await fetch(url);
    data = await resp.json();
  } catch (e) {
    throw new Error(`网络请求失败: ${e.message}`);
  }
  
  if (data.responseStatus !== 200) {
    throw new Error(`API 返回错误: ${JSON.stringify(data)}`);
  }
  if (!data.responseData || !data.responseData.translatedText) {
    throw new Error(`翻译数据异常: ${JSON.stringify(data)}`);
  }
  
  let translated = data.responseData.translatedText;
  if (truncated) {
    translated += '\n\n[原文超过500字符，已截断翻译]';
  }
  return translated;
}

// ==================== 文件内容生成 ====================
function generateFileContent(format, title, forwardChat, forwardDate, originalText, translatedText = null) {
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
  
  if (format === 'md') {
    let body;
    if (translatedText) {
      const escOrig = originalText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      const escTrans = translatedText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 原文\n\n${escOrig}\n\n## 简体中文\n\n${escTrans}`;
    } else {
      const escOrig = originalText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 原文\n\n${escOrig}`;
    }
    return `# ${title}\n\n来源：${channelLink}\n\n${body}\n\n---\n转发时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n`;
  } else {
    if (translatedText) {
      return `${title}\n${channelLink}\n\n【原文】\n${originalText}\n\n【简体中文】\n${translatedText}\n\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}`;
    } else {
      return `${title}\n${channelLink}\n\n【原文】\n${originalText}\n\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}`;
    }
  }
}

// ==================== 临时存储 ====================
async function storePendingForward(env, key, data) {
  await env.MEDIA_GROUP_CAPTIONS.put(`pending:${key}`, JSON.stringify(data), { expirationTtl: 600 });
}

async function getPendingForward(env, key) {
  return await env.MEDIA_GROUP_CAPTIONS.get(`pending:${key}`, { type: 'json' });
}

async function deletePendingForward(env, key) {
  await env.MEDIA_GROUP_CAPTIONS.delete(`pending:${key}`);
}

// ==================== 媒体组处理 ====================
async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;
  const kv = env.MEDIA_GROUP_CAPTIONS;
  let groupData = await kv.get(mediaGroupId, { type: 'json' }) || {
    files: [],
    caption: '',
    chatId: msg.chat.id,
    forwardFromChat: msg.forward_from_chat ? {
      title: msg.forward_from_chat.title,
      username: msg.forward_from_chat.username
    } : null,
    forwardDate: msg.forward_date,
    timerStarted: false
  };

  if (msg.document) {
    groupData.files.push({
      file_name: msg.document.file_name,
      title: getBaseName(msg.document.file_name),
      file_id: msg.document.file_id
    });
  } else if (msg.photo) {
    groupData.files.push({
      file_name: 'photo.jpg',
      title: '图片',
      file_id: msg.photo[msg.photo.length - 1].file_id
    });
  }
  if (msg.caption) groupData.caption = msg.caption;

  if (!groupData.timerStarted) {
    groupData.timerStarted = true;
    ctx.waitUntil(new Promise(resolve => setTimeout(async () => {
      const finalData = await kv.get(mediaGroupId, { type: 'json' });
      if (finalData) await sendFileSelectionWithFormat(env.TELEGRAM_BOT_TOKEN, finalData.chatId, mediaGroupId, finalData);
      resolve();
    }, 1500)));
  }
  await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });
  return true;
}

async function sendFileSelectionWithFormat(token, chatId, mediaGroupId, groupData) {
  const inlineKeyboard = [];
  groupData.files.forEach((file, i) => {
    inlineKeyboard.push([
      { text: `${file.title}.txt`, callback_data: `select_file:${mediaGroupId}:${i}:txt` },
      { text: `${file.title}.md`, callback_data: `select_file:${mediaGroupId}:${i}:md` }
    ]);
  });
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '选择文件及格式：',
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
}

// ==================== 单文件转发处理 ====================
async function handleForwardedMessage(msg, env, ctx) {
  if (msg.media_group_id && await handleMediaGroupMessage(msg, env, ctx)) return;

  if (!msg.forward_from_chat) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '仅支持从频道转发的消息。');
    return;
  }
  const originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '消息无文字内容。');
    return;
  }

  let titleBase = msg.document ? getBaseName(msg.document.file_name) : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));

  const pendingId = `${msg.chat.id}_${Date.now()}`;
  const pendingData = {
    chatId: msg.chat.id,
    title: safeTitle,
    forwardChat: msg.forward_from_chat,
    forwardDate: msg.forward_date,
    originalText: originalText,
    fromUser: msg.from
  };
  await storePendingForward(env, pendingId, pendingData);

  const inlineKeyboard = [
    [
      { text: '导出 TXT', callback_data: `pending_format:${pendingId}:txt` },
      { text: '导出 MD', callback_data: `pending_format:${pendingId}:md` }
    ]
  ];
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text: '选择导出格式：',
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
}

// ==================== 回调查询处理 ====================
async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const fromUser = callbackQuery.from;

  // 翻译选择
  if (data.startsWith('translate_choice:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const choice = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;
    let translatedText = null;
    let fileName = `${title}-Log.${format === 'md' ? 'md' : 'txt'}`;

    if (choice === 'yes') {
      try {
        // 关键：trim() 去除变量前后空格
        const email = (env.TRANSLATION_EMAIL || 'anonymous@bot.mymemory').trim();
        
        // ===== 调试：发送邮箱信息 =====
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
          `[DEBUG] 读取到的邮箱变量值：\n<code>${escapeHtml(email)}</code>\n长度：${email.length}`);
        
        translatedText = await translateTextViaMyMemory(originalText, email);
        fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;
      } catch (e) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, `翻译失败：${e.message}`);
        return;
      }
    }

    const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, translatedText);
    const quote = await getRandomQuote(env);
    await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
    await incrementUserStat(env, fromUser);
    await deletePendingForward(env, pendingId);
    await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
    return;
  }

  // 媒体组文件选择 → 询问翻译
  if (data.startsWith('select_file:')) {
    const parts = data.split(':');
    const mediaGroupId = parts[1];
    const fileIndex = parseInt(parts[2]);
    const format = parts[3];

    const kv = env.MEDIA_GROUP_CAPTIONS;
    const groupData = await kv.get(mediaGroupId, { type: 'json' });
    if (!groupData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '数据已过期，请重新转发。');
      return;
    }

    const file = groupData.files[fileIndex];
    const safeTitle = sanitizeFilename(file.title);
    const originalText = groupData.caption || '';
    const pendingId = `${chatId}_${Date.now()}`;
    const pendingData = {
      chatId: chatId,
      title: safeTitle,
      forwardChat: groupData.forwardFromChat,
      forwardDate: groupData.forwardDate,
      originalText: originalText,
      fromUser: fromUser,
      format: format
    };
    await storePendingForward(env, pendingId, pendingData);
    await kv.delete(mediaGroupId);

    const inlineKeyboard = [
      [
        { text: '翻译为简体中文', callback_data: `translate_choice:${pendingId}:yes` },
        { text: '保留原文', callback_data: `translate_choice:${pendingId}:no` }
      ]
    ];
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      `已选择 ${safeTitle}.${format}，是否翻译为简体中文？`,
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }

  // 单文件格式选择 → 询问翻译
  if (data.startsWith('pending_format:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const format = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    pendingData.format = format;
    await storePendingForward(env, pendingId, pendingData);

    const inlineKeyboard = [
      [
        { text: '翻译为简体中文', callback_data: `translate_choice:${pendingId}:yes` },
        { text: '保留原文', callback_data: `translate_choice:${pendingId}:no` }
      ]
    ];
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      `已选择 ${format.toUpperCase()} 格式，是否翻译为简体中文？`,
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }
}

// ==================== 示例文件生成 ====================
async function handleGenFile(env, chatId, userId, userName) {
  const content = `示例文件\n用户：${userName}\nID：${userId}`;
  const quote = await getRandomQuote(env);
  await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, `sample_${Date.now()}.txt`, content, quote);
}
