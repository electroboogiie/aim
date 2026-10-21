# Читання таблиць для імпорту матеріалів і цін: XLSX (zip + XML) і CSV, лише стандартна бібліотека Python.
#   read_table(name, data) -> [{'name': аркуш, 'rows': [[клітинка, ...], ...]}]
import csv, io, re, zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'
MAX_ROWS = 20000
MAX_COLS = 60


def _col(ref):
    """'BC12' -> 54 (0-based column of a cell reference)."""
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1


def _num(v):
    try:
        f = float(v)
    except ValueError:
        return v
    return int(f) if f.is_integer() and abs(f) < 1e15 else round(f, 6)


def read_xlsx(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    shared = []
    if 'xl/sharedStrings.xml' in names:
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {}
    if 'xl/_rels/workbook.xml.rels' in names:
        for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')).iter(REL):
            t = r.get('Target', '')
            rels[r.get('Id')] = t.lstrip('/') if t.startswith('/') else 'xl/' + t
    out = []
    for sh in wb.findall('m:sheets/m:sheet', NS):
        path = rels.get(sh.get('{%s}id' % NS['r']))
        if not path or path not in names: continue
        rows = []
        for row in ET.fromstring(z.read(path)).iter('{%s}row' % NS['m']):
            if len(rows) >= MAX_ROWS: break
            cells = {}
            for c in row.findall('m:c', NS):
                ref, t = c.get('r'), c.get('t')
                v = c.find('m:v', NS)
                if t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                elif v is None or v.text is None:
                    continue
                elif t == 's':
                    val = shared[int(v.text)] if int(v.text) < len(shared) else ''
                elif t in ('str', 'e'):
                    val = v.text
                elif t == 'b':
                    val = v.text == '1'
                else:
                    val = _num(v.text)
                col = _col(ref) if ref else len(cells)
                if col < MAX_COLS: cells[col] = val.strip() if isinstance(val, str) else val
            if not cells: continue
            line = [''] * (max(cells) + 1)
            for k, v in cells.items(): line[k] = v
            rows.append(line)
        out.append({'name': sh.get('name') or f'Аркуш {len(out) + 1}', 'rows': rows})
    return out


def read_csv(data):
    for enc in ('utf-8-sig', 'cp1251'):
        try:
            text = data.decode(enc); break
        except UnicodeDecodeError:
            continue
    else:
        text = data.decode('utf-8', 'replace')
    head = text[:4000]
    delim = max((';', ',', '\t'), key=head.count)
    rows = []
    for r in csv.reader(io.StringIO(text), delimiter=delim):
        if len(rows) >= MAX_ROWS: break
        r = [x.strip() for x in r[:MAX_COLS]]
        if any(r): rows.append(r)
    return [{'name': 'CSV', 'rows': rows}]


def read_table(name, data):
    ext = name.lower().rsplit('.', 1)[-1] if '.' in name else ''
    if ext in ('xlsx', 'xlsm') or data[:2] == b'PK':
        try:
            return read_xlsx(data)
        except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
            raise ValueError(f'Не вдалося прочитати Excel-файл: {e}')
    if ext in ('csv', 'txt'):
        return read_csv(data)
    if ext == 'xls':
        raise ValueError('Не вдалося прочитати .xls: збережіть файл в Excel як .xlsx або .csv.')
    raise ValueError('Підтримуються файли .xlsx, .xls і .csv')
