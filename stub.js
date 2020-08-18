import {Rpc} from './types.js';
import {mapRemove} from './util.js';

function Stub({pc, channel}, methods) {
  const inflight = new Map();
  const handlers = new Map();

  channel.onmessage = async event => {
    const {rpcType, id, method, payload} = Rpc.read(new Uint8Array(event.data));
    const handler = handlers.get(method);
    if (!handler) { throw 'unknown method: ' + method }
    if (rpcType == Rpc.REQUEST) {
      const req = handler.request.read(payload);
      console.log('received req:', method, req);
      const resp = await handler.execute(req);
      channel.send(Rpc.write({
        method, id,
        rpcType: Rpc.RESPONSE,
        payload: handler.response.write(resp),
      }));
      console.log('sent resp:', method, resp);
    } else if (rpcType == Rpc.RESPONSE) {
      const resp = handler.response.read(payload);
      console.log('received resp:', method, resp);
      mapRemove(inflight, id).resolve(resp);
    }
  }

  const stub = {};
  for (let [method, [request, response, execute]] of Object.entries(methods.methods)) {
    stub[method] = req => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
      inflight.set(id, {resolve, reject});
      channel.send(Rpc.write({
        method, id,
        rpcType: Rpc.REQUEST,
        payload: request.write(req),
      }));
      console.log('sent req:', method, req);
    });
    handlers.set(method, {request, response, execute});
  }
  return stub;
}

export {Stub};
