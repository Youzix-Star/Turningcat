// src/index.js

// ==================== 常量定义 ====================
const COMMANDS = {
  START: '/start',
  GENFILE: '/genfile',
  RANK: '/rank',
  HELP: '/help',
};

const MESSAGES = {
  WELCOME: '啧，又来了一个想白嫖本喵劳动力的愚蠢人类吗？喵～\n\n' +
           '听好了，本喵是**转向猫**。虽然很麻烦，但如果你转发频道消息给我，我就勉为其难帮你转成 TXT 吧。\n' +
           '想看本喵被你们压榨了多少次？发 /rank 看看那个令猫绝望的排行榜吧！',
  HELP: '📖 **给笨蛋铲屎官的说明书**\n\n' +
        '• /start - 重新接受本喵的审视\n' +
        '• /genfile - 没事找事让本喵动动爪子\n' +
        '• /rank - 看看谁进贡的猫薄荷（文件）最多\n' +
        '• /help - 记不住命令就多看几遍！\n\n' +
        '✨ **特殊叮嘱：**\n' +
        '直接转发频道的消息过来就行了！就算你一次塞一堆文件，本喵也能（骂骂咧咧地）帮你处理好。',
  NOT_FROM_CHANNEL: '哼！本喵只处理来自频道的转发消息！这种杂鱼消息别发给我喵！',
  NO_CONTENT: '连个字都没有，你让本喵给你生成空气吗？喵！',
  FILE_TOO_HEAVY: '呜…文件太重了，本喵手滑没发出去…再试一次嘛！',
  EXPIRED_SELECTION: '太久没选，本喵把那些文件都丢进垃圾桶了喵！',
  NO_STATS: '空荡荡的...看来还没人敢来麻烦本喵嘛。',
  STATS_HEADER: '🌿 **猫薄荷进贡榜 (本喵的受难记录)** 🌿\n\n哼，看看这些最爱使唤本喵的家伙，本喵的小本本上可都记着呢！\n\n',
  STATS_FOOTER: '\n你们这些家伙...是不是想累死本喵好继承我的猫砂盆？喵！',
  UNKNOWN_COMMAND: (text) => `「${text}」？这种无聊的话就别发给本喵了，浪费流量喵！`,
  SELECT_FILE: '这么多文件，你是想累死本喵吗？快点选一个，本喵的耐心是有限的！',
};

const MEDIA_GROUP_TIMEOUT = 1500; // 1.5 秒
const KV_TTL = 300; // 媒体组 KV 有效期 5 分钟
const MAX_RETRIES = 2; // Telegram API 调用重试次数

// ==================== 工具函数 ====================

/**
 * 调用 Telegram Bot API，自动处理 token 和重试
 * @param {string} token - Bot token
 * @param {string} method - API 方法名，如 'sendMessage'
 * @param {object} payload - 请求参数
 * @param {number} retries - 剩余重试次数（内部使用）
 * @returns {Promise<Response>} fetch 响应
 */
async function callTelegramAPI(token, method, payload, retries = MAX_RETRIES) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok && retries > 0) {
      console.warn(`Telegram API 调用失败，剩余重试次数 ${retries - 1}`, await response.text());
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待 1 秒后重试
      return callTelegramAPI(token, method, payload, retries - 1);
    }
    return response;
  } catch (error) {
    if (retries > 0) {
      console.warn(`Telegram API 请求异常，剩余重试次数 ${retries - 1}`, error);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return callTelegramAPI(token, method, payload, retries - 1);
    }
    throw error;
  }
}

/**
 * 发送普通文本消息（封装 callTelegramAPI）
 */
async function sendTelegramMessage(token, chatId, text) {
  await callTelegramAPI(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
}

/**
 * 发送文档文件
 */
async function sendDocument(token, chatId, fileName, content) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([content], { type: 'text/plain' }), fileName);
  formData.append('caption', `喏，你要的「${fileName}」拿走喵！\n这可是本喵辛辛苦苦（指动动小爪子）弄出来的，记得下次多带点猫薄荷！`);

  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  try {
    const response = await fetch(url, { method: 'POST', body: formData });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API 错误: ${errorText}`);
    }
  } catch (error) {
    console.error('发送文档失败', error);
    await sendTelegramMessage(token, chatId, MESSAGES.FILE_TOO_HEAVY);
  }
}

/**
 * 编辑消息移除内联键盘
 */
async function editMessageRemoveKeyboard(token, chatId, messageId) {
  await callTelegramAPI(token, 'editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

/**
 * 格式化时间戳（与原逻辑完全一致）
 * @param {number} timestamp - Unix 时间戳（秒）
 * @returns {string} 格式化后的日期时间
 */
function formatDate(timestamp) {
  const date = new Date((timestamp + 8 * 3600) * 1000); // 东八区偏移
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear().toString().slice(-2)}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * 清理文件名中的非法字符
 */
function sanitizeFilename(name) {
  return name。replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

/**
 * 生成文件内容（与原逻辑完全一致）
 */
function generateFileText(title, forwardChat, forwardDate, originalText) {
  const channelLink = forwardChat?.username ? `https://t.me/${forwardChat.username}` : '私有频道(没链接看个喵)';
  return `${title}\n${channelLink}\n\n---\n\n【铲屎官强迫本喵手打的原文】\n\n${originalText}\n\n---\n\n【本喵的碎碎念】\n消息原始发送时间：${formatDate(forwardDate)}\n本文件最后生成时间：${formatDate(Math.floor(Date.now() / 1000))}\n本文件由傲娇的 @Turningcat_bot 强行营业生成\n\n---\n\n别乱点链接，被骗了本喵可不会去救你，哼！`;
}

