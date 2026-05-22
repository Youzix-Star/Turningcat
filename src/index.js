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
            '听好了，本喵是<b>转向猫</b>。虽然很麻烦，但如果你转发频道消息给我，我就勉为其难帮你转成 TXT 或 MD 吧。\n' +
            '想看本喵被压榨了多少次？发 /rank 看看那个令猫绝望的排行榜吧！');
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
            '• /rank - 看看谁进贡的猫薄荷最多\n' +
            '• /help - 记不住命令就多看几遍！');
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
  if (!newQuote) return;
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
  await sendTelegramMessage(token, chatId, msg + '\n你们这些家伙...是不是想累死本喵喵？');
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
  
  const captionText = `喏，你要的「<b>${escapeHtml(fileName)}</b>」拿走喵！\n\n🐾 <b>本喵碎碎念</b>：\n${escapeHtml(quote)}`;
  formData.append('caption', captionText);
  formData.append('parse_mode', 'HTML');
  
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    await sendTelegramMessage(token, chatId, '呜…文件发送失败了喵！检查下名字是不是太怪了喵！');
  }
}

async function editMessageRemoveKeyboard(token, chatId, messageId) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } })
  });
}

// ==================== 翻译模块（MyMemory 免费 API） ====================

async function translateTextViaMyMemory(text, email) {
  // MyMemory 单次最多 500 字符，超过则截断并提示
  const MAX_CHARS = 500;
  let textToTranslate = text;
  let truncated = false;
  if (text.length > MAX_CHARS) {
    textToTranslate = text.substring(0, MAX_CHARS);
    truncated = true;
  }
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|zh-CN&de=${encodeURIComponent(email)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.responseStatus !== 200) {
    throw new Error('Translation API error');
  }
  let translated = data.responseData.translatedText;
  if (truncated) {
    translated += '\n\n[⚠️ 原文超过500字符，已自动截断翻译]';
  }
  return translated;
}

// ==================== 生成文件内容（支持格式） ====================

function generateFileContent(format, title, forwardChat, forwardDate, originalText, translatedText = null) {
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '（私有频道）';
  
  if (format === 'md') {
    let body = '';
    if (translatedText) {
      const escapedOriginal = originalText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      const escapedTranslated = translatedText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 📄 原文\n\n${escapedOriginal}\n\n---\n\n## 🌐 简体中文翻译\n\n${escapedTranslated}`;
    } else {
      const escapedOriginal = originalText.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      body = `## 📄 更新日志原文\n\n${escapedOriginal}`;
    }
    return `# ${title}

📢 **来源频道**：[${escapeHtml(forwardChat.title)}](${channelLink})

${body}

---

> 本喵只是无情的格式转换工具喵。

- **转发时间**：${formatDate(forwardDate)}  
- **生成时间**：${formatDate(Math.floor(Date.now()/1000))}  
- 由 [@Turningcat_bot](https://t.me/Turningcat_bot) 生成
`;
  } else {
    // TXT 格式
    if (translatedText) {
      return `${title}\n${channelLink}\n\n---\n\n【原文】\n${originalText}\n\n---\n\n【简体中文翻译】\n${translatedText}\n\n---\n\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n由 @Turningcat_bot 生成`;
    } else {
      return `${title}\n${channelLink}\n\n---\n\n【更新日志原文】\n${originalText}\n\n---\n\n【本喵碎碎念】\n发送时间：${formatDate(forwardDate)}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n由 @Turningcat_bot 生成`;
    }
  }
}

// ==================== 临时存储 ====================

async function storePendingForward(env, key, data) {
  const kv = env.MEDIA_GROUP_CAPTIONS;
  await kv.put(`pending:${key}`, JSON.stringify(data), { expirationTtl: 600 }); // 延长有效期
}

async function getPendingForward(env, key) {
  const kv = env.MEDIA_GROUP_CAPTIONS;
  const data = await kv.get(`pending:${key}`, { type: 'json' });
  return data;
}

