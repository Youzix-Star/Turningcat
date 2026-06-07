// src/index.js

import { translateMyMemory, translateDeepSeek, translateBaidu } from './translate.js';

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
          await incrementUserStat(env, msg.from, 'genfile');
          await handleGenFile(env, chatId, msg.from.id, msg.from.first_name);
        } else if (text === '/rank') {
          await handleRank(env.TELEGRAM_BOT_TOKEN, chatId, env);
        } else if (text.startsWith('/addquote')) {
          await handleAddQuote(msg, env);
        } else if (text === '/listquote') {
          await handleListQuote(msg, env);
        } else if (text === '/help') {
          let helpMsg = '<b>可用命令</b>\n/start - 开始使用\n/genfile - 生成示例文件\n/rank - 查看使用排行\n/auth - 认证 DeepSeek 使用权限\n/listquote - 查看所有语录\n/help - 显示帮助\n\n转发频道消息即可生成文件。';
          if (msg.from.id.toString() === env.ADMIN_ID) {
            helpMsg += '\n\n<b>管理员命令</b>\n/listauth - 查看并管理认证/拉黑用户\n/addquote - 添加自定义语录';
          }
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpMsg);
        } else if (text.startsWith('/auth')) {
          await handleAuth(msg, env);
        } else if (text === '/listauth') {
          await handleListAuth(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, env, null);
        } else if (text.startsWith('/banauth')) {
          await handleBanAuth(msg, env);
        } else if (text.startsWith('/kickauth')) {
          await handleKickAuth(msg, env);
        } else if (text.startsWith('/unbanauth')) {
          await handleUnbanAuth(msg, env);
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

async function handleListQuote(msg, env) {
  const kv = env.USER_STATS_KV;
  let quotes = DEFAULT_QUOTES;
  if (kv) {
    const stored = await kv.get('cat_quotes', { type: 'json' });
    if (stored && stored.length > 0) quotes = stored;
  }

  if (quotes.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '暂无语录。');
    return;
  }

  const pageSize = 10;
  const totalPages = Math.ceil(quotes.length / pageSize);
  const page = 1;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pageQuotes = quotes.slice(start, end);

  let text = `<b>语录列表 (${quotes.length} 条)</b>\n`;
  pageQuotes.forEach((q, i) => {
    text += `${start + i + 1}. ${escapeHtml(q)}\n`;
  });

  if (totalPages > 1) {
    text += `\n第 ${page}/${totalPages} 页`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, text);
}

// ==================== 统计 ====================
async function incrementUserStat(env, user, serviceType) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  try {
    let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
    const userId = user.id.toString();
    const userName = user.first_name || user.username || '未知用户';

    if (!stats[userId]) {
      stats[userId] = {
        name: userName,
        total: 0,
        myMemory: 0,
        deepSeek: 0,
        baidu: 0,
        genfile: 0
      };
    } else {
      stats[userId].name = userName;
      if (typeof stats[userId].total !== 'number') stats[userId].total = stats[userId].count || 0;
      if (typeof stats[userId].myMemory !== 'number') stats[userId].myMemory = 0;
      if (typeof stats[userId].deepSeek !== 'number') stats[userId].deepSeek = 0;
      if (typeof stats[userId].baidu !== 'number') stats[userId].baidu = 0;
      if (typeof stats[userId].genfile !== 'number') stats[userId].genfile = 0;
      delete stats[userId].count;
    }

    stats[userId].total += 1;
    if (serviceType === 'myMemory') stats[userId].myMemory += 1;
    else if (serviceType === 'deepSeek') stats[userId].deepSeek += 1;
    else if (serviceType === 'baidu') stats[userId].baidu += 1;
    else if (serviceType === 'genfile') stats[userId].genfile += 1;

    await kv.put('global_leaderboard', JSON.stringify(stats));
  } catch (e) { console.error(e); }
}

