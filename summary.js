function Discovery(server, name) {
  return {onPeer};
}

function Gossip(discovery) {
  const peers = new Map();
  const seen = new Map();
  const entryWatcher = new Observer();
  const serverDefinition = {
    push: [PushRequest, PushResponse, req => {
      if (!seen.has(req.entry)) {
        entryWatcher.notify(req.entry);
        seen.set(req.entry, 1);
      }
    }],
  };
  discovery.onPeer(peer => {
    peers.set(peer.id, peer);
    peer.serve(serverDefinition);
    peer.pushClient = peer.client(serverDefinition);
  });
  const sendEntry = entry => {
    for (peer of peers) {
      peer.pushClient.push(entry);
    }
  }
  return {onEntry: entryWatcher.watch, sendEntry};
}

Id = PackedNumber({
  clock: PackedNumber.Field(1, 40),
  site: PackedNumber.Field(2, 17),
  local: PackedNumber.Field(3, 20),
})
Create = Struct({
  table: String(),
  value: JsonBlob(),
  after: Id(),
})
Delete = Struct({
  target: Id(),
})
Update = Struct({
  target: Id(),
  value: JsonBlob(),
})
Entry = Struct({
  id: Id(1),
  op: OneOf(2, [Create, Delete, Update])
})

function update(obj, path, value) {
  var cursor = obj;
  for (const path of field.path.slice(0, -1)) {
    if (!(cursor[path] instanceof Object)) {
      cursor[path] = {};
    }
    cursor = cursor[path];
  }
  cursor[field.path[field.path.length - 1]] = value;
  return obj;
}

function CrdtTable(idb, table) {
  return {get, getVersions, getAll, watch, update, delete};
}

function Crdt(gossip, idb) {
  const tables = new DefaultMap(table => CrdtTable(idb, table));
  const entries = new Map();
  gossip.onEntry(entry => {
    const op = entry.op;
    if (op.$type == Create) {
      const table = tables.get(entry.table);
      table.insert(entry.id, op.value, op.after);
    } else if (op.$type == Update) {
      const table = tables.getByRow(op.target);
      const obj = table.get(op.target);
      const versions = table.getVersions(op.target);
      for(const [field, value] of fields(op.value)) {
        if (versions[field.name] < entry.id) {
          versions[field.name] = entry.id;
          obj = update(obj, field.path, value);
        }
      }
      table.update(op.target, obj);
      table.setVersions(op.target, versions);
    } else if (op.$type == Delete) {
      const table = tables.getByRow(op.target);
      table.delete(op.target);
    }
  });
  return {table: tables.get};
}

function Database(crdt, idb, indices) {
  return {set, merge, index, map, filter, group, sort, insert, update, delete};
}

Database(Crdt(Gossip(Discovery(server, name)), idb), indexIdb, {index});

/*
replication data model
  how are arrays represented
    explicit
      crdt maintains order
      getAll returns [...] with ordering applied
      watch insert events have a position
      trivial to prepend list, but append is difficult?
    independent (discarded)
      $ordering sortable string
      $ordering comparable object (hash lookup into tree walk)

encryption - do later!
  peerKey: talk to peers - Discovery
  integrityKeys: sign content - Gossip
  readKey: decrypt contents - Crdt

out of scope
  moves: don't care
  transaction:
    can't happen since history is not linear
    can master elect, but master cant guarantee know everything (what if ignored?)
    would need update([read-ops], [write-ops], [values])
