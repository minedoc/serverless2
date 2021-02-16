import {Database, newConnectionString} from './database.js';

async function init() {
  window.connection = newConnectionString();
  console.log(connection);
  window.db = await Database('foo', '62pZn1kyWFZkSaEvcTd-646o3N0QsE-cffRc4CaRfG');
  setInterval(() => {
    document.getElementById('out').innerText = 'foo = ' + JSON.stringify(Array.from(db.table('foo')));
  }, 1000);
}

export {init};
