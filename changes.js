import {BloomFilter} from './bloomfilter.js';

function Changes(idb) {
  const changeMap = new Map();
  const changeList = [];
  const writes = [];
  let bloomFilter;
  function addLocal(hash, change) {
    changeMap.set(hash, change);
    changeList.push(change);
    bloomFilter.add(hash);
  }
  function addChange(hash, change) {
    if (!changeMap.has(hash)) {
      addLocal(hash, change);
      writes.push({hash, change});
      return true;
    } else {
      return false;
    }
  }
  function persist() {
    const store = idb.transaction('changes', 'readwrite').objectStore('changes');
    writes.splice(0).map(write => store.put(write));
  }
  function getMissingChanges(other) {
    const bloomfilter = BloomFilter(new Uint8Array(other));
    const missing = [];
    for (const [hash, change] of changeMap.entries()) {
      if (!bloomfilter.has(hash)) {
        missing.push(change);
      }
    }
    return missing;
  }
  return new Promise((resolve, reject) => {
    const req = idb.transaction('changes', 'readonly').objectStore('changes').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      bloomFilter = BloomFilter.fromSize(req.result.length);
      for(const row of req.result) {
        addLocal(row.hash, row.change);
      }
      setInterval(persist, 500);
      resolve({getBloomFilter: () => bloomFilter.binary, getMissingChanges, addChange, changeList});
    }
  });
}

export {Changes};