async function handleRank(token, chatId, env) {
  const kv = env.USER_STATS_KV;
  let stats = kv ? await kv.get('global_leaderboard', { type: 'json' }) || {} : {};
  const sortedUsers = Object.values(stats).sort((a, b) => b.total - a.total);
  if (sortedUsers.length === 0) {
    await sendTelegramMessage(token, chatId, '暂无使用数据。');
    return;
  }
  let msg = '<b>使用次数排行</b>\n';
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    msg += `${i + 1}. ${sortedUsers[i].name}：${sortedUsers[i].total} 次\n`;
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

// ==================== 认证与黑名单系统 ====================
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

async function removeAuthUser(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  let users = await kv.get('authorized_users', { type: 'json' }) || [];
  const id = userId.toString();
  const index = users.indexOf(id);
  if (index > -1) {
    users.splice(index, 1);
    await kv.put('authorized_users', JSON.stringify(users));
  }
}

async function isUserBanned(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return false;
  const banned = await kv.get('banned_users', { type: 'json' }) || [];
  return banned.includes(userId.toString());
}

async function banUser(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  let banned = await kv.get('banned_users', { type: 'json' }) || [];
  const id = userId.toString();
  if (!banned.includes(id)) {
    banned.push(id);
    await kv.put('banned_users', JSON.stringify(banned));
  }
  await removeAuthUser(env, userId);
}

async function kickAuthUser(env, userId) {
  await removeAuthUser(env, userId);
}

async function unbanUser(env, userId) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  let banned = await kv.get('banned_users', { type: 'json' }) || [];
  const id = userId.toString();
  const index = banned.indexOf(id);
  if (index > -1) {
    banned.splice(index, 1);
    await kv.put('banned_users', JSON.stringify(banned));
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

  if (await isUserBanned(env, userId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '您已被管理员拉黑，无法进行认证。');
    return;
  }

  if (providedKey === validKey) {
    await authorizeUser(env, userId);
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '认证成功！现在可以使用 DeepSeek AI 翻译了。');
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '密钥错误，认证失败。');
  }
}

// ==================== 管理员命令 ====================
async function handleBanAuth(msg, env) {
  if (msg.from.id.toString() !== env.ADMIN_ID) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '无权限。');
    return;
  }
  const parts = msg.text.trim().split(/\s+/);
  if (parts.length < 2) return;
  await banUser(env, parts[1]);
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `已拉黑用户 <code>${parts[1]}</code>。`);
}

async function handleKickAuth(msg, env) {
  if (msg.from.id.toString() !== env.ADMIN_ID) return;
  const parts = msg.text.trim().split(/\s+/);
  if (parts.length < 2) return;
  await kickAuthUser(env, parts[1]);
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `已取消用户 <code>${parts[1]}</code> 的认证。`);
}

async function handleUnbanAuth(msg, env) {
  if (msg.from.id.toString() !== env.ADMIN_ID) return;
  const parts = msg.text.trim().split(/\s+/);
  if (parts.length < 2) return;
  await unbanUser(env, parts[1]);
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `已解封用户 <code>${parts[1]}</code>。`);
}

// ==================== 带按钮的用户列表 ====================
async function buildUserListMessage(env) {
  const kv = env.USER_STATS_KV;
  if (!kv) return { text: 'KV 未配置', keyboard: [] };

  const authUsers = await kv.get('authorized_users', { type: 'json' }) || [];
  const bannedUsers = await kv.get('banned_users', { type: 'json' }) || [];
  const stats = await kv.get('global_leaderboard', { type: 'json' }) || {};

  let msgText = '';
  const inlineKeyboard = [];

  if (authUsers.length > 0) {
    msgText += '<b>[认证用户]</b>\n';
    for (const userId of authUsers) {
      const userStats = stats[userId] || { name: '未知用户', total: 0, myMemory: 0, deepSeek: 0, baidu: 0, genfile: 0 };
      msgText += `  <code>${userId}</code> - ${escapeHtml(userStats.name)}\n`;
      msgText += `  总:${userStats.total || 0}  MyMemory:${userStats.myMemory || 0}  DeepSeek:${userStats.deepSeek || 0}  百度:${userStats.baidu || 0}  文件:${userStats.genfile || 0}\n`;

      inlineKeyboard.push([
        { text: '踢出', callback_data: `admin_action:kick:${userId}` },
        { text: '拉黑', callback_data: `admin_action:ban:${userId}` }
      ]);
    }
    msgText += '\n';
  } else {
    msgText += '<b>[认证用户]</b>\n  暂无\n\n';
  }

  if (bannedUsers.length > 0) {
    msgText += '<b>[被拉黑用户]</b>\n';
    for (const userId of bannedUsers) {
      const userStats = stats[userId] || { name: '未知用户', total: 0 };
      msgText += `  <code>${userId}</code> - ${escapeHtml(userStats.name)} (总次数: ${userStats.total || 0})\n`;

      inlineKeyboard.push([
        { text: '解封', callback_data: `admin_action:unban:${userId}` }
      ]);
    }
  } else {
    msgText += '<b>[被拉黑用户]</b>\n  暂无';
  }

  return { text: msgText, keyboard: inlineKeyboard };
}

