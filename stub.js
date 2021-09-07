import {MessagePiece, Rpc} from './types.js';
import {mapRemove} from './util.js';

const MAX_32 = 2**32 - 1;

async function Stub({pc, channel}, key, methods) {
  const chunkSize = 60000; // 64k limit
  const inflight = new Map();
  const handlers = new Map();
  const buffers = new Map();

  const myIv = window.crypto.getRandomValues(new Uint8Array(12));
  channel.send(myIv);
  const theirIv = await new Promise((resolve, reject) => {
    channel.onmessage = async event => {
      if (event.data.byteLength == 12) {
        resolve(new Uint8Array(event.data));
      } else {
        reject('stub: invalid random');
      }
      channel.onmessage = undefined;
    }
  });
  const encrypt = data => window.crypto.subtle.encrypt({name: 'AES-GCM', iv: myIv}, key, data);
  const decrypt = data => window.crypto.subtle.decrypt({name: 'AES-GCM', iv: theirIv}, key, data);

  const sendParts = async data => {
    const encrypted = await encrypt(Rpc.write(data));
    const pieceCount = Math.ceil(encrypted.byteLength / chunkSize);
    const messageId = Math.floor(Math.random() * MAX_32);
    for (let piece=0, offset=0; piece < pieceCount; piece++, offset+=chunkSize) {
      channel.send(MessagePiece.write({
        messageId, piece, pieceCount,
        payload: new Uint8Array(encrypted, offset, Math.min(encrypted.byteLength - offset, chunkSize)),
      }));
    }
    return encrypted.byteLength;
  };

  function mapGet(map, key, def) {
    if (map.has(key)) {
      return map.get(key);
    } else {
      map.set(key, def);
      return def;
    }
  }

  function concatArrays(arrays) {
    let len = 0;
    for (let i=0; i<arrays.length; len += arrays[i].byteLength, i++) {
    }
    const out = new Uint8Array(len);
    for (let i=0, offset=0; i<arrays.length; offset += arrays[i].byteLength, i++) {
      out.set(new Uint8Array(arrays[i]), offset);
    }
    return out;
  }

  const receiveParts = async event => {
    const {messageId, piece, pieceCount, payload} = MessagePiece.read(event.data);
    if (piece == 0 && pieceCount == 1) {
      return Rpc.read(await decrypt(payload));
    }
    const buffer = mapGet(buffers, messageId, { seen: 0, pieces: [] });
    buffer.pieces[piece] = payload;
    buffer.seen++;
    if (buffer.seen == pieceCount) {
      buffers.delete(messageId);
      return Rpc.read(await decrypt(concatArrays(buffer.pieces)));
    } else {
      return null;
    }
  }

  channel.onmessage = async event => {
    const rpc = await receiveParts(event);
    if (rpc == null) {
      return;
    }
    const {type, id, method, payload} = rpc;
    const handler = handlers.get(method);
    if (!handler) { throw 'unknown method: ' + method }
    if (type == Rpc.REQUEST) {
      const req = handler.request.read(payload);
      const resp = await handler.execute(req);
      const respLength = sendParts({
        method, id,
        type: Rpc.RESPONSE,
        payload: handler.response.write(resp),
      });
      console.log('[rpc] server: ', method, 'req', req, '-> resp', await respLength, resp);
    } else if (type == Rpc.RESPONSE) {
      const resp = handler.response.read(payload);
      const callback = mapRemove(inflight, id);
      console.log('[rpc] client: ', method, 'req', await callback.reqLength, callback.req, '-> ', resp);
      callback.resolve(resp);
    }
  }

  const stub = {};
  for (let [method, [request, response, execute]] of Object.entries(methods)) {
    stub[method] = req => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * MAX_32);
      const reqLength = sendParts({
        method, id,
        type: Rpc.REQUEST,
        payload: request.write(req),
      });
      inflight.set(id, {resolve, reject, req, reqLength});
    });
    handlers.set(method, {request, response, execute});
  }
  return stub;
}

export {Stub};
