import {BloomFilter} from './bloomfilter.js';

function Changes(idb) {
  const changeMap = new Map();
  const changeList = [];
  const writesToDisk = [];
  let bloomFilter;
  function saveChange(hash, change) {
    if (!changeMap.has(hash)) {
      writeToMemory(hash, change);
      writesToDisk.push({hash, change});
      return true;
    } else {
      return false;
    }
  }
  function writeToMemory(hash, change) {
    changeMap.set(hash, change);
    changeList.push(change);
    bloomFilter.add(hash);
  }
  function writeToDisk() {
    const store = idb.transaction('changes', 'readwrite').objectStore('changes');
    writesToDisk.splice(0).map(write => store.put(write));
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
        writeToMemory(row.hash, row.change);
      }
      setInterval(writeToDisk, 500);
      resolve({getBloomFilter: () => bloomFilter.binary, getMissingChanges, saveChange, changeList});
    }
  });
}

export {Changes};
