// src/index.js

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      // 处理回调查询（Inline Keyboard 交互）
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
        return new Response('OK', { status: 200 });
      }

      // 处理消息
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text;

        // 优先处理转发消息（生成文件）
        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        // 普通命令处理
        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '哼～你终于来找我玩了喵！\n' +
            '本喵是转向猫，可以帮你把转发的频道消息变成文件哦！\n' +
            '试试 /genfile 看看本喵的厉害吧～');
        } else if (text === '/genfile') {
          // 增加统计
          await incrementUserStat(env, msg.from);
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.from.first_name);
        } else if (text === '/rank') {
          // 排行榜功能
          await handleRank(env.TELEGRAM_BOT_TOKEN, chatId, env);
        } else if (text === '/help') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '📖 本喵的帮助手册（好好看！）\n\n' +
            '• /start - 重新认识本喵\n' +
            '• /genfile - 让本喵随便生成一个文件给你\n' +
            '• /rank - 查看本喵的「打工受难记」排行榜\n' +
            '• /help - 再看一次帮助\n\n' +
            '✨ 特殊能力：\n' +
            '转发来自频道的消息，本喵会贴心地让你选择要生成哪个文件的 TXT～');
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `你说了「${text}」？哼，本喵才不感兴趣呢！`);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('处理出错：', error);
      return new Response('Error', { status: 500 });
    }
  },
};

// ==================== 数据统计与排行功能 ====================

async function incrementUserStat(env, user) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;

  try {
    let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
    const userId = user.id.toString();
    const userName = user.first_name || user.username || '神秘铲屎官';

    if (!stats[userId]) {
      stats[userId] = { name: userName, count: 0 };
    }
    
    stats[userId].name = userName;
    stats[userId].count += 1;

    await kv.put('global_leaderboard', JSON.stringify(stats));
  } catch (e) {
    console.error('统计写入失败：', e);
  }
}

async function handleRank(token, chatId, env) {
  const kv = env.USER_STATS_KV;
  if (!kv) {
    await sendTelegramMessage(token, chatId, '呜…由于本喵没有配置统计模块，暂时记不住你们喵！');
    return;
  }

  let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
  const sortedUsers = Object.values(stats).sort((a, b) => b.count - a.count);

  if (sortedUsers.length === 0) {
    await sendTelegramMessage(token, chatId, '哼，现在还没有人压榨本喵工作，你们这群懒虫！');
    return;
  }

  let msg = '🏆 **本喵的「打工受难记」排行榜** 🏆\n\n';
  msg += '本喵才不是特意记这些的，只是想看看谁最爱烦我而已！喵！\n\n';

  const symbols = ['🥇', '🥈', '🥉', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾'];
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    const user = sortedUsers[i];
    msg += `${symbols[i]} 第${i + 1}名: ${user.name} - **${user.count}** 份文件\n`;
  }

  msg += '\n看什么看！还不快点去给本喵准备小鱼干！';
  await sendTelegramMessage(token, chatId, msg);
}

// ==================== 工具函数 ====================

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = { chat_id: chatId, text, parse_mode: 'Markdown' };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error('发送消息失败：', await response.text());
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
  formData.append('caption', `文件给你了喵～ ${fileName} （哼，才不是特意为你做的呢！）`);
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    console.error('发送文件失败：', await response.text());
    await sendTelegramMessage(token, chatId, '呜…文件发送失败了喵…再试一次嘛！');
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
      file_id: msg.document.file_id
    });
  } else if (msg.photo) {
    groupData.files.push({
      file_name: 'photo.jpg',
      title: 'photo',
      file_id: msg.photo[msg.photo.length - 1].file_id
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
            console.error('媒体组延迟处理失败：', e);
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
  const inlineKeyboard = groupData.files.map((file, i) => ([{
    text: file.title || file.file_name || `文件 ${i+1}`,
    callback_data: `select_file:${mediaGroupId}:${i}`
  }]));

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '这么多文件，你要选哪个喵？快点告诉本喵！',
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
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
  const mediaGroupId = parts[1];
  const fileIndex = parseInt(parts[2], 10);

  const kv = env.MEDIA_GROUP_CAPTIONS;
  const groupData = await kv.get(mediaGroupId, { type: 'json' });
  if (!groupData || !groupData.files[fileIndex]) {
    await sendTelegramMessage(token, chatId, '呜…信息过期了喵，重新转发一下吧！');
    return;
  }

  const file = groupData.files[fileIndex];
  const safeTitle = sanitizeFilename(file.title || '未命名');
  const fileContent = generateFileText(safeTitle, groupData.forwardFromChat, groupData.forwardDate, groupData.caption);

  // 发送文档并增加统计
  await sendDocument(token, chatId, `${safeTitle}-Log.txt`, fileContent);
  await incrementUserStat(env, callbackQuery.from);

  await editMessageRemoveKeyboard(token, chatId, messageId);
  await kv.delete(mediaGroupId);
}

// ==================== 核心转发处理逻辑 ====================

async function handleForwardedMessage(msg, env, ctx) {
  if (msg.media_group_id) {
    if (await handleMediaGroupMessage(msg, env, ctx)) return;
  }

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;
  const originalText = msg.text || msg.caption || '';

  if (!originalText) {
    await sendTelegramMessage(token, chatId, '呜…这条消息没有文字内容喵！');
    return;
  }

  if (!msg.forward_from_chat) {
    await sendTelegramMessage(token, chatId, '哼！本喵只处理来自频道的转发消息！');
    return;
  }

  let titleBase = msg.document ? msg.document.file_name.split('.')[0] : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));
  const fileContent = generateFileText(safeTitle, msg.forward_from_chat, msg.forward_date, originalText);

  await sendDocument(token, chatId, `${safeTitle}-Log.txt`, fileContent);
  await incrementUserStat(env, msg.from);
}

function generateFileText(title, forwardChat, forwardDate, originalText) {
  const sendTime = formatDate(forwardDate);
  const nowTime = formatDate(Math.floor(Date.now() / 1000));
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '私有/无链接';

  return `${title}\n${channelLink}\n\n---\n\n更新日志原文如下\n\n${originalText}\n\n---\n\n更新信息\n\n消息原始发送时间：${sendTime}\n本文件最后编辑时间：${nowTime}\n本文件由 @Turningcat_bot 自动生成\n\n---\n\n请勿相信任何非管理上传模块 提高防范意识 谢谢`;
}

// ==================== /genfile 功能 ====================

async function handleGenFile(token, chatId, userId, userName) {
  const content = `这是本喵特意为你生成的文件，${userName}！\n你的用户ID：${userId}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n哼，才不是想讨好你呢！`;
  await sendDocument(token, chatId, `file_${Date.now()}.txt`, content);
}
