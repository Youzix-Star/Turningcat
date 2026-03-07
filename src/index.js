// src/index.js

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      // 处理回调查询（选择媒体组文件）
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, env, ctx);
        return new Response('OK', { status: 200 });
      }

      // 处理消息
      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';

        // 优先处理转发消息
        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        // 普通命令处理
        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '啧，又来了一个想白嫖本喵劳动力的愚蠢人类吗？喵～\n\n' +
            '听好了，本喵是<b>转向猫</b>。虽然很麻烦，但如果你转发频道消息给我，我就勉为其难帮你转成 TXT 吧。\n' +
            '想看本喵被你们压榨了多少次？发 /rank 看看那个令猫绝望的排行榜吧！');
        } else if (text === '/genfile') {
          await incrementUserStat(env, msg.from);
          await handleGenFile(env, chatId, msg.from.id, msg.from.first_name);
        } else if (text === '/rank') {
          await handleRank(env.TELEGRAM_BOT_TOKEN, chatId, env);
        } else if (text.startsWith('/addquote')) {
          await handleAddQuote(msg, env);
        } else if (text === '/help') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '📖 <b>给笨蛋铲屎官的说明书</b>\n\n' +
            '• /start - 重新接受本喵的审视\n' +
            '• /genfile - 没事找事让本喵动动爪子\n' +
            '• /rank - 看看谁进贡的猫薄荷（文件）最多\n' +
            '• /help - 记不住命令就多看几遍！\n\n' +
            '✨ <b>特殊叮嘱：</b>\n' +
            '直接转发频道的消息过来就行了！就算你一次塞一堆文件，本喵也能帮你处理好。');
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `「${text}」？这种无聊的话就别发给本喵了喵！`);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('猫猫 CPU 烧了：', error);
      return new Response('Error', { status: 500 });
    }
  },
};

// ==================== 随机猫言猫语模块 ====================

const DEFAULT_QUOTES = [
  "哼，别以为本喵是想帮你，只是顺手而已！",
  "拿去吧！下次自己打字，别总指望本喵！",
  "喵呜……手都酸了，还不快去开个罐头？",
  "要是里面有错别字，肯定是你长得太丑影响了本喵的发挥！",
  "这份文件可是沾了本喵的仙气，你最好把它供起来！"
];

async function getRandomQuote(env) {
  const kv = env.USER_STATS_KV;
  let quotes = DEFAULT_QUOTES;
  if (kv) {
    const storedQuotes = await kv.get('cat_quotes', { type: 'json' });
    if (storedQuotes && storedQuotes.length > 0) quotes = storedQuotes;
  }
  return quotes[Math.floor(Math.random() * quotes.length)];
}

async function handleAddQuote(msg, env) {
  const adminId = env.ADMIN_ID;
  if (!adminId || msg.from.id.toString() !== adminId.toString()) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "抓到一只想教本喵做事的笨蛋！你没有权限喵！");
    return;
  }

  const newQuote = msg.text.replace('/addquote', '').trim();
  if (!newQuote) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "你要教本喵说什么？后面是空的喵！");
    return;
  }

  const kv = env.USER_STATS_KV;
  if (!kv) return;

  let quotes = await kv.get('cat_quotes', { type: 'json' }) || DEFAULT_QUOTES;
  quotes.push(newQuote);
  await kv.put('cat_quotes', JSON.stringify(quotes));
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `算你有品味，本喵记下了：“${newQuote}”`);
}

// ==================== 猫薄荷进贡统计 ====================

async function incrementUserStat(env, user) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;
  try {
    let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
    const userId = user.id.toString();
    const userName = user.first_name || user.username || '不知名的铲屎官';
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
    await sendTelegramMessage(token, chatId, '空荡荡的...看来还没人敢来麻烦本喵嘛。');
    return;
  }

  let msg = '🌿 <b>猫薄荷进贡榜 (本喵的受难记录)</b> 🌿\n\n';
  const icons = ['👑', '🥈', '🥉', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾'];
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    msg += `${icons[i]} <b>${sortedUsers[i].name}</b>：进贡了 ${sortedUsers[i].count} 袋猫薄荷\n`;
  }
  msg += '\n你们这些家伙...是不是想累死本喵喵？';
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

