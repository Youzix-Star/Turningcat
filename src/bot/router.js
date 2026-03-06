import { handleMessage } from "./commands.js";
import { handleCallback } from "./callbacks.js";

export async function handleUpdate(update, env, ctx) {

  if (update.message) {
    await handleMessage(update.message, env, ctx);
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, env, ctx);
  }

}
