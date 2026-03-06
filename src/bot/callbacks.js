import { processFileSelection } from "../handlers/forward.js";

export async function handleCallback(callbackQuery, env, ctx) {

  const data = callbackQuery.data;

  if (data.startsWith("select_file:")) {

    await processFileSelection(callbackQuery, env);

  }

}