// ==================== 统计相关 ====================

/**
 * 增加用户统计（使用乐观锁减少并发覆盖）
 */
async function incrementUserStat(env, user) {
  const kv = env.USER_STATS_KV;
  if (!kv) return;

  const userId = user.id.toString();
  const userName = user.first_name || user.username || '不知名的铲屎官';

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { value: stats, metadata } = await kv.getWithMetadata('global_leaderboard', { type: 'json' }) || { value: {}, metadata: { version: 0 } };
      if (!stats[userId]) {
        stats[userId] = { name: userName, count: 0 };
      }
      stats[userId].name = userName;
      stats[userId].count += 1;

      // 使用 metadata 版本号作为乐观锁
      await kv.put('global_leaderboard', JSON.stringify(stats), { metadata: { version: (metadata?.version || 0) + 1 } });
      break; // 成功则退出循环
    } catch (e) {
      console.error(`记仇本更新失败（尝试 ${attempt + 1}）`, e);
      if (attempt === 2) {
        console.error('放弃更新排行榜');
      }
      // 等待随机时间后重试
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
    }
  }
}

/**
 * 处理 /rank 命令
 */
async function handleRank(token, chatId, env) {
  const kv = env.USER_STATS_KV;
  if (!kv) {
    await sendTelegramMessage(token, chatId, '本喵还没准备好记仇本（未配置 KV），算你走运喵！');
    return;
  }

  const stats = await kv.get('global_leaderboard', { type: 'json' }) || {};
  const sortedUsers = Object.values(stats).sort((a, b) => b.count - a.count);

  if (sortedUsers.length === 0) {
    await sendTelegramMessage(token, chatId, MESSAGES.NO_STATS);
    return;
  }

  let msg = MESSAGES.STATS_HEADER;
  const icons = ['👑', '🥈', '🥉', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾', '🐾'];
  for (let i = 0; i < Math.min(sortedUsers.length, 10); i++) {
    const user = sortedUsers[i];
    msg += `${icons[i]} **${user.name}**：进贡了 ${user.count} 袋猫薄荷\n`;
  }
  msg += MESSAGES.STATS_FOOTER;
  await sendTelegramMessage(token, chatId, msg);
}

// ==================== 媒体组处理 ====================

/**
 * 处理媒体组消息（收集文件并延迟发送选择菜单）
 * @returns {boolean} 是否属于媒体组且已处理
 */
async function handleMediaGroupMessage(msg, env, ctx) {
  const mediaGroupId = msg.media_group_id;
  if (!mediaGroupId) return false;

  const kv = env.MEDIA_GROUP_CAPTIONS;
  const token = env.TELEGRAM_BOT_TOKEN;

  // 读取当前组数据
  let groupData = await kv.get(mediaGroupId, { type: 'json' }) || {
    files: [],
    caption: '',
    chatId: msg.chat.id,
    forwardFromChat: msg.forward_from_chat ? { title: msg.forward_from_chat.title, username: msg.forward_from_chat.username } : null,
    forwardDate: msg.forward_date,
    timerStarted: false,
  };

  // 收集文件信息
  if (msg.document) {
    groupData.files.push({ file_name: msg.document.file_name, title: msg.document.file_name.split('.')[0], file_id: msg.document.file_id });
  } else if (msg.photo) {
    groupData.files.push({ file_name: 'photo.jpg', title: '这张照片', file_id: msg.photo[msg.photo.length - 1].file_id });
  }

  if (msg.caption) groupData.caption = msg.caption;

  // 双重检查定时器，减少并发启动多个定时器的概率
  const shouldStartTimer = !groupData.timerStarted;
  if (shouldStartTimer) {
    groupData.timerStarted = true;
    // 先写入 KV，确保其他并发请求看到 timerStarted 已开启
    await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: KV_TTL });

    // 再次读取确认（防止其他请求已修改）
    const confirmData = await kv.get(mediaGroupId, { type: 'json' });
    if (confirmData && confirmData.timerStarted) {
      ctx.waitUntil(
        new Promise(resolve => setTimeout(async () => {
          try {
            const finalData = await kv.get(mediaGroupId, { type: 'json' });
            if (finalData) {
              await sendFileSelection(token, finalData.chatId, mediaGroupId, finalData);
            }
          } catch (error) {
            console.error('媒体组定时器处理失败', error);
          }
          resolve();
        }, MEDIA_GROUP_TIMEOUT))
      );
    }
  } else {
    // 仅更新数据，不启动新定时器
    await kv.put(mediaGroupId, JSON.stringify(groupData), { expirationTtl: KV_TTL });
  }

  return true;
}