async function handleListAuth(token, chatId, fromUserId, env, messageIdToEdit) {
  if (fromUserId.toString() !== env.ADMIN_ID) {
    await sendTelegramMessage(token, chatId, '无权限。');
    return;
  }

  const { text, keyboard } = await buildUserListMessage(env);

  const replyMarkup = keyboard.length > 0 ? { inline_keyboard: keyboard } : null;

  if (messageIdToEdit) {
    await editMessageText(token, chatId, messageIdToEdit, text, replyMarkup);
  } else {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      })
    });
  }
}

// ==================== 文件内容生成 ====================
function generateFileContent(format, title, forwardChat, forwardDate, originalText, translatedText = null, markdownText = null) {
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
  
  // 使用带链接的文本（如果有）
  const displayText = markdownText || originalText;

  if (format === 'md') {
    let body;
    if (translatedText) {
      const escOrig = displayText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      const escTrans = translatedText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 原文\n\n${escOrig}\n\n## 简体中文\n\n${escTrans}`;
    } else {
      const escOrig = displayText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 原文\n\n${escOrig}`;
    }
    return `# ${title}\n\n来源：${channelLink}\n\n${body}\n\n---\n转发时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n`;
  } else {
    // TXT 格式也使用带链接的文本
    if (translatedText) {
      return `${title}\n${channelLink}\n\n【原文】\n${displayText}\n\n【简体中文】\n${translatedText}\n\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}`;
    } else {
      return `${title}\n${channelLink}\n\n【原文】\n${displayText}\n\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}`;
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

// ==================== 媒体组处理（已修复 entities + 提前 DEBUG） ====================
async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;
  const kv = env.MEDIA_GROUP_CAPTIONS;
  let groupData = await kv.get(mediaGroupId, { type: 'json' }) || {
    files: [],
    caption: '',
    caption_entities: [],
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
  if (msg.caption_entities) groupData.caption_entities = msg.caption_entities;

  if (!groupData.timerStarted) {
    groupData.timerStarted = true;
    ctx.waitUntil(new Promise(resolve => setTimeout(async () => {
      const finalData = await kv.get(mediaGroupId, { type: 'json' });
      if (finalData) {
        // 发送链接转换 DEBUG 信息
        const linkResult = convertLinksToMarkdown({ 
          text: finalData.caption || '', 
          caption_entities: finalData.caption_entities || []
        });
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, finalData.chatId, 
          `<pre>${escapeHtml(linkResult.debug)}</pre>`);
        
        // 发送文件选择
        await sendFileSelection(env.TELEGRAM_BOT_TOKEN, finalData.chatId, mediaGroupId, finalData);
      }
      resolve();
    }, 1500)));
  }
  await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });
  return true;
}

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

// ==================== 提取软件名称 ====================
function extractSoftwareName(title) {
  const nameWithoutExt = title.replace(/\.(apk|APK|zip|ZIP|rar|RAR|7z|7Z|ipa|IPA|exe|EXE|msi|MSI|dmg|DMG|deb|DEB|rpm|RPM)$/i, '');
  const match = nameWithoutExt.match(/^([^_-]+)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

// ==================== 将消息中的链接转换为 Markdown 格式 ====================
function convertLinksToMarkdown(msg) {
  const text = msg.text || msg.caption || '';
  const entities = msg.entities || msg.caption_entities || [];
  const debugInfo = [];
  
  debugInfo.push(`[DEBUG] 链接转换`);
  debugInfo.push(`文本长度: ${text.length}`);
  debugInfo.push(`实体数量: ${entities.length}`);
  
  if (!entities || entities.length === 0) {
    debugInfo.push(`无实体，返回原始文本`);
    return { text: text, debug: debugInfo.join('\n') };
  }
  
  // 列出所有实体
  entities.forEach((entity, i) => {
    const entityText = text.substring(entity.offset, entity.offset + entity.length);
    debugInfo.push(`实体 ${i}: type=${entity.type}, offset=${entity.offset}, length=${entity.length}`);
    debugInfo.push(`  内容: "${entityText.substring(0, 30)}${entityText.length > 30 ? '...' : ''}"`);
    if (entity.url) {
      debugInfo.push(`  URL: ${entity.url.substring(0, 50)}${entity.url.length > 50 ? '...' : ''}`);
    }
  });
  
  // 只处理链接类型的实体，按 offset 降序排列（从后往前替换，避免 offset 错位）
  const linkEntities = entities
    .filter(e => e.type === 'text_link' || e.type === 'url')
    .sort((a, b) => b.offset - a.offset);
  
  debugInfo.push(`链接实体数: ${linkEntities.length}`);
  
  let result = text;
  
  linkEntities.forEach((entity, i) => {
    const before = result.substring(0, entity.offset);
    const linkText = result.substring(entity.offset, entity.offset + entity.length);
    const after = result.substring(entity.offset + entity.length);
    
    if (entity.type === 'text_link' && entity.url) {
      // 嵌入式链接：转成 [text](url) 格式
      result = `${before}[${linkText}](${entity.url})${after}`;
      debugInfo.push(`转换 ${i}: [${linkText}](${entity.url.substring(0, 30)}...)`);
    } else if (entity.type === 'url') {
      // 纯文本 URL：保持原样
      debugInfo.push(`跳过 ${i}: 纯URL ${linkText.substring(0, 30)}...`);
    }
  });
  
  debugInfo.push(`转换完成，结果长度: ${result.length}`);
  
  return { text: result, debug: debugInfo.join('\n') };
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

  // 将链接转换为 Markdown 格式
  const linkResult = convertLinksToMarkdown(msg);
  const markdownText = linkResult.text;
  
  // 发送链接转换调试信息
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, 
    `<pre>${escapeHtml(linkResult.debug)}</pre>`);
  
  let titleBase = msg.document ? getBaseName(msg.document.file_name) : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));

  const pendingId = `${msg.chat.id}_${Date.now()}`;
  const pendingData = {
    chatId: msg.chat.id,
    title: safeTitle,
    forwardChat: msg.forward_from_chat,
    forwardDate: msg.forward_date,
    originalText: originalText,
    markdownText: markdownText,
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

// ==================== 源语言列表 ====================
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

// ==================== 获取频道头像 ====================
async function getChannelAvatar(env, chat) {
  const debugInfo = [];
  
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = chat.id;
    const chatUsername = chat.username || '';
    
    debugInfo.push(`频道 ID: ${chatId}`);
    debugInfo.push(`频道 Username: ${chatUsername || '无'}`);
    
    debugInfo.push(`尝试通过 chat_id 获取...`);
    const chatResponse = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`);
    const chatData = await chatResponse.json();
    debugInfo.push(`getChat 响应: ${chatData.ok ? '成功' : '失败'}`);
    
    if (chatData.ok && chatData.result.photo) {
      debugInfo.push(`找到头像，获取文件路径...`);
      const fileId = chatData.result.photo.small_file_id;
      debugInfo.push(`File ID: ${fileId}`);
      
      const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const fileData = await fileResponse.json();
      debugInfo.push(`getFile 响应: ${fileData.ok ? '成功' : '失败'}`);
      
      if (fileData.ok) {
        const avatarUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
        debugInfo.push(`头像 URL: ${avatarUrl.substring(0, 50)}...`);
        return { url: avatarUrl, debug: debugInfo.join('\n') };
      }
    } else {
      debugInfo.push(`chat_id 方式未获取到头像`);
      if (chatData.description) {
        debugInfo.push(`原因: ${chatData.description}`);
      }
    }
    
    if (chatUsername) {
      debugInfo.push(`尝试通过 @${chatUsername} 获取...`);
      const usernameResponse = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=@${chatUsername}`);
      const usernameData = await usernameResponse.json();
      debugInfo.push(`username getChat 响应: ${usernameData.ok ? '成功' : '失败'}`);
      
      if (usernameData.ok && usernameData.result.photo) {
        debugInfo.push(`找到头像，获取文件路径...`);
        const fileId = usernameData.result.photo.small_file_id;
        const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
        const fileData = await fileResponse.json();
        
        if (fileData.ok) {
          const avatarUrl = `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`;
          debugInfo.push(`头像 URL: ${avatarUrl.substring(0, 50)}...`);
          return { url: avatarUrl, debug: debugInfo.join('\n') };
        }
      } else {
        debugInfo.push(`username 方式未获取到头像`);
        if (usernameData.description) {
          debugInfo.push(`原因: ${usernameData.description}`);
        }
      }
    }
    
    debugInfo.push(`❌ 所有方式均未获取到头像`);
    return { url: null, debug: debugInfo.join('\n') };
    
  } catch (error) {
    debugInfo.push(`❌ 异常: ${error.message}`);
    return { url: null, debug: debugInfo.join('\n') };
  }
}

