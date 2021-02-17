import {Database, newConnectionString} from './database.js';

async function init() {
  window.db = await Database('foo', '62pZn1kyWFZkSaEvcTd-646o3N0QsE-cffRc4CaRfG');  // newConnectionString()
  setInterval(() => {
    document.getElementById('out').innerText = (
      'foo = ' + JSON.stringify(Array.from(db.table('foo'))) + '\n' +
      'connectivity = ' + db.connectivity().toString() + '\n' +
      'state = ' + db.state().toString() + '\n'
    );
  }, 1000);
}

export {init};