/**
 * 发送文件选择菜单
 */
async function sendFileSelection(token, chatId, mediaGroupId, groupData) {
  const inlineKeyboard = groupData.files.map((file, i) => ([{
    text: `📄 ${file.title}`,
    callback_data: `select_file:${mediaGroupId}:${i}`,
  }]));

  await callTelegramAPI(token, 'sendMessage', {
    chat_id: chatId,
    text: MESSAGES.SELECT_FILE,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

/**
 * 处理回调查询（文件选择）
 */
async function handleCallbackQuery(callbackQuery, env, ctx) {
  const data = callbackQuery.data;
  if (!data.startsWith('select_file:')) return;

  const [_, mediaGroupId, fileIndexStr] = data.split(':');
  const fileIndex = parseInt(fileIndexStr, 10);
  const kv = env.MEDIA_GROUP_CAPTIONS;
  const groupData = await kv.get(mediaGroupId, { type: 'json' });

  if (!groupData) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, callbackQuery.message.chat.id, MESSAGES.EXPIRED_SELECTION);
    return;
  }

  if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= groupData.files.length) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, callbackQuery.message.chat.id, '选的文件不存在喵！你眼花了吗？');
    return;
  }

  const file = groupData.files[fileIndex];
  const safeTitle = sanitizeFilename(file.title);
  const fileContent = generateFileText(safeTitle, groupData.forwardFromChat, groupData.forwardDate, groupData.caption);

  await sendDocument(env.TELEGRAM_BOT_TOKEN, groupData.chatId, `${safeTitle}-Log.txt`, fileContent);
  await incrementUserStat(env, callbackQuery.from);
  await editMessageRemoveKeyboard(env.TELEGRAM_BOT_TOKEN, groupData.chatId, callbackQuery.message.message_id);
  await kv.delete(mediaGroupId);
}

// ==================== 核心消息处理 ====================

/**
 * 处理转发消息
 */
async function handleForwardedMessage(msg, env, ctx) {
  // 优先处理媒体组
  if (msg.media_group_id && (await handleMediaGroupMessage(msg, env, ctx))) return;

  if (!msg.forward_from_chat) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, MESSAGES.NOT_FROM_CHANNEL);
    return;
  }

  const originalText = msg.text || msg.caption || '';
  if (!originalText) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, MESSAGES.NO_CONTENT);
    return;
  }

  let titleBase = msg.document ? msg.document.file_name.split('.')[0] : originalText.split('\n')[0].trim();
  const safeTitle = sanitizeFilename(titleBase.substring(0, 50));
  const fileContent = generateFileText(safeTitle, msg.forward_from_chat, msg.forward_date, originalText);

  await sendDocument(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `${safeTitle}-Log.txt`, fileContent);
  await incrementUserStat(env, msg.from);
}

/**
 * 处理 /genfile 命令
 */
async function handleGenFile(token, chatId, userId, userName) {
  const content = `这是本喵特意（并不）为你生成的文件，${userName}！\n你的用户ID：${userId}\n生成时间：${formatDate(Math.floor(Date.now() / 1000))}\n反正也没什么重要的内容，拿去垫猫砂吧！`;
  await sendDocument(token, chatId, `UselessFile_${Date.now()}.txt`, content);
}

// ==================== 入口 ====================

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

        // 普通命令处理
        if (text === COMMANDS.START) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, MESSAGES.WELCOME);
        } else if (text === COMMANDS.GENFILE) {
          await incrementUserStat(env, msg.from);
          await handleGenFile(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.from.first_name);
        } else if (text === COMMANDS.RANK) {
          await handleRank(env.TELEGRAM_BOT_TOKEN, chatId, env);
        } else if (text === COMMANDS.HELP) {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, MESSAGES.HELP);
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, MESSAGES.UNKNOWN_COMMAND(text));
        }
      }

      return new Response('OK', { status: 200 });
    } catch (error) {
      console.error('猫猫 CPU 烧了：', error);
      return new Response('Error', { status: 500 });
    }
  },
};
