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

        // 优先处理转发消息（开始被迫营业）
        if (msg.forward_date) {
          await handleForwardedMessage(msg, env, ctx);
          return new Response('OK', { status: 200 });
        }

        // 普通命令处理
        if (text === '/start') {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
            '啧，又来了一个想白嫖本喵劳动力的愚蠢人类吗？喵～\n\n' +
            '听好了，本喵是**转向猫**。虽然很麻烦，但如果你转发频道消息给我，我就勉为其难帮你转成 TXT 吧。\n' +
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
            '📖 **给笨蛋铲屎官的说明书**\n\n' +
            '• /start - 重新接受本喵的审视\n' +
            '• /genfile - 没事找事让本喵动动爪子\n' +
            '• /rank - 看看谁进贡的猫薄荷（文件）最多\n' +
            '• /help - 记不住命令就多看几遍！\n\n' +
            '✨ **特殊叮嘱：**\n' +
            '直接转发频道的消息过来就行了！就算你一次塞一堆文件，本喵也能（骂骂咧咧地）帮你处理好。');
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `「${text}」？这种无聊的话就别发给本喵了，浪费流量喵！`);
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
    if (storedQuotes && storedQuotes.length > 0) {
      quotes = storedQuotes;
    } else {
      // 初始化默认语录
      await kv.put('cat_quotes', JSON.stringify(DEFAULT_QUOTES));
    }
  }
  const randomIndex = Math.floor(Math.random() * quotes.length);
  return quotes[randomIndex];
}

async function handleAddQuote(msg, env) {
  const chatId = msg.chat.id;
  const token = env.TELEGRAM_BOT_TOKEN;
  const adminId = env.ADMIN_ID;

  // 权限校验
  if (!adminId || msg.from.id.toString() !== adminId.toString()) {
    await sendTelegramMessage(token, chatId, "抓到一只想教本喵做事的笨蛋！你不是铲屎官头子，没有权限教我说话喵！");
    return;
  }

  const newQuote = msg.text.replace('/addquote', '').trim();
  if (!newQuote) {
    await sendTelegramMessage(token, chatId, "喂！你要教本喵说什么？后面空荡荡的，是不是傻了？");
    return;
  }

  const kv = env.USER_STATS_KV;
  if (!kv) {
    await sendTelegramMessage(token, chatId, "本喵的记忆模块没接好（无 KV），记不住啦！");
    return;
  }

  let quotes = await kv.get('cat_quotes', { type: 'json' }) || DEFAULT_QUOTES;
  quotes.push(newQuote);
  await kv.put('cat_quotes', JSON.stringify(quotes));

  await sendTelegramMessage(token, chatId, `算你有品味，这句话本喵勉强记下了：“${newQuote}”\n（当前语录库已有 ${quotes.length} 条）`);
}

// ==================== 猫薄荷进贡统计 ====================

async function incrementUserStat(env, user) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;

  try {
    let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
    const userId = user.id.toString();
    const userName = user.first_name || user.username || '不知名的铲屎官';

    if (!stats[userId]) {
      stats[userId] = { name: userName, count: 0 };
    }
    
    stats[userId].name = userName;
    stats[userId].count += 1;

    await kv.put('global_leaderboard', JSON.stringify(stats));
  } catch (e) {
    console.error('记仇本写不进去了：', e);
  }
}

async function handleRank(token, chatId, env) {
  const kv = env.USER_STATS_KV;
  if (!kv) {
    await sendTelegramMessage(token, chatId, '本喵还没准备好记仇本（未配置 KV），算你走运喵！');
    return;
  }

  let stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
  const sortedUsers = Object.values(stats).sort((a, b) => b.count - a.count);

  if (sortedUsers.length === 0) {
    await sendTelegramMessage(token, chatId, '空荡荡的...看来还没人敢来麻烦本喵嘛。');
    return;
  }

  let msg = '🌿 **猫薄荷进贡榜 (本喵的受难记录)** 🌿\n\n';
  msg += '哼，看看这些最爱使唤本喵的家伙，本喵的小本本上可都记着呢！\n\n';

  const icons = ['👑', '🥈', '🥉', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾'];
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    const user = sortedUsers[i];
    msg += `${icons[i]} **${user.name}**：进贡了 ${user.count} 袋猫薄荷\n`;
  }

  msg += '\n你们这些家伙...是不是想累死本喵好继承我的猫砂盆？喵！';
  await sendTelegramMessage(token, chatId, msg);
}

