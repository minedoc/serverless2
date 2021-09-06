import {message, repeated, string, json, binary, uint32, oneof} from './binary.js';

const MessagePiece = message('MessagePiece', {
  messageId: uint32(1),
  piece: uint32(2),
  pieceCount: uint32(3),
  payload: binary(4)
});

const Rpc = message('Rpc', {
  type: uint32(1),
  id: uint32(2),
  method: string(3),
  payload: binary(4),
});
Rpc.REQUEST = 1;
Rpc.RESPONSE = 2;

const Clock = message('Clock', {
  global: uint32(1),
  site: uint32(2),
  local: uint32(3),
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
  cursor: uint32(2),
});

const GetRecentChangesReq = message('GetRecentChangesReq', {
  cursor: uint32(1),
});

const GetRecentChangesResp = message('GetRecentChangesResp', {
  changes: repeated(binary, 1),  // binary Change to allow hashing
  cursor: uint32(2),
});

const Backup = message('Backup', {
  connection: string(1),
  changes: repeated(binary, 2),
});

export {MessagePiece, Rpc, Update, Delete, Change, GetUnseenChangesReq, GetUnseenChangesResp, GetRecentChangesReq, GetRecentChangesResp, Backup};
