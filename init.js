import {Database, newConnectionString} from './database.js';

async function init() {
  window.connection = newConnectionString();
  console.log(connection);
  window.db = await Database('foo', '62pZn1kyWFZkSaEvcTd-646o3N0QsE-cffRc4CaRfG');
}

export {init};