// ==================== 下载并保存头像到 GitHub ====================
async function saveAvatarToGitHub(env, avatarUrl, channelUsername) {
  const debugInfo = [];
  
  try {
    if (!avatarUrl || !env.GITHUB_TOKEN) {
      debugInfo.push(`跳过保存: ${!avatarUrl ? '无头像URL' : '无GITHUB_TOKEN'}`);
      return { path: null, debug: debugInfo.join('\n') };
    }
    
    const owner = env.LOG_REPO_OWNER;
    const repo = env.LOG_REPO_NAME;
    const token = env.GITHUB_TOKEN;
    
    debugInfo.push(`下载头像...`);
    const avatarResponse = await fetch(avatarUrl);
    debugInfo.push(`下载状态: ${avatarResponse.status}`);
    
    if (!avatarResponse.ok) {
      debugInfo.push(`❌ 下载失败`);
      return { path: null, debug: debugInfo.join('\n') };
    }
    
    const avatarBuffer = await avatarResponse.arrayBuffer();
    const avatarBase64 = btoa(String.fromCharCode(...new Uint8Array(avatarBuffer)));
    debugInfo.push(`头像大小: ${avatarBuffer.byteLength} 字节`);
    
    const fileName = channelUsername ? `${channelUsername}.jpg` : `channel_${Date.now()}.jpg`;
    const path = `public/avatars/${fileName}`;
    debugInfo.push(`保存路径: ${path}`);
    
    const checkUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const checkRes = await fetch(checkUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Turningcat-Bot',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    let sha = null;
    if (checkRes.ok) {
      const data = await checkRes.json();
      sha = data.sha;
      debugInfo.push(`文件已存在，将覆盖`);
    } else {
      debugInfo.push(`文件不存在，将创建`);
    }
    
    debugInfo.push(`上传到 GitHub...`);
    const body = {
      message: `🖼️ 更新频道头像: ${channelUsername || 'unknown'}`,
      content: avatarBase64,
      ...(sha && { sha })
    };
    
    const response = await fetch(checkUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Turningcat-Bot',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });
    
    debugInfo.push(`上传状态: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      debugInfo.push(`❌ 上传失败: ${errorText.substring(0, 100)}`);
      return { path: null, debug: debugInfo.join('\n') };
    }
    
    debugInfo.push(`✅ 保存成功!`);
    return { path: `/avatars/${fileName}`, debug: debugInfo.join('\n') };
    
  } catch (error) {
    debugInfo.push(`❌ 异常: ${error.message}`);
    return { path: null, debug: debugInfo.join('\n') };
  }
}

// ==================== GitHub 推送功能 ====================
async function publishToLogSite(env, logData) {
  const debugInfo = [];
  
  try {
    const { title, originalText, translatedText, forwardDate, channelLink, format, forwardChat, markdownText } = logData;
    
    debugInfo.push(`[DEBUG] 开始推送到博客...`);
    debugInfo.push(`GITHUB_TOKEN: ${env.GITHUB_TOKEN ? '已配置' : '❌ 未配置'}`);
    debugInfo.push(`LOG_REPO_OWNER: ${env.LOG_REPO_OWNER || '❌ 未配置'}`);
    debugInfo.push(`LOG_REPO_NAME: ${env.LOG_REPO_NAME || '❌ 未配置'}`);
    
    if (!env.GITHUB_TOKEN || !env.LOG_REPO_OWNER || !env.LOG_REPO_NAME) {
      debugInfo.push(`❌ 环境变量缺失，跳过推送`);
      return { success: false, debug: debugInfo.join('\n'), url: null };
    }
    
    // 获取频道头像
    debugInfo.push(`\n--- 获取频道头像 ---`);
    let avatarPath = null;
    if (forwardChat) {
      const avatarResult = await getChannelAvatar(env, forwardChat);
      debugInfo.push(avatarResult.debug);
      
      if (avatarResult.url) {
        debugInfo.push(`\n--- 保存头像 ---`);
        const saveResult = await saveAvatarToGitHub(env, avatarResult.url, forwardChat.username || `id${forwardChat.id}`);
        debugInfo.push(saveResult.debug);
        avatarPath = saveResult.path;
      }
    } else {
      debugInfo.push(`无频道信息，跳过头像获取`);
    }
    
    // 提取软件名称
    debugInfo.push(`\n--- 提取标签 ---`);
    const softwareName = extractSoftwareName(title);
    debugInfo.push(`标题: ${title}`);
    debugInfo.push(`提取的软件名: ${softwareName || '未识别'}`);
    
    // 生成文件名
    const date = new Date(forwardDate * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const safeTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').substring(0, 50);
    const fileName = `${dateStr}-${safeTitle}.md`;
    debugInfo.push(`\n--- 推送文章 ---`);
    debugInfo.push(`文件名: ${fileName}`);
    
    // 生成文章 URL
    const siteUrl = env.LOG_SITE_URL || 'https://log.youzix.top';
    const slug = fileName.replace('.md', '').toLowerCase();
    const articleUrl = `${siteUrl}/log/${slug}/`;
    debugInfo.push(`文章链接: ${articleUrl}`);
    
    // 频道信息
    const channelName = forwardChat?.title || '未知频道';
    const channelUsername = forwardChat?.username || '';
    
    // 生成标签数组
    const tags = [];
    if (softwareName) {
      tags.push(softwareName);
    }
    
    // 使用带链接的文本
    const displayText = markdownText || originalText;
    
    // 生成 Markdown 内容
    const content = `---
title: "${title.replace(/"/g, '\\"')}"
date: ${date.toISOString()}
source: "${channelLink}"
channelName: "${channelName.replace(/"/g, '\\"')}"
channelUsername: "${channelUsername}"
channelAvatar: "${avatarPath || ''}"
format: ${format || 'txt'}
translated: ${!!translatedText}
tags: [${tags.map(t => `"${t}"`).join(', ')}]
---

## 原文

${displayText}

${translatedText ? `## 简体中文

${translatedText}` : ''}
`;

    debugInfo.push(`标签: ${tags.length > 0 ? tags.join(', ') : '无'}`);
    debugInfo.push(`内容长度: ${content.length} 字符`);
    debugInfo.push(`头像路径: ${avatarPath || '无'}`);
    
    // 通过 GitHub API 创建文件
    const owner = env.LOG_REPO_OWNER;
    const repo = env.LOG_REPO_NAME;
    const path = `src/content/logs/${fileName}`;
    const token = env.GITHUB_TOKEN;
    
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const checkRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Turningcat-Bot',
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    let sha = null;
    if (checkRes.ok) {
      const data = await checkRes.json();
      sha = data.sha;
    }
    
    const body = {
      message: `📝 添加日志: ${title}`,
      content: btoa(unescape(encodeURIComponent(content))),
      ...(sha && { sha })
    };
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Turningcat-Bot',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify(body)
    });
    
    debugInfo.push(`文章推送状态: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      debugInfo.push(`❌ 推送失败: ${errorText.substring(0, 100)}`);
      return { success: false, debug: debugInfo.join('\n'), url: null };
    }
    
    debugInfo.push(`✅ 推送成功!`);
    
    return { success: true, debug: debugInfo.join('\n'), url: articleUrl };
  } catch (error) {
    debugInfo.push(`❌ 异常: ${error.message}`);
    return { success: false, debug: debugInfo.join('\n'), url: null };
  }
}