function formatDate(timestamp) {
  const date = new Date((timestamp + 8 * 3600) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear().toString().slice(-2)}.${pad(date.getUTCMonth()+1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

async function sendDocument(token, chatId, fileName, content, quote) {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([content], { type: 'text/plain' }), fileName);
  
  // 使用 HTML 模式，避免下划线导致解析失败
  const captionText = `喏，你要的「<b>${escapeHtml(fileName)}</b>」拿走喵！\n\n🐾 <b>本喵碎碎念</b>：\n${escapeHtml(quote)}`;
  formData.append('caption', captionText);
  formData.append('parse_mode', 'HTML');
  
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.text();
    console.error('发送失败原因：', err);
    await sendTelegramMessage(token, chatId, '呜…文件发送失败了喵！可能是 Telegram 觉得文件名字太怪了喵！');
  }
}

async function editMessageRemoveKeyboard(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  });
}

// ==================== 媒体组处理 ====================

async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;
  const kv = env.MEDIA_GROUP_CAPTIONS;
  let groupData = await kv.get(mediaGroupId, { type: 'json' }) || {
    files: [], caption: '', chatId: msg.chat.id, 
    forwardFromChat: msg.forward_from_chat ? { title: msg.forward_from_chat.title, username: msg.forward_from_chat.username } : null,
    forwardDate: msg.forward_date, timerStarted: false
  };

  if (msg.document) {
    groupData.files.push({ file_name: msg.document.file_name, title: msg.document.file_name.split('.')[0], file_id: msg.document.file_id });
  } else if (msg.photo) {
    groupData.files.push({ file_name: 'photo.jpg', title: '这张照片', file_id: msg.photo[msg.photo.length - 1].file_id });
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

async function sendFileSelection(token, chatId, mediaGroupId, groupData) {
  const inlineKeyboard = groupData.files.map((file, i) => ([{
    text: `📄 ${file.title}`,
    callback_data: `select_file:${mediaGroupId}:${i}`
  }]));
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: '这么多文件，快点选一个喵！', reply_markup: { inline_keyboard: inlineKeyboard } })
  });
}

async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  if (!data.startsWith('select_file:')) return;
  const [_, mediaGroupId, fileIndex] = data.split(':');
  const kv = env.MEDIA_GROUP_CAPTIONS;
  const groupData = await kv.get(mediaGroupId, { type: 'json' });
  if (!groupData) return;

  const file = groupData.files[fileIndex];
  const safeTitle = sanitizeFilename(file.title);
  const fileContent = generateFileText(safeTitle, groupData.forwardFromChat, groupData.forwardDate, groupData.caption);
  const quote = await getRandomQuote(env);

  await sendDocument(env.TELEGRAM_BOT_TOKEN, groupData.chatId, `${safeTitle}-Log.txt`, fileContent, quote);
  await incrementUserStat(env, callbackQuery.from);
  await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, groupData.chatId, callbackQuery.message.message_id);
  await kv.delete(mediaGroupId);
}

// ==================== 核心逻辑 ====================

async function handleForwardedMessage(msg, env, ctx) {
  if (msg.media_group_id && await handleMediaGroupMessage(msg, env, ctx)) return;
  if (!msg.forward_from_chat) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '哼！本喵只处理来自频道的转发消息！');
    return;
  }
  const originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '连个字都没有，本喵没法干活喵！');
    return;
  }
  let titleBase = msg.document ? msg.document.file_name.split('.')[0] : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));
  const fileContent = generateFileText(safeTitle, msg.forward_from_chat, msg.forward_date, originalText);
  const quote = await getRandomQuote(env);

  await sendDocument(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `${safeTitle}-Log.txt`, fileContent, quote);
  await incrementUserStat(env, msg.from);
}

function generateFileText(title, forwardChat, forwardDate, originalText) {
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '私有频道';
  return `${title}\n${channelLink}\n\n---\n\n【原文】\n${originalText}\n\n---\n\n【本喵碎碎念】\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n由 @Turningcat_bot 生成`;
}

async function handleGenFile(env, chatId, userId, userName) {
  const content = `这是本喵特意（并不）为你生成的文件，${userName}！\n用户ID：${userId}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}`;
  const quote = await getRandomQuote(env);
  await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, `File_${Date.now()}.txt`, content, quote);
}
