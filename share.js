import {Changes} from './changes.js';
import {Discovery} from './discovery.js';
import {Stub} from './stub.js';
import {Change, GetRecentChangesReq, GetRecentChangesResp, GetUnseenChangesReq, GetUnseenChangesResp} from './types.js';
import {hashBin} from './util.js';

async function Share(idb, settings, onChange) {
  const stubs = new Map();
  const changes = await Changes(idb);
  async function sendChange(changeBin) {
    const hash = await hashBin(changeBin);
    changes.addChange(hash, changeBin);
  }
  function processChanges(c) {
    c.map(async changeBin => {
      const hash = await hashBin(changeBin);
      if (changes.addChange(hash, changeBin)) {
        onChange(hash, Change.read(changeBin));
      }
    });
  }
  const discovery = Discovery(settings.tracker, settings.feed, async peer => {
    const stub = await Stub(peer, settings.readKey, {
      getRecentChanges: [GetRecentChangesReq, GetRecentChangesResp, req => {
        return {changes: changes.changeList.slice(req.cursor), cursor: changes.changeList.length};
      }],
      getUnseenChanges: [GetUnseenChangesReq, GetUnseenChangesResp, req => {
        return {changes: changes.getMissingChanges(req.bloomFilter), cursor: changes.changeList.length};
      }],
    });
    stubs.set(peer.id, stub);
    const resp = await stub.getUnseenChanges({bloomFilter: changes.getBloomFilter()});
    stub.cursor = resp.cursor;
    processChanges(resp.changes);
  }, peer => {
    stubs.delete(peer.id);
  });
  setInterval(() => {
    stubs.forEach(async stub => {
      const resp = await stub.getRecentChanges({cursor: stub.cursor});
      stub.cursor = resp.cursor;
      processChanges(resp.changes);
    });
  }, 1*1000);
  return {sendChange}
}

export {Share};
