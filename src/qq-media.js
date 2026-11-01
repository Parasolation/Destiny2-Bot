import { createHash } from 'node:crypto';

function checked(result, stage, field) {
  const code = result?.code ?? result?.err_code;
  if ((code != null && Number(code) !== 0) || typeof result?.[field] !== 'string' || !result[field].trim()) {
    const error = new Error(`QQ ${stage}未取得有效回执。`);
    error.stage = stage;
    if (code != null && Number.isFinite(Number(code))) error.bizCode = Number(code);
    throw error;
  }
  return result;
}

// Validate both stages: HTTP 200 by itself is not a successful media reply.
export async function sendQQImage(bot, target, { buffer }) {
  const upload = checked(await bot.uploadMedia({ target, fileType: 1, buffer, srvSendMsg: false }), '图片上传', 'file_info');
  // The official group/C2C API documents a media bug when content is omitted.
  const message = checked(await bot.send({ target, msgType: 7, content: ' ', media: { file_info: upload.file_info } }), '消息发送', 'id');
  return { receipt: createHash('sha256').update(message.id).digest('hex').slice(0, 12) };
}
