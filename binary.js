const MESSAGE_END = 0;
const ANY_FIELD = '$any';
const proto = (proto) => Object.assign((id) => Object.assign(Object.create(proto), {id}), proto);
const registry = new Map();
const utf8encoder = new TextEncoder('utf-8');
const utf8decoder = new TextDecoder('utf-8');
const utf8encode = x => utf8encoder.encode(x);
const utf8decode = x => utf8decoder.decode(x);
const isNumber = x => typeof x == 'number';
const isBool = x => typeof x == 'boolean';
const int = spaceDelimited(isNumber, x => throwNaN(parseInt(x, 10), x), x => Math.trunc(x).toString(10));
const float = spaceDelimited(isNumber, x => throwNaN(parseFloat(x), x), x => x.toString(10));
const bool = spaceDelimited(isBool, x => x == 't', x => x ? 't' : 'f');
const id = x => x;
const binary = measured(x => x instanceof Uint8Array, 'Uint8Array', id, id);
const string = measured(x => typeof x == 'string', 'string', utf8decode, utf8encode);
const space = Uint8Array.of(32);

function throwNaN(val, orig) {
  if (Number.isNaN(val)) { throw 'expected number, got: ' + orig + ' => ' + val; }
  return val;
}

function write(val) {
  const result = new Uint8Array(this.writeTo(val, null, 0));
  this.writeTo(val, result, 0);
  return result;
}

function read(bytes) {
  if (!(bytes instanceof Uint8Array)) { throw 'expected bytes, got: ' + JSON.stringify(bytes) }
  return this.readFrom(bytes, 0)[0];
}

function writeTo(bytes, extra, offset) {
  if (bytes) {
    bytes.set(extra, offset);
  }
  return offset + extra.byteLength;
}

function spaceDelimited(check, fromStr, toStr) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const end = bytes.indexOf(32, offset + 1);
      if (end == -1) { throw 'not terminated with space'; }
      return [fromStr(utf8decode(bytes.slice(offset, end))), end + 1];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' wrong type'; }
      return writeTo(bytes, utf8encode(toStr(val) + ' '), offset);
    },
  });
}

function measured(check, typeName, fromBytes, toBytes) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [len, end] = int.readFrom(bytes, offset);
      return [fromBytes(bytes.slice(end, end + len)), end + len + 1];
    },
    writeTo(val, bytes, offset, path='') {
      if (!check(val)) { throw path + ' wrong type - expected: ' + typeName; }
      offset = int.writeTo(val.length, bytes, offset, 'internal');
      offset = writeTo(bytes, toBytes(val), offset);
      return writeTo(bytes, space, offset);
    },
  });
}

function message(name, fields) {
  const fieldById = new Map();
  for (const [name, field] of Object.entries(fields)) {
    if (fieldById.has(field.id) || field.id <= 0) { throw 'invalid id ' + name + ' ' + field.id; }
    field.name = name;
    fieldById.set(field.id, field);
  }
  const message = proto({
    write, read,
    readFrom(bytes, offset) {
      var result = {}, id, field;
      while (offset < bytes.byteLength) {
        [id, offset] = int.readFrom(bytes, offset);
        if (id == MESSAGE_END) {
          return [result, offset];
        } else if (field = fieldById.get(id)) {
          [result[field.name], offset] = field.readFrom(bytes, offset);
        }
      }
      throw 'message did not terminate';
    },
    writeTo(val, bytes, offset, path=name) {
      for (const [name, field] of Object.entries(val)) {
        if (name == ANY_FIELD) { continue; }
        if (!fields.hasOwnProperty(name)) { throw path + ' unknown field: ' + name; }
        offset = int.writeTo(fields[name].id, bytes, offset, 'internal');
        offset = fields[name].writeTo(val[name], bytes, offset, path + '.' + name);
      }
      return int.writeTo(MESSAGE_END, bytes, offset, 'internal');
    },
  });
  registry.set(name, message);
  return message;
}

function repeated(field, id) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      var result = [], count, val;
      [count, offset] = int.readFrom(bytes, offset);
      for (var i = 0; i < count; i++) {
        if (offset >= bytes.byteLength) { throw 'repeated did not terminate'; }
        [val, offset] = field.readFrom(bytes, offset);
        result.push(val);
      }
      return [result, offset];
    },
    writeTo(val, bytes, offset, path='') {
      offset = int.writeTo(val.length, bytes, offset, 'internal');
      for (var i = 0; i < val.length; i++) {
        offset = field.writeTo(val[i], bytes, offset, path + '.' + i.toString());
      }
      return offset;
    },
  })(id);
}

function any(id) {
  return proto({
    write, read,
    readFrom(bytes, offset) {
      const [name, end] = string.readFrom(bytes, offset);
      if (!registry.has(name)) { throw 'unknown any: ' + name; }
      const [obj, end2] = registry.get(name).readFrom(bytes, end);
      return [Any(name, obj), end2];
    },
    writeTo(val, bytes, offset, path='') {
      if (!val[ANY_FIELD]) { throw path + ' must be wrapped with Any'; }
      offset = string.writeTo(val[ANY_FIELD], bytes, offset, 'internal');
      return registry.get(val[ANY_FIELD]).writeTo(val, bytes, offset, path);
    },
  })(id);
}

function Any(name, val) {
  return Object.assign(Object.create({[ANY_FIELD]: name}), val);
}

export {message, any, Any, repeated, string, binary, int, float, bool};
