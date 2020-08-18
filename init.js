import {Discovery} from './discovery.js';
import {Insert, Update, Delete, GetRecentChangesReq, GetRecentChangesResp, GetUnseenChangesReq, GetUnseenChangesResp} from './types.js';
import {BloomFilter} from './util.js';

async function init() {
  window.db = await Database({
    name: 'foo',
    tracker: 'wss://tracker.openwebtorrent.com',
    feed: '9aa6481d5855fae13cfe81580b2ebc36becf3d2c',
  });
}

async function Database(settings) {
  function insert(table, value) {
    const clock = getLatestTime();
    const change = Insert.write({clock, table, value});
    const rowId = hash(change);
    tables.set(table, rowId, value, clock);
    share.send(change);
    return rowId;
  }
  function update(table, rowId, value) {
    const clock = getLatestTime();
    const change = Update.write({clock, table, rowId, value});
    tables.set(table, rowId, value, clock);
    share.send(change);
  }
  function remove(table, rowId) {
    const clock = getLatestTime();
    const change = Delete.write({clock, table, rowId});
    tables.remove(table, rowId, clock);
    share.send(change);
  }

  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(settings.name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      switch (event.oldVersion) {
        case 0:
          const tables = db.createObjectStore('tables', {keyPath: 'id', autoIncrement: false});
          const changes = db.createObjectStore('changes', {keypath: 'hash', autoIncrement: false});
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const tables = await Tables(idb);
  const share = await Share(idb, Discovery(settings.tracker, settings.feed));
  share.subscribe(change => {
    if (change.$type == Insert) {
      tables.set(change.table, hash(change), change.value);
    } else if (change.$type == Update) {
      if (change.getClock(change.rowId) < change.clock) {
        tables.set(change.table, change.rowId, change.value, change.clock);
      }
    } else if (change.$type == Delete) {
      tables.remove(change.table, change.rowId, change.clock);
    }
  });

  return {get: tables.get, getAll: tables.getAll, insert, update, remove, subscribe: share.subscribe};
}

async function Share(idb, discovery) {
  const stubs = new Map();
  const changes = await Changes(idb);
  const handler = {
    getRecentChanges: [GetRecentChangesReq, GetRecentChangesResp, req => {
      return {changes: changes.after(req.cursor), cursor: changes.cursor()};
    }],
    getUnseenChanges: [GetUnseenChangesReq, GetUnseenChangesResp, req => {
      const bloomfilter = BloomFilter(req.bloomfilter);
      const missing = [];
      for (const [hash, change] of changes.iterate()) {
        if (!bloomfilter.has(hash)) {
          missing.push(change);
        }
      }
      return {changes: missing, cursor: changes.cursor()};
    }],
  };
  const send = change => processChanges([change]);
  const subscribers = [];
  const subscribe = fn => subscribers.push(fn);
  function processChanges(c) {
    c.map(change => {
      if (changes.insert(change)) {
        subscribers.forEach(f => f(change));
      }
    });
  }
  discovery.onPeer(async peer => {
    const stub = Stub(peer, handler);
    const resp = await stub.getUnseenChanges({bloomfilter: changes.bloomFilterBinary()});
    stubs.set(peer.id, {stub, cursor: resp.cursor});
    processChanges(resp.changes);
  });
  setInterval(() => {
    stubs.forEach(async stub => {
      const resp = await stub.getRecentChanges(stub.cursor);
      stub.cursor = resp.cursor;
      processChanges(resp.changes);
    });
  }, 1000);
  return {send, subscribe}
}

function Changes(idb) {
  const changes = new Map();
  const index = [];
  let bloomFilter;
  const cursor = () => index.length;
  const after = cursor => index.slice(cursor);
  const iterate = () => changes.entries();
  function insert(change) {
    const id = hash(change);
    if (!changes.has(id)) {
      insertHashed(id, change);
      return true;
    } else {
      return false;
    }
  }
  function insertHashed(hash, change) {
    changes.set(hash, change);
    index.push(change);
    bloomFilter.add(hash);
    idb.transaction('changes', 'readwrite').objectStore('changes').put({hash, change});
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('changes', 'readonly').objectStore('changes').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      bloomFilter = BloomFilter(req.result.length, 0.0000001);
      for(const row of req.result) {
        insertHashed(row.hash, row.change);
      }
      resolve({bloomFilterBinary: bloomFilter.toBinary, insert, cursor, after, iterate});
    }
  });
}

// todo: batch writes
function Tables(idb) {
  const tables = new Map();
  const clocks = new Map();

  const get = (table, rowId) => getAll(table).get(rowId);
  const getClock = rowId => clocks.get(rowId);
  function getAll(table) {
    if (!tables.contains(table)) {
      tables.set(table, new Map());
    }
    return tables.get(table);
  }
  function set(table, rowId, clock, value) {
    getAll(row.table).put(rowId, value);
    clocks.put(rowId, clock);
    idb.transaction('tables', 'readwrite').objectStore('tables').put({id: [table, rowId], clock, value});
  }
  function remove(table, rowId, clock) {
    getAll(row.table).remove(rowId, clock);
    clocks.put(rowId, clock);
    idb.transaction('tables', 'readwrite').objectStore('tables').put({id: [table, rowId], clock});
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('tables', 'readonly').objectStore('tables').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      for(const row of req.result) {
        if (row.value) {
          getAll(row.id[0]).put(row.id[1], row.value);
        }
        clocks.put(row.id[1], row.clock);
      }
      resolve({get, getClock, getAll, set, remove});
    }
  });
}

export {init};
