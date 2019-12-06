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

function Database(crdt, idb, contentKey, indices) {
  return {set, merge, index, map, filter, group, sort};
}

/*
data structure
data = Map<Key, Val>
  update by linking to the operation (not the Key!)
  Key: Array<Int|Str>
  Value: JSON

virtual fields - not stored in any thing
order maintenance problem
  insert(after=x, value=y)
  isBefore(x, y)


operation = {
  method: String,
  data: Repeated(JSON),
  input: Ref,
  output: Ref,
}

indices = {
  string: {
    index(value, key) {
      return key.startsWith('string:') ? [key.substr(10)] : [];
    },
    map
