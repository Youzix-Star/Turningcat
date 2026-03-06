import { sendTelegramMessage } from "../services/telegram.js";
import { handleForwardedMessage } from "../handlers/forward.js";
import { handleGenFile } from "../handlers/genfile.js";

export async function handleMessage(msg, env, ctx) {

  const chatId = msg.chat.id;
  const text = msg.text || "";

  if (msg.forward_date) {
    return handleForwardedMessage(msg, env, ctx);
  }

  switch (text) {

    case "/start":

      return sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "哼～你终于来找我玩了喵！\n" +
        "本喵是转向猫，可以帮你把转发的频道消息变成文件哦！"
      );

    case "/genfile":

      return handleGenFile(msg, env);

    case "/help":

      return sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "📖 帮助\n\n" +
        "/start\n" +
        "/genfile\n" +
        "/help\n\n" +
        "转发频道消息即可生成 TXT 文件"
      );

    default:

      if (text) {
        return sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          `你说了「${text}」？本喵不在意喵～`
        );
      }

  }

}
