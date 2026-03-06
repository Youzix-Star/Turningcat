import { sendTelegramMessage, sendDocument, editMessageRemoveKeyboard } from "../services/telegram.js";
import { buildLogFile } from "../services/fileBuilder.js";
import { kvGet, kvDelete } from "../services/kvStore.js";

export async function handleForwardedMessage(msg, env, ctx) {

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  const originalText = msg.text || msg.caption || "";

  if (!originalText) {
    return sendTelegramMessage(token, chatId, "没有文字内容喵！");
  }

  const file = buildLogFile(msg);

  await sendDocument(token, chatId, file.name, file.content);

}

export async function processFileSelection(callbackQuery, env) {

  const token = env.TELEGRAM_BOT_TOKEN;

  const msg = callbackQuery.message;

  const chatId = msg.chat.id;

  const messageId = msg.message_id;

  const parts = callbackQuery.data.split(":");

  const mediaGroupId = parts[1];

  const index = parseInt(parts[2]);

  const data = await kvGet(env, mediaGroupId);

  if (!data) {
    return;
  }

  const file = buildLogFile(data.files[index]);

  await sendDocument(token, chatId, file.name, file.content);

  await editMessageRemoveKeyboard(token, chatId, messageId);

  await kvDelete(env, mediaGroupId);

}
