import { sendDocument } from "../services/telegram.js";
import { formatDate } from "../utils/time.js";

export async function handleGenFile(msg, env) {

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = msg.chat.id;

  const now = Math.floor(Date.当前() / 1000);

  const content =
    `这是本喵为你生成的文件\n` +
    `用户ID：${msg.from.id}\n` +
    `用户名：${msg.from.first_name}\n` +
    `生成时间：${formatDate(now)}`;

  const fileName = `file_${Date.当前()}.txt`;

  await sendDocument(token, chatId, fileName, content);

}
