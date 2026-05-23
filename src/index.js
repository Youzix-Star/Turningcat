// src/index.js

import { translateBaidu } from './baidu-translate.js';

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
            '<b>可用命令</b>\n/start - 开始使用\n/genfile - 生成示例文件\n/rank - 查看使用排行\n/auth - 认证 DeepSeek 使用权限\n/help - 显示帮助\n\n转发频道消息即可生成文件。');
        } else if (text.startsWith('/auth')) {
          await handleAuth(msg, env);
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
const DEFAULT_QUOTES = ["文件已生成。", "导出完成。", "已处理。", "完成。"];

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

// ==================== 认证系统 ====================
async function isUserAuthorized(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return false;
  const data = await kv.get('authorized_users', { type: 'json' });
  if (!data || !Array.isArray(data)) return false;
  return data.includes(userId.toString());
}

async function authorizeUser(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  let users = await kv.get('authorized_users', { type: 'json' }) || [];
  const id = userId.toString();
  if (!users.includes(id)) {
    users.push(id);
    await kv.put('authorized_users', JSON.stringify(users));
  }
}

async function handleAuth(msg, env) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '使用方法：<code>/auth &lt;密钥&gt;</code>');
    return;
  }

  const providedKey = parts[1];
  const validKey = env.AUTH_KEY;

  if (!validKey) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '管理员未配置认证密钥，DeepSeek 翻译暂不可用。');
    return;
  }

  if (providedKey === validKey) {
    await authorizeUser(env, userId);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '认证成功！现在可以使用 DeepSeek AI 翻译了。');
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '密钥错误，认证失败。');
  }
}

// ==================== 翻译服务 ====================

// MyMemory 翻译（返回文本和耗时）
async function translateMyMemory(text, sourceLang, email) {
  const startTime = Date.now();
  const MAX_CHARS = 500;
  let textToTranslate = text;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    textToTranslate = text.substring(0, MAX_CHARS);
    truncated = true;
  }
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=${sourceLang}|zh-CN&de=${encodeURIComponent(email)}`;

  const resp = await fetch(url);
  const data = await resp.json();
  const duration = Date.now() - startTime;

  if (data.responseStatus !== 200) {
    throw new Error(`MyMemory 错误: ${data.responseDetails || JSON.stringify(data)}`);
  }
  if (!data.responseData || !data.responseData.translatedText) {
    throw new Error('MyMemory 返回空翻译');
  }
  let translated = data.responseData.translatedText;
  if (truncated) {
    translated += '\n\n[原文超过500字符，已截断翻译]';
  }
  return { text: translated, duration };
}

// DeepSeek AI 翻译（返回文本、耗时和 token 用量）
async function translateDeepSeek(text, apiKey) {
  const startTime = Date.now();
  if (!apiKey) throw new Error('未配置 DeepSeek API Key');

  const MAX_CHARS = 4000;
  let textToTranslate = text;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    textToTranslate = text.substring(0, MAX_CHARS);
    truncated = true;
  }

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的翻译助手。请将用户提供的文本翻译成简体中文。只输出翻译结果，不要任何额外解释或标记。'
        },
        {
          role: 'user',
          content: textToTranslate
        }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })
  });
  const duration = Date.now() - startTime;

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API 请求失败 (${response.status}): ${err}`);
  }

  const data = await response.json();
  const translated = data.choices?.[0]?.message?.content?.trim();

  if (!translated) {
    throw new Error('DeepSeek 返回空翻译');
  }

  const usage = data.usage || {};
  if (truncated) {
    return {
      text: translated + '\n\n[原文过长，已截断翻译]',
      duration,
      usage
    };
  }
  return { text: translated, duration, usage };
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
      if (finalData) await sendFileSelection(env.TELEGRAM_BOT_TOKEN, finalData.chatId, mediaGroupId, finalData);
      resolve();
    }, 1500)));
  }
  await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });
  return true;
}

// 第一步：选择文件（只显示文件名）
async function sendFileSelection(token, chatId, mediaGroupId, groupData) {
  const inlineKeyboard = groupData.files.map((file, i) => [
    { text: file.title, callback_data: `select_file:${mediaGroupId}:${i}` }
  ]);
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '选择要导出的文件：',
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

// ==================== 源语言列表（仅用于 MyMemory） ====================
const LANG_OPTIONS = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
];

