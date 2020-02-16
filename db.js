function FilterList() {
  function findPrevUp(x) {
    const parent = x.parent;
    if (parent == null) {
      return null;
    } else if (parent.left == x) {
      return findPrevUp(x.parent);
    } else if (parent.isVisible) {
      return x.parent;
    } else if (parent.left.count > 0) {
      return findPrevDown(x.parent.left);
    } else {
      return findPrevUp(x.parent);
    }
  }
  function findPrevDown(x) {
    if (x.right.count > 0) {
      return findPrevDown(x.right);
    } else if (x.isVisible) {
      return x;
    } else {
      return findPrevDown(x.left);
    }
  }
}

