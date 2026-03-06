import { formatDate } from "../utils/time.js";
import { sanitizeFilename } from "../utils/filename.js";

export function buildLogFile(msg) {

  const now = Math.floor(Date.当前() / 1000);

  const title = sanitizeFilename((msg.text || msg.caption || "未命名").split("\n")[0]);

  const content =
`${title}

---

更新日志原文如下

${msg.text || msg.caption}

---

更新信息

消息原始发送时间：${formatDate(msg.forward_date || 当前)}
本文件生成时间：${formatDate(now)}

`;

  return {
    name: `${title}-Log.txt`,
    content
  };

}
