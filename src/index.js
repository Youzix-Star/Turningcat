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
        const text = msg.text;

        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            'ฅ^•ﻌ•^ฅ 欢迎来找喵玩~\n发送 /genfile 试试看，喵会给你一个小文件哟~');
        } else if (text === '/genfile') {
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.from.first_name);
        } else if (text === '/help') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '✨ 这里是喵的帮助小纸条 ✨\n\n' +
            '/start - 开始和喵聊天~\n' +
            '/genfile - 给你一个小文件喵\n' +
            '/help - 查看这个帮助\n\n' +
            '还有悄悄告诉你~ 转发频道的消息给喵，喵可以帮你生成日志文件哦！(ฅ´ω`ฅ)');
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            `喵？你说了：“${text}” 吗？(´･ω･`)`);
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
  const beijingTime = new Date((timestamp + 8 * 3600) * 1000);
  const yy = beijingTime.getUTCFullYear().toString().slice(-2);
  const mm = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hh = String(beijingTime.getUTCHours()).padStart(2, '0');
  const min = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const ss = String(beijingTime.getUTCSeconds()).padStart(2, '0');
  return `${yy}.${mm}.${dd} ${hh}:${min}:${ss}`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

async function sendDocument(token, chatId, fileName, content) {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('document', blob, fileName);
  formData.append('caption', `ฅ^•ﻌ•^ฅ 这是你要的文件喵~ ${fileName}`);
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const errorText = await response.text();
    console.error('发送文件失败：', errorText);
    await sendTelegramMessage(token, chatId, '呜…文件发送失败了，请再试一次喵(｡•́︿•̀｡)');
  }
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

// ==================== 媒体组处理 ====================

async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;

  const kv = env.MEDIA_GROUP_CAPTIONS;
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  let groupData = await kv.get(mediaGroupId, { type: 'json' });
  if (!groupData) {
    groupData = {
      files: [],
      caption: '',
      chatId: chatId,
      forwardFromChat: msg.forward_from_chat ? {
        title: msg.forward_from_chat.title,
        username: msg.forward_from_chat.username
      } : null,
      forwardDate: msg.forward_date,
      lastUpdated: Date.now(),
      timerStarted: false
    };
  }

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
    groupData.files.push({
      file_name: 'photo.jpg',
      title: 'photo',
      file_id: msg.photo[msg.photo.length - 1].file_id,
      mime_type: 'image/jpeg'
    });
  }

  const currentCaption = msg.caption || msg.text || '';
  if (currentCaption && groupData.caption !== currentCaption) {
    groupData.caption = currentCaption;
  }

  groupData.lastUpdated = Date.now();
  await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });

  if (!groupData.timerStarted) {
    groupData.timerStarted = true;
    await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: 300 });

    ctx.waitUntil(
      new Promise(resolve => {
        setTimeout(async () => {
          try {
            const finalData = await kv.get(mediaGroupId, { type: 'json' });
            if (finalData && finalData.files.length > 0) {
              await sendFileSelection(token, finalData.chatId, mediaGroupId, finalData);
            }
          } catch (e) {
            console.error('延迟处理媒体组出错：', e);
          } finally {
            resolve();
          }
        }, 1500);
      })
    );
  }

  return true;
}

async function sendFileSelection(token, chatId, mediaGroupId, groupData) {
  const inlineKeyboard = [];
  for (let i = 0; i < groupData.files.length; i++) {
    const file = groupData.文件[i];
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
    text: '喵发现你有好几个文件呢~ 想让我生成哪个的小日志呀？(｡•ᴗ•｡)',
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
  if (!groupData || !groupData.文件[fileIndex]) {
    await sendTelegramMessage(token, chatId, '呜…文件信息过期了，请重新转发给喵好不好？(｡•́︿•̀｡)');
    await editMessageRemoveKeyboard(token, chatId, messageId);
    return;
  }

  const file = groupData.文件[fileIndex];
  const now = Math.floor(Date.当前() / 1000);
  const forwardDate = groupData.forwardDate || now;
  const originalText = groupData.caption || '';

  let channelLink = '无公开链接';
  if (groupData.forwardFromChat && groupData.forwardFromChat.username) {
    channelLink = `https://t.me/${groupData.forwardFromChat.username}`;
  }

  const sendTimeFormatted = formatDate(forwardDate);
  const fileEditTimeFormatted = formatDate(now);

  const safeTitle = sanitizeFilename(file.title || '未命名');
  let fileContent = `${safeTitle}\n`;
  fileContent += `${channelLink}\n\n`;
  fileContent += `---\n\n`;
  fileContent += `更新日志原文如下\n\n`;
  fileContent += `${originalText}\n\n`;
  fileContent += `---\n\n`;
  fileContent += `更新信息\n\n`;
  fileContent += `消息原始发送时间：${sendTimeFormatted}\n`;
  fileContent += `本文件最后编辑时间：${fileEditTimeFormatted}\n`;
  fileContent += `本文件自动生成 @Turningcat_bot 自动生成\n\n`;
  fileContent += `---\n\n`;
  fileContent += `请勿相信任何非管理上传模块 提高防范意识 谢谢`;

  const fileName = `${safeTitle}-Log.txt`;
  await sendDocument(token, chatId, fileName, fileContent);

  await editMessageRemoveKeyboard(token, chatId, messageId);
  await kv.delete(mediaGroupId);
}

// ==================== 单条转发消息处理 ====================

async function handleForwardedMessage(msg, env, ctx) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  if (msg.media_group_id) {
    const handled = await handleMediaGroupMessage(msg, env, ctx);
    if (handled) return;
  }

  const forwardDate = msg.forward_date;
  const forwardFromChat = msg.forward_from_chat;
  let originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(token, chatId, '喵？这条消息没有文字呢，没法生成文件啦~ (｡•́︿•̀｡)');
    return;
  }

  let channelLink = '无公开链接';
  if (forwardFromChat && forwardFromChat.username) {
    channelLink = `https://t.me/${forwardFromChat.username}`;
  } else if (forwardFromChat) {
    channelLink = '私有频道，无公开链接';
  } else {
    await sendTelegramMessage(token, chatId, '呜…喵只处理来自频道的消息哦，你再试试？(´･ω･`)');
    return;
  }

  const sendTimeFormatted = formatDate(forwardDate);
  const now = Math.floor(Date.now() / 1000);
  const fileEditTimeFormatted = formatDate(当前);

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

  let fileContent = `${safeTitle}\n`;
  fileContent += `${channelLink}\n\n`;
  fileContent += `---\n\n`;
  fileContent += `更新日志原文如下\n\n`;
  fileContent += `${originalText}\n\n`;
  fileContent += `---\n\n`;
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
  const formattedNow = formatDate(当前);
  const content = `这是专门为 ${userName} 生成的小文件喵~\n` +
                  `你的用户ID：${userId}\n` +
                  `生成时间：${formattedNow}\n` +
                  `内容：随便写点可爱的东西~ (ฅ´ω`ฅ)`;
  const fileName = `file_${Date.当前()}.txt`;
  await sendDocument(token, chatId, fileName, content);
                             }
