# python3 -m kpgen --spec spec.json --out DIR [--no-pdf]   (cwd = generator/)
# Last stdout line: {"pptx": "<abs path>", "pdf": "<abs path>|null", "pages": N}
import argparse, json, os, re, shutil, sys, tempfile, time

from .spec import load, SpecError
from .pdf import to_pdf, PdfError

UA = dict(zip('абвгґдеєжзиіїйклмнопрстуфхцчшщьюяАБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ',
              ['a', 'b', 'v', 'h', 'g', 'd', 'e', 'ie', 'zh', 'z', 'y', 'i', 'i', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's',
               't', 'u', 'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'iu', 'ia'] * 2))


def file_name(spec):
    if spec.get('file'): base = spec['file']
    else: base = f"KP_{spec['number']}_{spec['title']}"
    base = ''.join((UA[ch].upper() if ch.isupper() else UA[ch]) if ch in UA else ch for ch in base)
    base = re.sub(r'[^A-Za-z0-9._-]+', '_', base).strip('_.')
    return base or 'KP'


def main(argv=None):
    ap = argparse.ArgumentParser(prog='kpgen', description='Генератор КП (шаблон KP_2_v3)')
    ap.add_argument('--spec', required=True, help='KpSpec JSON')
    ap.add_argument('--out', required=True, help='тека для pptx / pdf')
    ap.add_argument('--no-pdf', action='store_true', help='лише pptx')
    a = ap.parse_args(argv)
    t0 = time.time()
    try:
        spec = load(a.spec)
    except SpecError as e:
        print(f'kpgen: {e}', file=sys.stderr); return e.code
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    build_dir = os.environ.get('KPGEN_BUILD')
    tmp = None
    if not build_dir:
        tmp = build_dir = tempfile.mkdtemp(prefix='kpgen_build_')
    try:
        from .build import Engine
        prs = Engine(spec, build_dir).build()
        name = file_name(spec)
        pptx = os.path.join(out, name + '.pptx')
        prs.save(pptx)
        pages = len(prs.slides)
        t1 = time.time()
        pdf = None
        if not a.no_pdf:
            try:
                pdf = to_pdf(pptx, out)
            except PdfError as e:
                print(f'kpgen: {e}', file=sys.stderr); return 3
        print(f'kpgen: pptx {t1 - t0:.1f} s' + (f', pdf {time.time() - t1:.1f} s' if pdf else ''), file=sys.stderr)
        print(json.dumps({'pptx': pptx, 'pdf': pdf, 'pages': pages}, ensure_ascii=False))
        return 0
    except SpecError as e:
        print(f'kpgen: {e}', file=sys.stderr); return e.code
    except Exception as e:  # noqa: BLE001 - report any engine failure as one line for the server
        import traceback; traceback.print_exc(file=sys.stderr)
        print(f'kpgen: помилка генерації КП: {e}', file=sys.stderr); return 1
    finally:
        if tmp: shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
