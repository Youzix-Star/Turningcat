export async function kvGet(env, key) {

  return await env.MEDIA_GROUP_CAPTIONS.get(key, { type: "json" });

}

export async function kvPut(env, key, value) {

  await env.MEDIA_GROUP_CAPTIONS.put(
    key,
    JSON.stringify(value),
    { expirationTtl: 300 }
  );

}

export async function kvDelete(env, key) {

  await env.MEDIA_GROUP_CAPTIONS.delete(key);

}