// ==================== 回调查询处理 ====================
async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const fromUser = callbackQuery.from;

  // ---------- MyMemory 超长确认 ----------
  if (data.startsWith('confirm_my:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const choice = parts[2]; // 'yes' or 'no'

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    if (choice === 'no') {
      // 返回到翻译服务选择界面
      await askTranslateService(env.TELEGRAM_BOT_TOKEN, chatId, messageId, pendingId);
      return;
    }

    // 确认继续，进入语言选择
    pendingData.service = 'my';
    await storePendingForward(env, pendingId, pendingData);

    const inlineKeyboard = [];
    for (let i = 0; i < LANG_OPTIONS.length; i += 2) {
      const row = [];
      row.push({ text: LANG_OPTIONS[i].name, callback_data: `source_lang:${pendingId}:${LANG_OPTIONS[i].code}` });
      if (i + 1 < LANG_OPTIONS.length) {
        row.push({ text: LANG_OPTIONS[i + 1].name, callback_data: `source_lang:${pendingId}:${LANG_OPTIONS[i + 1].code}` });
      }
      inlineKeyboard.push(row);
    }
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      '请选择原文语言（MyMemory 翻译）：',
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }

  // ---------- 翻译服务选择 ----------
  if (data.startsWith('translate_service:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const service = parts[2]; // 'my', 'ds', 'bd', 'no'

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    if (service === 'no') {
      const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;
      const content = generateFileContent(format, title, forwardChat, forwardDate, originalText);
      const quote = await getRandomQuote(env);
      const fileName = `${title}-Log.${format === 'md' ? 'md' : 'txt'}`;
      await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
      await incrementUserStat(env, fromUser);
      await deletePendingForward(env, pendingId);
      await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
      return;
    }

    if (service === 'my') {
      const originalText = pendingData.originalText;
      // 检查是否超过500字符
      if (originalText.length > 500) {
        const confirmKeyboard = [
          [{ text: '继续翻译（文本将被截断）', callback_data: `confirm_my:${pendingId}:yes` }],
          [{ text: '取消', callback_data: `confirm_my:${pendingId}:no` }]
        ];
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
          `原文超过500字符（${originalText.length} 字符），MyMemory 仅能翻译前500字符。是否继续？`,
          { inline_keyboard: confirmKeyboard });
        return;
      }

      // 未超过，直接进入语言选择
      pendingData.service = 'my';
      await storePendingForward(env, pendingId, pendingData);

      const inlineKeyboard = [];
      for (let i = 0; i < LANG_OPTIONS.length; i += 2) {
        const row = [];
        row.push({ text: LANG_OPTIONS[i].name, callback_data: `source_lang:${pendingId}:${LANG_OPTIONS[i].code}` });
        if (i + 1 < LANG_OPTIONS.length) {
          row.push({ text: LANG_OPTIONS[i + 1].name, callback_data: `source_lang:${pendingId}:${LANG_OPTIONS[i + 1].code}` });
        }
        inlineKeyboard.push(row);
      }
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
        '请选择原文语言（MyMemory 翻译）：',
        { inline_keyboard: inlineKeyboard }
      );
      return;
    }

    if (service === 'ds') {
      const userId = fromUser.id;
      const authorized = await isUserAuthorized(env, userId);
      if (!authorized) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
          '您尚未通过 DeepSeek 翻译认证。\n请发送 /auth &lt;密钥&gt; 进行认证。',
          { parse_mode: 'HTML' }
        );
        return;
      }

      try {
        const apiKey = env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '未配置 DeepSeek API Key。');
          return;
        }

        const result = await translateDeepSeek(pendingData.originalText, apiKey);
        const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;
        const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text);
        const quote = await getRandomQuote(env);
        const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

        // 统一 DEBUG 输出：多行 Token + 译文预览
        let debugMsg = `[DEBUG] 翻译服务：DeepSeek AI (deepseek-v4-flash)\n`;
        debugMsg += `耗时：${result.duration} ms\n`;
        if (result.usage) {
          debugMsg += `Token 使用：\n`;
          debugMsg += `  Prompt：${result.usage.prompt_tokens || '?'}\n`;
          debugMsg += `  Completion：${result.usage.completion_tokens || '?'}\n`;
          debugMsg += `  Total：${result.usage.total_tokens || '?'}\n`;
        }
        const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
        debugMsg += `译文预览：${preview}`;
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

        await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
        await incrementUserStat(env, fromUser);
        await deletePendingForward(env, pendingId);
        await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
      } catch (e) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, `DeepSeek 翻译失败：${e.message}`);
      }
      return;
    }

    if (service === 'bd') {
      try {
        const appId = env.BAIDU_APP_ID;
        const secretKey = env.BAIDU_SECRET_KEY;
        if (!appId || !secretKey) {
          await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '未配置百度翻译 API 密钥。');
          return;
        }

        const result = await translateBaidu(pendingData.originalText, appId, secretKey);
        const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;
        const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text);
        const quote = await getRandomQuote(env);
        const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

        // 统一 DEBUG 输出：语言检测 + 译文预览
        let debugMsg = `[DEBUG] 翻译服务：百度翻译\n`;
        debugMsg += `文本长度：${result.debugInfo.textLength}\n`;
        const respData = result.debugInfo.responseData;
        if (respData && respData.from) {
          debugMsg += `检测语言：${respData.from} → ${respData.to}\n`;
        }
        debugMsg += `耗时：${result.duration} ms\n`;
        const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
        debugMsg += `译文预览：${preview}`;
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

        await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
        await incrementUserStat(env, fromUser);
        await deletePendingForward(env, pendingId);
        await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
      } catch (e) {
        let errorMsg = `百度翻译失败：${e.message}`;
        if (e.debugInfo && e.debugInfo.responseData) {
          const errData = e.debugInfo.responseData;
          errorMsg += `\n错误码：${errData.error_code || '未知'}，描述：${errData.error_msg || '无'}`;
        }
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, errorMsg);
      }
      return;
    }
  }

  // ---------- 选择源语言后翻译（仅 MyMemory） ----------
  if (data.startsWith('source_lang:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const sourceLang = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;

    try {
      const email = (env.TRANSLATION_EMAIL || 'anonymous@bot.mymemory').trim();
      const result = await translateMyMemory(originalText, sourceLang, email);

      const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text);
      const quote = await getRandomQuote(env);
      const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

      // 统一 DEBUG 输出
      let debugMsg = `[DEBUG] 翻译服务：MyMemory\n`;
      debugMsg += `源语言：${escapeHtml(sourceLang)}\n`;
      debugMsg += `耗时：${result.duration} ms\n`;
      const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
      debugMsg += `译文预览：${preview}`;
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

      await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
      await incrementUserStat(env, fromUser);
      await deletePendingForward(env, pendingId);
      await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
    } catch (e) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, `翻译失败：${e.message}`);
    }
    return;
  }

  // ---------- 格式选择后询问“翻译服务” ----------
  if (data.startsWith('select_media_format:')) {
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
    await askTranslateService(env.TELEGRAM_BOT_TOKEN, chatId, messageId, pendingId);
    return;
  }

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
    await askTranslateService(env.TELEGRAM_BOT_TOKEN, chatId, messageId, pendingId);
    return;
  }

  // 媒体组：文件选择（第一步）
  if (data.startsWith('select_file:')) {
    const parts = data.split(':');
    const mediaGroupId = parts[1];
    const fileIndex = parseInt(parts[2]);

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
    };
    await storePendingForward(env, pendingId, pendingData);
    await kv.delete(mediaGroupId);

    const inlineKeyboard = [
      [
        { text: 'TXT', callback_data: `select_media_format:${pendingId}:txt` },
        { text: 'MD', callback_data: `select_media_format:${pendingId}:md` }
      ]
    ];
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      `已选择 ${safeTitle}，选择导出格式：`,
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }
}

// 弹出翻译服务选择键盘
async function askTranslateService(token, chatId, messageId, pendingId) {
  const inlineKeyboard = [
    [
      { text: 'MyMemory 翻译', callback_data: `translate_service:${pendingId}:my` },
    ],
    [
      { text: 'DeepSeek AI 翻译', callback_data: `translate_service:${pendingId}:ds` },
    ],
    [
      { text: '百度翻译', callback_data: `translate_service:${pendingId}:bd` },
    ],
    [
      { text: '保留原文', callback_data: `translate_service:${pendingId}:no` }
    ]
  ];
  await editMessageText(token, chatId, messageId,
    '选择翻译服务：',
    { inline_keyboard: inlineKeyboard }
  );
}

// ==================== 示例文件生成 ====================
async function handleGenFile(env, chatId, userId, userName) {
  const content = `示例文件\n用户：${userName}\nID：${userId}`;
  const quote = await getRandomQuote(env);
  await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, `sample_${Date.now()}.txt`, content, quote);
}
