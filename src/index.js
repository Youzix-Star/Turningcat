import { handleUpdate } from "./bot/router.js";

export default {

  async fetch(request, env, ctx) {

    if (request.method !== "POST") {
      return new Response("OK");
    }

    try {

      const update = await request.json();

      await handleUpdate(update, env, ctx);

      return new Response("OK");

    } catch (err) {

      console.error("Update Error:", err);

      return new Response("Error", { status: 500 });

    }

  }

};
