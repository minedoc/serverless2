import {BloomFilter} from './bloomfilter.js';

// Blob {hash, change, local}

function Changes(idb) {
  const changeMap = new Map();
  const changeList = [];
  let writeCursor = 0;
  let bloomFilter;
  let flushInterval;
  function saveChange(blob) {
    if (!changeMap.has(blob.hash)) {
      changeMap.set(blob.hash, blob);
      changeList.push(blob);
      bloomFilter.add(blob.hash);
      return true;
    } else {
      return false;
    }
  }
  function flush() {
    if (writeCursor == changeList.length) {
      return;
    }
    const store = idb.transaction('changes', 'readwrite').objectStore('changes');
    for (; writeCursor<changeList.length; writeCursor++) {
      store.put(changeList[writeCursor]);
    }
  }
  function getMissingChanges(other) {
    const bloomfilter = BloomFilter(new Uint8Array(other));
    const missing = [];
    for (const [hash, blob] of changeMap.entries()) {
      if (!bloomfilter.has(hash)) {
        missing.push(blob);
      }
    }
    return missing;
  }
  function close() {
    clearInterval(flushInterval);
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('changes', 'readonly').objectStore('changes').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      bloomFilter = BloomFilter.fromSize(req.result.length);
      for(const row of req.result) {
        saveChange({hash: row.hash, change: row.change, local: row.local});
      }
      writeCursor = changeList.length;
      flushInterval = setInterval(flush, 500);
      resolve({getBloomFilter: () => bloomFilter.binary, getMissingChanges, saveChange, changeList, close});
    }
  });
}

export {Changes};
