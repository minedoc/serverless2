import {Discovery} from './discovery.js';
import {Stub} from './stub.js';
import {Change, GetRecentChangesReq, GetRecentChangesResp, GetUnseenChangesReq, GetUnseenChangesResp} from './types.js';
import {base64Encode, promiseFn, join, clockLessThan} from './util.js';

async function Share(changes, tracker, feed, readKey, onChange, onConflict) {
  const stubs = new Map();
  async function saveLocalChange(change) {
    const hash = base64Encode(await crypto.subtle.digest('SHA-256', change));
    changes.saveChange({hash, change, local: true});
  }
  async function applyRemoteChange(change) {
    const hash = base64Encode(await crypto.subtle.digest('SHA-256', change));
    if (changes.saveChange({hash, change, local: false})) {
      onChange(hash, Change.read(change));
    }
  }
  function byRowId(changes) {
    const map = new Map();
    for (const c of changes) {
      if (!map.has(c.rowId) || clockLessThan(map.get(c.rowId).clock, c.clock)) {
        map.set(c.rowId, c);
      }
    }
    return map;
  }
  function ChangeConflict() {
    const [$local, fromLocal] = promiseFn();
    const [$remote, fromRemote]  = promiseFn();
    (async function() {
      const locals = (await $local).map(blob => Change.read(blob.change));
      const remotes = (await $remote).map(change => Change.read(change));
      const conflicts = [];
      join(byRowId(locals), byRowId(remotes), (local, remote) => {
        if (clockLessThan(local.clock, remote.clock)) {
          conflicts.push(local);
        }
      });
      conflicts.map(conflict => onConflict(conflict));
    } ());
    return {fromLocal, fromRemote};
  }
  async function withStubLocked(stub, action) {
    if (!stub.syncing) {
      stub.syncing = true;
      await action();
      stub.syncing = false;
    }
  }
  const discovery = Discovery(tracker, feed, async peer => {
    const changeConflict = ChangeConflict();
    const stub = await Stub(peer, readKey, {
      getRecentChanges: [GetRecentChangesReq, GetRecentChangesResp, req => {
        return {
          changes: changes.changeList.slice(req.cursor).map(b => b.change),
          cursor: changes.changeList.length
        };
      }],
      getUnseenChanges: [GetUnseenChangesReq, GetUnseenChangesResp, req => {
        const missing = changes.getMissingChanges(req.bloomFilter);
        changeConflict.fromLocal(missing.filter(blob => blob.local));
        return {
          changes: missing.map(blob => blob.change),
          cursor: changes.changeList.length
        };
      }],
    });
    withStubLocked(stub, async () => {
      stubs.set(peer.id, stub);
      const resp = await stub.getUnseenChanges({bloomFilter: changes.getBloomFilter()});
      changeConflict.fromRemote(resp.changes);
      stub.cursor = resp.cursor;
      resp.changes.map(change => applyRemoteChange(change));
    });
  }, peer => {
    stubs.delete(peer.id);
  });
  setInterval(() => {
    for (const [peerId, stub] of stubs) {
      withStubLocked(stub, async () => {
        const resp = await stub.getRecentChanges({cursor: stub.cursor});
        stub.cursor = resp.cursor;
        resp.changes.map(change => applyRemoteChange(change));
      });
    }
  }, 1*1000);
  return {saveLocalChange, peerCount: discovery.peerCount}
}

export {Share};
