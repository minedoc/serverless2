self.onconnect = event => {
  const port = event.ports[0];
  port.onmessage = event => {
  };
  const req = indexedDB.open('test', 1);
  req.onsuccess = event => {
    const db = req.result;
    const store = db.transaction('store', 'readonly').objectStore('store');
    const read = store.get('hi');
    read.onsuccess = event => port.postMessage(event.target.result);
  };
};
