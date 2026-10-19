# Raster cache: drawings, graded photos and backgrounds depend only on their inputs, so they are
# kept in $KPGEN_BUILD/cache between runs (keyed by arguments and asset size/mtime).
import hashlib, json, os, struct
from . import raster as R

VERSION = 'kpgen-2'


class Cache:
    def __init__(self, root):
        self.dir = os.path.join(root, 'cache') if root else None
        self.mem = {}
        if self.dir: os.makedirs(self.dir, exist_ok=True)

    @staticmethod
    def _part(a):
        if isinstance(a, (bytes, bytearray)): return 'sha1:' + hashlib.sha1(a).hexdigest()
        return repr(a)

    def get(self, kind, fn, args, assets=()):
        st = []
        for a in assets:
            try: s = os.stat(R.asset(a)); st.append((a, s.st_size, s.st_mtime_ns))
            except OSError: st.append((a, None, None))
        key = hashlib.sha1(repr((VERSION, kind, [self._part(a) for a in args], st)).encode()).hexdigest()
        if key in self.mem: return self.mem[key]
        path = os.path.join(self.dir, f'{kind}_{key}.bin') if self.dir else None
        data = None
        if path and os.path.exists(path):
            try: data = self._read(path)
            except (OSError, ValueError, struct.error): data = None
        if data is None:
            data = fn(*args)
            if path: self._write(path, data)
        self.mem[key] = data
        return data

    # file = 4-byte length + JSON metadata (or null) + raw bytes; values are bytes or (bytes, metadata)
    @staticmethod
    def _write(path, data):
        raw, meta = (data, None) if isinstance(data, (bytes, bytearray)) else data
        head = json.dumps(meta).encode()
        tmp = f'{path}.{os.getpid()}.tmp'
        with open(tmp, 'wb') as f: f.write(struct.pack('>I', len(head)) + head + raw)
        os.replace(tmp, path)

    @staticmethod
    def _read(path):
        with open(path, 'rb') as f: b = f.read()
        n = struct.unpack('>I', b[:4])[0]
        meta = json.loads(b[4:4 + n]); raw = b[4 + n:]
        return raw if meta is None else (raw, meta)
