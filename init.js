import {Discovery} from './discovery.js';
import {Type} from './binary.js';
import {BloomFilter} from './bloomfilter.js';
import {Stub} from './stub.js';
import {Insert, Update, Delete, Change, GetRecentChangesReq, GetRecentChangesResp, GetUnseenChangesReq, GetUnseenChangesResp} from './types.js';

async function init() {
  window.db = await Database({
    name: 'foo',
    tracker: 'wss://tracker.openwebtorrent.com',
    feed: '9aa6481d5855fae13cfe81580b2ebc36becf3d2c',
  });
}

// TODO P4: Change.write(Type(Foo, value)) -> Change.writeFoo(value)

async function Database(settings) {
  const clock = {
    global: 0,
    site: Math.floor(Math.random() * 10000),
    local: 0,
  };
  function latestTime() {
    clock.local++;
    return clock;
  }
  async function insert(table, value) {
    const clock = latestTime();
    const change = Change.write(Type(Insert, {clock, table, value}));
    const rowId = await hash(change);
    tables.set(table, rowId, clock, value);
    share.send(change);
    return rowId;
  }
  function update(table, rowId, value) {
    const clock = latestTime();
    const change = Change.write(Type(Update, {clock, table, rowId, value}));
    tables.set(table, rowId, clock, value);
    share.send(change);
  }
  function remove(table, rowId) {
    const clock = latestTime();
    const change = Change.write(Type(Delete, {clock, table, rowId}));
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
          const changes = db.createObjectStore('changes', {keyPath: 'hash', autoIncrement: false});
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const tables = await Tables(idb);
  const share = await Share(idb, Discovery(settings.tracker, settings.feed));
  share.subscribe(async (changeHash, change) => {
    if (change.clock.global >= clock.global) {
      clock.global = change.clock.global + 1;
      clock.local = 0;
    }
    if (clockLessThan(change.clock, tables.getClock(change.rowId))) {
      return;
    }
    if (change.$type == Insert) {
      tables.set(change.table, changeHash, change.clock, change.value);
    } else if (change.$type == Update) {
      tables.set(change.table, change.rowId, change.clock, change.value);
    } else if (change.$type == Delete) {
      tables.remove(change.table, change.rowId, change.clock);
    }
  });

  return {get: tables.get, getAll: tables.getAll, insert, update, remove, subscribe: share.subscribe};
}

function clockLessThan(c1, c2) {
  return c2 != undefined && (c1.global < c2.global
    || (c1.global == c2.global && (c1.site < c2.site
      || (c1.site == c2.site && c1.local < c2.local))));
}

async function Share(idb, discovery) {
  const stubs = new Map();
  const changes = await Changes(idb);
  const handler = {
    getRecentChanges: [GetRecentChangesReq, GetRecentChangesResp, req => {
      return {changes: changes.after(req.cursor), cursor: changes.cursor()};
    }],
    getUnseenChanges: [GetUnseenChangesReq, GetUnseenChangesResp, req => {
      const bloomfilter = BloomFilter(req.bloomFilter);
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
    c.map(async changeBin => {
      const changeHash = await hash(changeBin);
      if (await changes.insert(changeHash, changeBin)) {
        const change = Change.read(changeBin);
        subscribers.forEach(f => f(changeHash, change));
      }
    });
  }
  discovery.onPeer(async peer => {
    const stub = Stub(peer, handler);
    const resp = await stub.getUnseenChanges({bloomFilter: changes.bloomFilterBinary()});
    stubs.set(peer.id, Object.assign(stub, {cursor: resp.cursor}));
    processChanges(resp.changes);
  });
  discovery.onPeerDisconnect(async peer => {
    stubs.delete(peer.id);
  });
  setInterval(() => {
    stubs.forEach(async stub => {
      const resp = await stub.getRecentChanges({cursor: stub.cursor});
      stub.cursor = resp.cursor;
      processChanges(resp.changes);
    });
  }, 100000);
  return {send, subscribe}
}

function Changes(idb) {
  const changes = new Map();
  const index = [];
  let bloomFilter;
  const cursor = () => index.length;
  const after = cursor => index.slice(cursor);
  const iterate = () => changes.entries();
  async function insert(changeHash, change) {
    if (!changes.has(changeHash)) {
      insertHashed(changeHash, change);
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
      bloomFilter = BloomFilter.fromSize(req.result.length);
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
    if (!tables.has(table)) {
      tables.set(table, new Map());
    }
    return tables.get(table);
  }
  function set(table, rowId, clock, value) {
    getAll(table).set(rowId, value);
    clocks.set(rowId, clock);
    idb.transaction('tables', 'readwrite').objectStore('tables').put({id: [table, rowId], clock, value});
  }
  function remove(table, rowId, clock) {
    getAll(table).remove(rowId, clock);
    clocks.set(rowId, clock);
    idb.transaction('tables', 'readwrite').objectStore('tables').put({id: [table, rowId], clock});
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('tables', 'readonly').objectStore('tables').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      for(const row of req.result) {
        if (row.value) {
          getAll(row.id[0]).set(row.id[1], row.value);
        }
        clocks.set(row.id[1], row.clock);
      }
      resolve({get, getClock, getAll, set, remove});
    }
  });
}

async function hash(binary) {
  const hash = new Uint16Array(await crypto.subtle.digest('SHA-256', binary));
  const alphabet = '0123456789abcdefghjkmnpqrstuvwxyz';
  const base = alphabet.length;
  const out = [];
  var current = 0;
  for (var i=0; i<hash.length; i++) {
    current = current * 65536 + hash[i];
    const octet = [];
    while (current >= base) {
      const remainder = current % base;
      octet.push(alphabet[remainder]);
      current = (current - remainder) / base;
    }
    out.push(octet);
  }
  out[out.length-1].push(alphabet[current]);
  return out.flatMap(x => x.reverse()).join('');
}

export {init};
