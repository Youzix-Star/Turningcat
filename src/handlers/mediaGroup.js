import { kvGet, kvPut } from "../services/kvStore.js";

export async function storeMediaGroup(env, mediaGroupId, file) {

  let group = await kvGet(env, mediaGroupId);

  if (!group) {
    group = { files: [] };
  }

  group.files.push(file);

  await kvPut(env, mediaGroupId, group);

}