async function deletePendingForward(env, key) {
  const kv = env.MEDIA_GROUP_CAPTIONS;
  await kv.delete(`pending:${key}`);
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
    groupData.files.push({ file_name: msg.document.file_name, title: getBaseName(msg.document.file_name), file_id: msg.document.file_id });
  } else if (msg.photo) {
    groupData.files.push({ file_name: 'photo.jpg', title: '这张照片', file_id: msg.photo[msg.photo.length - 1].file_id });
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
      { text: `📄 ${file.title} (.txt)`, callback_data: `select_file:${mediaGroupId}:${i}:txt` },
      { text: `📝 ${file.title} (.md)`, callback_data: `select_file:${mediaGroupId}:${i}:md` }
    ]);
  });
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: '这么多文件，快点选一个喵！想要 TXT 还是 MD？', reply_markup: { inline_keyboard: inlineKeyboard } })
  });
}

// ==================== 单文件转发处理（带格式选择） ====================

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
      { text: '📄 生成 TXT 文件', callback_data: `pending_format:${pendingId}:txt` },
      { text: '📝 生成 MD 文件', callback_data: `pending_format:${pendingId}:md` }
    ]
  ];
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text: `收到来自「${escapeHtml(msg.forward_from_chat.title)}」的转发，要导出什么格式喵？`,
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

  // 处理翻译选择（是/否）
  if (data.startsWith('translate_choice:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const choice = parts[2]; // 'yes' 或 'no'
    
    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '太久没选，本喵忘记刚才的请求了喵！');
      return;
    }

    const { title, forwardChat, forwardDate, originalText, fromUser, format } = pendingData;
    let finalContent = '';
    let fileName = `${title}-Log.${format === 'md' ? 'md' : 'txt'}`;
    let translatedText = null;

    if (choice === 'yes') {
      try {
        const email = env.TRANSLATION_EMAIL || 'anonymous@bot.mymemory';
        translatedText = await translateTextViaMyMemory(originalText, email);
        // 翻译成功后文件名加入 -CN
        fileName = `${title}-Log-CN.${format === 'md' ? 'md' : 'txt'}`;
      } catch (e) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '呜…翻译失败喵，将为你生成原文文件。');
        // 失败则继续使用原文
      }
    }

    finalContent = generateFileContent(format, title, forwardChat, forwardDate, originalText, translatedText);
    const quote = await getRandomQuote(env);
    await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, fileName, finalContent, quote, format);
    await incrementUserStat(env, fromUser);
    await deletePendingForward(env, pendingId);
    // 移除原先询问翻译的键盘
    await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, chatId, messageId);
    return;
  }

  // 处理媒体组文件选择 -> 转为 pending 并询问翻译
  if (data.startsWith('select_file:')) {
    const parts = data.split(':');
    const mediaGroupId = parts[1];
    const fileIndex = parseInt(parts[2]);
    const format = parts[3];
    
    const kv = env.MEDIA_GROUP_CAPTIONS;
    const groupData = await kv.get(mediaGroupId, { type: 'json' });
    if (!groupData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '数据过期了喵，重新转发一下吧！');
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

    // 询问翻译
    const inlineKeyboard = [
      [
        { text: '✅ 是，翻译成简体中文', callback_data: `translate_choice:${pendingId}:yes` },
        { text: '❌ 否，保留原文', callback_data: `translate_choice:${pendingId}:no` }
      ]
    ];
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      `已选择「${safeTitle}」导出为 ${format.toUpperCase()}，要翻译成简体中文吗？`,
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }

  // 处理单文件格式选择 -> 转为 pending 并询问翻译
  if (data.startsWith('pending_format:')) {
    const parts = data.split(':');
    const pendingId = parts[1];
    const format = parts[2];
    
    const pendingData = await getPendingForward(env, pendingId);
    if (!pendingData) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, '太久没选，本喵忘记刚才的请求了喵！');
      return;
    }

    // 更新 pendingData，加入 format 字段
    pendingData.format = format;
    await storePendingForward(env, pendingId, pendingData);

    // 询问翻译
    const inlineKeyboard = [
      [
        { text: '✅ 是，翻译成简体中文', callback_data: `translate_choice:${pendingId}:yes` },
        { text: '❌ 否，保留原文', callback_data: `translate_choice:${pendingId}:no` }
      ]
    ];
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
      `已选择导出为 ${format.toUpperCase()}，要翻译成简体中文吗？`,
      { inline_keyboard: inlineKeyboard }
    );
    return;
  }
}

// ==================== 原有辅助功能 ====================

async function handleGenFile(env, chatId, userId, userName) {
  const content = `这是本喵特意为你生成的文件，${userName}！\n用户ID：${userId}`;
  const quote = await getRandomQuote(env);
  await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, `File_${Date.now()}.txt`, content, quote);
}
