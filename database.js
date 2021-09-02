import {Changes} from './changes.js';
import {Share} from './share.js';
import {Update, Delete, Change} from './types.js';
import {base64Decode, base64Encode, checkSimpleValue, clockLessThan, DefaultMap, freeze, randomChars, randomId} from './util.js';

function newConnectionString(settings) {
  return (
    randomChars(20) +  // feed
    base64Encode(window.crypto.getRandomValues(new Uint8Array(16)))  // readKey 16 or 32
  );
}

async function Database(name, connection, settings={}) {
  const feed = connection.substr(0, 20);
  const readKey = await window.crypto.subtle.importKey('raw', base64Decode(connection.substr(20)), {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
  const {
    tracker = 'wss://tracker.openwebtorrent.com',
    onConflict = x => console.log('conflict found', x),
  } = settings;
  const idb = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      switch (event.oldVersion) {
        case 0:
          db.createObjectStore('tables', {keyPath: 'id', autoIncrement: false});
          db.createObjectStore('changes', {keyPath: 'hash', autoIncrement: false});
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const writes = [];
  const maxClock = {
    global: 0,
    site: Math.floor(Math.random() * 999999),
    local: 0,
  };
  const tables = new DefaultMap(x => new Map());
  const clocks = new DefaultMap(x => new Map());
  const forward = new DefaultMap(x => new Set());
  await new Promise((resolve, reject) => {
    const req = idb.transaction('tables', 'readonly').objectStore('tables').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      for(const row of req.result) {
        const [table, rowId] = row.id;
        if (!row.removed) {
          tables.get(table).set(rowId, freeze(row.value));
        }
        clocks.get(table).set(rowId, row.clock);
        bumpMaxClock(row);
      }
      resolve();
    }
  });
  setInterval(() => {
    const store = idb.transaction('tables', 'readwrite').objectStore('tables');
    for (const write of writes.splice(0)) {
      store.get(write.id).onsuccess = fetch => {
        if (fetch.result == undefined || clockLessThan(fetch.result.clock, write.clock)) {
          store.put(write);
        }
      };
    }
  }, 500);
  const changes = await Changes(idb);
  const share = await Share(changes, tracker, feed, readKey, onChange, onConflict);

  function bumpMaxClock(change) {
    if (maxClock.global <= change.clock.global) {
      maxClock.global = change.clock.global + 1;
      maxClock.local = 0;
    }
  }

  function onChange(change, remote) {
    if (remote) { bumpMaxClock(change); }
    const {table, rowId, clock} = change;
    if (clockLessThan(clocks.get(table).get(rowId), clock)) {
      clocks.get(table).set(rowId, clock);
      if (change.$type == Update) {
        const value = freeze(change.value);
        tables.get(table).set(rowId, value);
        for (const map of forward.get(table)) {
          map.set(rowId, value);
        }
        writes.push({id: [table, rowId], clock, value});
      } else if (change.$type == Delete) {
        tables.get(table).delete(rowId);
        for (const map of forward.get(table)) {
          map.delete(rowId);
        }
        writes.push({id: [table, rowId], clock, removed: true});
      }
    }
  }

  function makeEdit(editType, edit) {
    maxClock.local++;
    return Change.write(editType.wrap({clock: {...maxClock}, ...edit}));
  }

  const tableCache = new DefaultMap(table => {
    const data = tables.get(table);
    function Table() {
      this.table = table;
    }
    Table.prototype.get = key => data.get(key);
    Table.prototype.has = key => data.has(key);
    Table.prototype.keys = x => data.keys();
    Table.prototype.size = x => data.size();
    Table.prototype.values = x => data.values();
    Table.prototype.entries = Table.prototype[Symbol.iterator] = x => data.entries();
    Table.prototype.forEach = (callback, thisArg) => data.forEach(callback, thisArg);
    Table.prototype.insert = value => {
      checkSimpleValue(value);
      const rowId = randomId();
      share.saveLocalChange(makeEdit(Update, {table, rowId, value}));
      return {rowId, value};
    };
    Table.prototype.update = (rowId, value) => {
      checkSimpleValue(value);
      share.saveLocalChange(makeEdit(Update, {table, rowId, value}));
      return {rowId, value};
    };
    Table.prototype.delete = rowId => {
      const value = data.get(rowId);
      share.saveLocalChange(makeEdit(Delete, {table, rowId}));
      return {rowId, value};
    };
    Table.prototype.forward = map => {
      forward.get(table).add(map);
      for (const [key, value] of data) {
        map.set(key, value);
      }
    };
    Table.prototype.unforward = map => {
      forward.get(table).delete(map);
    };
    return new Table();
  });

  function state() {
    return changes.changeList.length > 0 ? 'nonempty' : 'empty';
  }

  return {table: name => tableCache.get(name), state, peerCount: share.peerCount };
}

export {Database, newConnectionString};
