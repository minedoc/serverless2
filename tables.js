import {clockLessThan, checkSimpleValue} from './util.js';

function Tables(idb, frozen, validate) {
  const tables = new Map();
  const clocks = new Map();
  const writes = [];

  const coolant = {
    get: (x, f) => typeof x[f] === 'object' ? freeze(x[f]) : x[f],
    set: x => {throw 'Rows are immutable, use table.update to change them'},
  };
  const freeze = frozen ? x => new Proxy(x, coolant) : x => x;
  const validator = validate ? checkSimpleValue : x => x;

  function getTable(table) {
    if (!tables.has(table)) {
      tables.set(table, new Map());
    }
    return tables.get(table);
  }
  function persist() {
    const store = idb.transaction('tables', 'readwrite').objectStore('tables');
    writes.splice(0).map(write => {
      store.get(write.id).onsuccess = fetch => {
        if (fetch.result == undefined || clockLessThan(fetch.result.clock, clock)) {
          store.put(write);
        }
      };
    });
  }
  function setValue(table, rowId, clock, value) {
    if (!clocks.has(rowId) || clockLessThan(clocks.get(rowId), clock)) {
      getTable(table).set(rowId, validator(freeze(value)));
      clocks.set(rowId, clock);
      writes.push({id: [table, rowId], clock, value});
    }
  }
  function removeRow(table, rowId, clock) {
    if (!clocks.has(rowId) || clockLessThan(clocks.get(rowId), clock)) {
      getTable(table).delete(rowId, clock);
      clocks.set(rowId, clock);
      writes.push({id: [table, rowId], clock, removed: true});
    }
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('tables', 'readonly').objectStore('tables').getAll();
    let maxClock = {
      global: 0,
      site: Math.floor(Math.random() * 10000),
      local: 0,
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      for(const row of req.result) {
        const [table, rowId] = row.id;
        if (!row.removed) {
          getTable(table).set(rowId, freeze(row.value));
        }
        clocks.set(rowId, row.clock);
        if (maxClock.global <= row.clock.global) {
<<<<<<< HEAD
          maxClock.global = row.clock.global + 1;
=======
          maxClock = row.clock.global + 1;
>>>>>>> f971750963211157ada983bc0830ac466af91cf8
        }
      }
      setInterval(persist, 500);
      resolve([{getTable, setValue, removeRow}, maxClock]);
    }
  });
}

export {Tables};