// ==================== 核心工具函数 ====================

async function sendTelegramMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
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

// 修改：接收 quote 作为参数并附在 caption 底部
async function sendDocument(token, chatId, fileName, content, quote) {
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([content], { type: 'text/plain' }), fileName);
  
  const captionText = `喏，你要的「${fileName}」拿走喵！\n\n🐾 **本喵碎碎念**：\n${quote}`;
  formData.append('caption', captionText);
  formData.append('parse_mode', 'Markdown');
  
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    await sendTelegramMessage(token, chatId, '呜…文件太重了，本喵手滑没发出去…再试一次嘛！');
  }
}

async function editMessageRemoveKeyboard(token, chatId, messageId) {
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
  await fetch(url, {
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
  const token = env.TELEGRAM_BOT_TOKEN;

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
      if (finalData) await sendFileSelection(token, finalData.chatId, mediaGroupId, finalData);
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
    body: JSON.stringify({
      chat_id: chatId,
      text: '这么多文件，你是想累死本喵吗？快点选一个，本喵的耐心是有限的！',
      reply_markup: { inline_keyboard: inlineKeyboard }
    })
  });
}

async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  if (!data.startsWith('select_file:')) return;

  const [_, mediaGroupId, fileIndex] = data.split(':');
  const kv = env.MEDIA_GROUP_CAPTIONS;
  const groupData = await kv.get(mediaGroupId, { type: 'json' });

  if (!groupData) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, callbackQuery.message.chat.id, '太久没选，本喵把那些文件都丢进垃圾桶了喵！');
    return;
  }

  const file = groupData.files[fileIndex];
  const safeTitle = sanitizeFilename(file.title);
  const fileContent = generateFileText(safeTitle, groupData.forwardFromChat, groupData.forwardDate, groupData.caption);
  const quote = await getRandomQuote(env); // 获取语录

  await sendDocument(env.TELEGRAM_BOT_TOKEN, groupData.chatId, `${safeTitle}-Log.txt`, fileContent, quote);
  await incrementUserStat(env, callbackQuery.from);
  await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, groupData.chatId, callbackQuery.message.message_id);
  await kv.delete(mediaGroupId);
}

// ==================== 核心逻辑 ====================

async function handleForwardedMessage(msg, env, ctx) {
  if (msg.media_group_id && await handleMediaGroupMessage(msg, env, ctx)) return;

  if (!msg.forward_from_chat) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '哼！本喵只处理来自频道的转发消息！这种杂鱼消息别发给我喵！');
    return;
  }

  const originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, '连个字都没有，你让本喵给你生成空气吗？喵！');
    return;
  }

  let titleBase = msg.document ? msg.document.file_name.split('.')[0] : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));
  const fileContent = generateFileText(safeTitle, msg.forward_from_chat, msg.forward_date, originalText);
  const quote = await getRandomQuote(env); // 获取语录

  await sendDocument(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `${safeTitle}-Log.txt`, fileContent, quote);
  await incrementUserStat(env, msg.from);
}

function generateFileText(title, forwardChat, forwardDate, originalText) {
  const channelLink = forwardChat.username ? `https://t.me/${forwardChat.username}` : '私有频道(没链接看个喵)';
  return `${title}\n${channelLink}\n\n---\n\n【铲屎官强迫本喵手打的原文】\n\n${originalText}\n\n---\n\n【本喵的碎碎念】\n消息原始发送时间：${formatDate(forwardDate)}\n本文件最后生成时间：${formatDate(Math.floor(Date.now()/1000))}\n本文件由傲娇的 @Turningcat_bot 强行营业生成\n\n---\n\n别乱点链接，被骗了本喵可不会去救你，哼！`;
}

async function handleGenFile(env, chatId, userId, userName) {
  const content = `这是本喵特意（并不）为你生成的文件，${userName}！\n你的用户ID：${userId}\n生成时间：${formatDate(Math.floor(Date.now()/1000))}\n反正也没什么重要的内容，拿去垫猫砂吧！`;
  const quote = await getRandomQuote(env); // 获取语录
  await sendDocument(env.TELEGRAM_BOT_TOKEN, chatId, `UselessFile_${Date.now()}.txt`, content, quote);
}
