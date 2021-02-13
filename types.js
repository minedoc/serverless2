import {message, repeated, string, json, binary, int, oneof} from './binary.js';

const MessagePiece = message('MessagePiece', {
  messageId: int(1),
  piece: int(2),
  pieceCount: int(3),
  payload: binary(4)
});

const Rpc = message('Rpc', {
  type: int(1),
  id: int(2),
  method: string(3),
  payload: binary(4),
});
Rpc.REQUEST = 1;
Rpc.RESPONSE = 2;

const Clock = message('Clock', {
  global: int(1),
  site: int(2),
  local: int(3),
});

const Update = message('Update', {
  clock: Clock(1),
  table: string(2),
  rowId: string(3),
  value: json(4),
});

const Delete = message('Delete', {
  clock: Clock(1),
  table: string(2),
  rowId: string(3),
});

const Change = oneof('Change', [Update, Delete]);

const GetUnseenChangesReq = message('GetUnseenChangesReq', {
  bloomFilter: binary(1),
});

const GetUnseenChangesResp = message('GetUnseenChangesResp', {
  changes: repeated(binary, 1),  // binary Change to allow hashing
  cursor: int(2),
});

const GetRecentChangesReq = message('GetRecentChangesReq', {
  cursor: int(1),
});

const GetRecentChangesResp = message('GetRecentChangesResp', {
  changes: repeated(binary, 1),  // binary Change to allow hashing
  cursor: int(2),
});

export {MessagePiece, Rpc, Update, Delete, Change, GetUnseenChangesReq, GetUnseenChangesResp, GetRecentChangesReq, GetRecentChangesResp};