// ==================== 回调查询处理 ====================
async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const fromUser = callbackQuery.from;

  // ---------- 管理员操作按钮 ----------
  if (data.startsWith('admin_action:')) {
    if (fromUser.id.toString() !== env.ADMIN_ID) {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '无权限', show_alert: false })
      });
      return;
    }

    const parts = data.split(':');
    const action = parts[1];
    const targetId = parts[2];

    if (action === 'kick') await kickAuthUser(env, targetId);
    else if (action === 'ban') await banUser(env, targetId);
    else if (action === 'unban') await unbanUser(env, targetId);

    await handleListAuth(env.TELEGRAM_BOT_TOKEN, chatId, fromUser.id, env, messageId);

    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQuery.id, text: '操作成功' })
    });
    return;
  }

  // ---------- MyMemory 超长确认 ----------
  if (data.startsWith('confirm_my:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const choice = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    if (choice === 'no') {
      await askTranslateService(env.TELEGRAM_BOT_TOKEN, chatId, messageId, pendingId);
      return;
    }

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
    const service = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    if (service === 'no') {
      const { title, forwardChat, forwardDate, originalText, markdownText, fromUser, format } = pendingData;
      const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, null, markdownText);
      const quote = await getRandomQuote(env);
      const fileName = `${title}-Log.${format === 'md' ? 'md' : 'txt'}`;
      await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
      await incrementUserStat(env, fromUser, 'genfile');
      
      const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
      const publishResult = await publishToLogSite(env, {
        title,
        originalText,
        translatedText: null,
        forwardDate,
        channelLink,
        format,
        forwardChat,
        markdownText
      });
      
      let resultMsg = `<pre>${escapeHtml(publishResult.debug)}</pre>`;
      if (publishResult.success && publishResult.url) {
        resultMsg += `\n\n📖 博客链接：${publishResult.url}`;
      }
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, resultMsg);
      
      await deletePendingForward(env, pendingId);
      await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
      return;
    }

    if (service === 'my') {
      const originalText = pendingData.originalText;
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
      if (await isUserBanned(env, userId)) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '您已被管理员拉黑，无法使用 DeepSeek 翻译。');
        return;
      }
      if (!await isUserAuthorized(env, userId)) {
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
        const { title, forwardChat, forwardDate, originalText, markdownText, fromUser, format } = pendingData;
        const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text, markdownText);
        const quote = await getRandomQuote(env);
        const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

        let debugMsg = `[DEBUG] 翻译服务：DeepSeek AI\n`;
        debugMsg += `耗时：${result.duration} ms\n`;
        if (result.usage) {
          debugMsg += `Token：${result.usage.total_tokens || '?'}\n`;
        }
        const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
        debugMsg += `译文预览：${preview}`;
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

        await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
        await incrementUserStat(env, fromUser, 'deepSeek');
        
        const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
        const publishResult = await publishToLogSite(env, {
          title,
          originalText,
          translatedText: result.text,
          forwardDate,
          channelLink,
          format,
          forwardChat,
          markdownText
        });
        
        let resultMsg = `<pre>${escapeHtml(publishResult.debug)}</pre>`;
        if (publishResult.success && publishResult.url) {
          resultMsg += `\n\n📖 博客链接：${publishResult.url}`;
        }
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, resultMsg);
        
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
        const { title, forwardChat, forwardDate, originalText, markdownText, fromUser, format } = pendingData;
        const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text, markdownText);
        const quote = await getRandomQuote(env);
        const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

        let debugMsg = `[DEBUG] 翻译服务：百度翻译\n`;
        debugMsg += `长度：${result.debugInfo.textLength}\n`;
        const respData = result.debugInfo.responseData;
        if (respData && respData.from) {
          debugMsg += `语言：${respData.from} → ${respData.to}\n`;
        }
        debugMsg += `耗时：${result.duration} ms\n`;
        const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
        debugMsg += `译文预览：${preview}`;
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

        await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
        await incrementUserStat(env, fromUser, 'baidu');
        
        const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
        const publishResult = await publishToLogSite(env, {
          title,
          originalText,
          translatedText: result.text,
          forwardDate,
          channelLink,
          format,
          forwardChat,
          markdownText
        });
        
        let resultMsg = `<pre>${escapeHtml(publishResult.debug)}</pre>`;
        if (publishResult.success && publishResult.url) {
          resultMsg += `\n\n📖 博客链接：${publishResult.url}`;
        }
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, resultMsg);
        
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

  // ---------- MyMemory 翻译 ----------
  if (data.startsWith('source_lang:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const sourceLang = parts[2];

    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '请求已过期，请重新转发。');
      return;
    }

    const { title, forwardChat, forwardDate, originalText, markdownText, fromUser, format } = pendingData;

    try {
      const email = (env.TRANSLATION_EMAIL || 'anonymous@bot.mymemory').trim();
      const result = await translateMyMemory(originalText, sourceLang, email);

      const content = generateFileContent(format, title, forwardChat, forwardDate, originalText, result.text, markdownText);
      const quote = await getRandomQuote(env);
      const fileName = `${title}-CN.${format === 'md' ? 'md' : 'txt'}`;

      let debugMsg = `[DEBUG] 翻译服务：MyMemory\n`;
      debugMsg += `源语言：${escapeHtml(sourceLang)}\n`;
      debugMsg += `耗时：${result.duration} ms\n`;
      const preview = result.text.substring(0, 60) + (result.text.length > 60 ? '…' : '');
      debugMsg += `译文预览：${preview}`;
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `<pre>${escapeHtml(debugMsg)}</pre>`);

      await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, content, quote, format);
      await incrementUserStat(env, fromUser, 'myMemory');
      
      const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '(私有频道)';
      const publishResult = await publishToLogSite(env, {
        title,
        originalText,
        translatedText: result.text,
        forwardDate,
        channelLink,
        format,
        forwardChat,
        markdownText
      });
      
      let resultMsg = `<pre>${escapeHtml(publishResult.debug)}</pre>`;
      if (publishResult.success && publishResult.url) {
        resultMsg += `\n\n📖 博客链接：${publishResult.url}`;
      }
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, resultMsg);
      
      await deletePendingForward(env, pendingId);
      await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
    } catch (e) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, `翻译失败：${e.message}`);
    }
    return;
  }

  // ---------- 格式选择后询问翻译服务 ----------
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

  // 媒体组：文件选择
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
    const captionEntities = groupData.caption_entities || [];
    
    // 使用存储的 entities 进行链接转换
    const linkResult = convertLinksToMarkdown({ 
      text: originalText, 
      caption_entities: captionEntities
    });
    const markdownText = linkResult.text;

    const pendingId = `${chatId}_${Date.now()}`;
    const pendingData = {
      chatId: chatId,
      title: safeTitle,
      forwardChat: groupData.forwardFromChat,
      forwardDate: groupData.forwardDate,
      originalText: originalText,
      markdownText: markdownText,
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