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
  tree of edits
    siblings have an order: [global-clock, site-id, local-clock]
      sum(sort(edits)) is actual data
      see causal lib
    operations
      createRow(table, value)
        id = order?
      update(op, new-value)
      addField(op, field, value)
      deleteRow(op)
    transaction - can't happen since history is not linear
      logically it's a simultaneous set of read & writes
      update([read-ops], [write-ops], [values])

fake-proto
  oneof(A, B, C)

actual data
  data = Map<Key, Val>
    update by linking to the most recent operation (dont need key)
    Key: Array<Int|Str>
    Value: Object
  virtual fields - local use only (for comparison)
    not necessary maybe
  order maintenance problem
    insertAfter(x, entry)
    find(x) - returns an iterator
    isBefore(x, y)

mvcc vs ot (leader)
  both these require a long lived head
  if head is missing nobody can write?
  dropping writes is acceptable for out of sync client
  mvcc
    shard state into versioned pieces
    detect remote != local for the important state
    track reads and writes
    writes clobber value
    example bank transfer: read A, B; set A = 5, B = 6
    client retries with newer state
    complex if read set is query result
    any data structure can be represented this way
      how to avoid high locking..
  operational transform
    value with higher operational semantics
    make operations transform
    example bank transfer: transfer $ from A to B
    server changes the ops (what if op fail)


operation = {
  method: String,
  id: String, table?
  data: JSON,
  input: Ref,
  output: Ref,
}

indices = {
  string: {
    index(value, key) {
      return key.startsWith('string:') ? [key.substr(10)] : [];
    },
    map
