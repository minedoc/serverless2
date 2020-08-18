function DbOrderedForest(comparator) {
  const items = DbList(); // DbList<editId, {rootId, parentId, childs, edit, clock}>
  // TODO: must handle multiple lists!
  function insert(id, value, parentId) {
    if (parentId == null) {
      items.insertBefore(id, value, null);
      return 0;
    } else {
      const parent = items.get(parentId);
      const childId = smallestBigger(parent.childs, value, comparator);
      const index = items.insertBefore(id, value, childId);
      return index;
    }
  }
  return {has: items.has, get: items.get, insert};
}

function DbList() {
  // list with efficient middle insertion, and counting
  const map = DbMap();
  const tree = OrderedTree(map.size());
  var ptr = map.get('$HEAD');
  while (ptr != '') {
    const item = map.get(ptr);
    tree.insert(item.value);
    ptr = item.next;
  }
  function get(id) {
    return map.get(id).value;
  }
  function insertBefore(id, value, nextId) {
    const [prevId, prev] = map.getByNext(nextId);
    map.set(id, {next: nextId, value });
    map.set(prevId, {next: id, value: prev.value});
    tree.insertBefore(id, prevId);
  }
  function index(id) {
    tree.index(id);
  }
}
