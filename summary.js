// peerKeys and contentKeys are optional symmetric reader keys
// integrityKeys are asymmetric writer keys
function Channel(server, name, peerKey) {
  return {onPeer};
}

function Gossip(channel, idb, integrityKeys) {
  return {onEntry};
}

function Crdt(gossip, idb) {
  return {onChange, onDelete};
}

function Database(crdt, idb, readKey, indices) {
  return {set, merge, index, map, filter, group, sort};
}

/*
replication data model
  tree of edits, siblings have an order: [global-clock, site-id, local-clock]
    sum(sort(edits)) is actual data
    see causal lib
  operations
    createObject(table, value)
    update(op, new-value)
    addField(op, field, value)
    deleteObject(op)
    createArray(table)
    insertArray(op, value)
    deleteArray(op)
  what is an id?
    bigint - 40 / 17 / 20
    encoded as a 13 character id
  transaction - can't happen since history is not linear
    logically it's a simultaneous set of read & writes
    update([read-ops], [write-ops], [values])

actual data
  data = Map<Key, Val>
  order maintenance problem
    insertAfter(x, entry)
    find(x) - returns an iterator
    isBefore(x, y)

oneof
