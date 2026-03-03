// src/index.js

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const update = await request.json();

      if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text;

        // ===== 优先处理转发消息（生成文件）=====
        if (msg.forward_date) {
          await handleForwardedMessage(msg, env);
          return new Response('OK', { status: 200 });
        }

        // ===== 普通命令处理 =====
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

/** 发送普通文本消息 */
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

/** 格式化时间戳为北京时间 YY.MM.DD HH:MM:SS */
function formatDate(timestamp) {
  // 转换为北京时间（UTC+8）
  const beijingTime = new Date((timestamp + 8 * 3600) * 1000);
  const yy = beijingTime.getUTCFullYear().toString().slice(-2);
  const mm = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hh = String(beijingTime.getUTCHours()).padStart(2, '0');
  const min = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const ss = String(beijingTime.getUTCSeconds()).padStart(2, '0');
  return `${yy}.${mm}.${dd} ${hh}:${min}:${ss}`;
}

/** 判断文本是否包含中文 */
function containsChinese(text) {
  return /[\u4e00-\u9fa5]/.test(text);
}

/** 清理文件名中的非法字符 */
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
}

/** 调用翻译代理进行翻译（需要环境变量 TRANSLATE_API_URL） */
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
    // 期望返回格式：{ code: 0, text: "翻译结果" }
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

/** 发送文本文件 */
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

// ==================== 转发消息处理 ====================

async function handleForwardedMessage(msg, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;
  const forwardDate = msg.forward_date;          // 原始发送时间戳
  const forwardFromChat = msg.forward_from_chat; // 原始频道信息

  // 1. 提取原文（优先取文本，否则取说明）
  let originalText = msg.text || msg.caption || '';

  // 2. 获取频道信息
  let channelName = '未知频道';
  let channelLink = '无公开链接';
  if (forwardFromChat) {
    channelName = forwardFromChat.title || '未知频道';
    const username = forwardFromChat.username;
    if (username) {
      channelLink = `https://t.me/${username}`;
    } else {
      channelLink = '私有频道，无公开链接';
    }
  } else {
    await sendTelegramMessage(token, chatId, '只支持处理来自频道的转发消息。');
    return;
  }

  // 3. 判断是否需要翻译（原文非中文时需要翻译成中文）
  let translationPart = '';
  if (originalText) {
    const isChinese = containsChinese(originalText);
    if (!isChinese && env.TRANSLATE_API_URL) {
      const translated = await translateText(originalText, 'zh', env);
      // 翻译部分包含前后空行和分隔线
      translationPart = `\n---\n\nGoogle 翻译如下\n\n${translated}\n\n---`;
    }
  }

  // 4. 格式化时间（使用北京时间）
  const sendTimeFormatted = formatDate(forwardDate);
  const now = Math.floor(Date.now() / 1000);
  const fileEditTimeFormatted = formatDate(now);

  // ===== 生成标题（文件名基础）=====
  let titleBase = '';
  // 优先使用转发的文件名（如果是文件消息）
  if (msg.document) {
    const fullName = msg.document.file_name; // 例如 "FunBox Build.apk"
    // 去掉扩展名（最后一个点及其之后）
    const lastDot = fullName.lastIndexOf('.');
    if (lastDot !== -1) {
      titleBase = fullName.substring(0, lastDot);
    } else {
      titleBase = fullName; // 无扩展名
    }
  } else if (originalText) {
    // 没有文件但有文本，取第一行作为标题
    titleBase = originalText.split('\n')[0].trim();
  } else {
    titleBase = '未命名';
  }
  // 限制长度并清理非法字符
  titleBase = titleBase.substring(0, 50);
  const safeTitle = sanitizeFilename(titleBase);

  // 生成文件名（格式：标题-Log.txt）
  const fileName = `${safeTitle}-Log.txt`;
  // =================================

  // 5. 组装文件内容（严格按照模板）
  let fileContent = `${safeTitle}\n`;                // 第一行：标题
  fileContent += `${channelLink}\n\n`;               // 第二行：频道链接 + 空行
  fileContent += `---\n\n`;                          // 第一个分隔线 + 空行
  fileContent += `更新日志原文如下\n\n`;              // 小标题 + 空行
  fileContent += `${originalText}\n\n`;              // 原文 + 空行

  // 如果有翻译，插入翻译部分（它已自带前后格式）
  if (translationPart) {
    fileContent += translationPart;
  } else {
    // 无翻译时，直接插入第二个分隔线（与更新信息之间留一个空行）
    fileContent += `---\n\n`;
  }

  // 更新信息部分
  fileContent += `更新信息\n\n`;                      // 小标题 + 空行
  fileContent += `消息原始发送时间：${sendTimeFormatted}\n`;
  fileContent += `本文件最后编辑时间：${fileEditTimeFormatted}\n`;
  fileContent += `本文件自动生成 @Turningcat_bot 自动生成\n\n`;
  fileContent += `---\n\n`;                          // 最后的分隔线
  fileContent += `请勿相信任何非管理上传模块 提高防范意识 谢谢`;

  // 6. 发送文件
  await sendDocument(token, chatId, fileName, fileContent);
}

// ==================== 原有的 /genfile 功能 ====================
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
