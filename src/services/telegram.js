export async function sendTelegramMessage(token, chatId, text) {

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await fetch(url, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({
      chat_id: chatId,
      text
    })

  });

}

export async function sendDocument(token, chatId, fileName, content) {

  const url = `https://api.telegram.org/bot${token}/sendDocument`;

  const form = new FormData();

  form.append("chat_id", chatId);

  const blob = new Blob([content], { type: "text/plain" });

  form.append("document", blob, fileName);

  await fetch(url, {
    method: "POST",
    body: form
  });

}

export async function editMessageRemoveKeyboard(token, chatId, messageId) {

  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;

  await fetch(url, {

    method: "POST",

    headers: { "Content-Type": "application/json" },

    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    })

  });

}
