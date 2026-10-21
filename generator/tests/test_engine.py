# Engine checks without PDF export:  cd generator && python3 -m unittest discover -s tests -v
import copy, json, os, re, shutil, subprocess, sys, tempfile, unittest
from pptx import Presentation

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_samples as B  # noqa: E402

ENV = dict(os.environ, KPGEN_BUILD=os.path.join(HERE, 'out', '.build'))


TMP = tempfile.mkdtemp(prefix='kpgen_test_')


def tearDownModule(): shutil.rmtree(TMP, ignore_errors=True)


def run(spec):
    d = tempfile.mkdtemp(dir=TMP)
    sp = os.path.join(d, 'spec.json')
    with open(sp, 'w', encoding='utf-8') as f: json.dump(spec, f, ensure_ascii=False)
    p = subprocess.run([sys.executable, '-m', 'kpgen', '--spec', sp, '--out', d, '--no-pdf'], cwd=GEN, env=ENV,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    res = json.loads(p.stdout.strip().splitlines()[-1]) if p.returncode == 0 else None
    return p.returncode, res, p.stderr


def texts(prs):
    out = []
    for s in prs.slides:
        out.append([sh.text_frame.text for sh in s.shapes if sh.has_text_frame])
    return out


class EngineTest(unittest.TestCase):
    def sample(self, name): return copy.deepcopy(B.SAMPLES[name][0])

    def check_numbers(self, prs):
        T = texts(prs); n = len(T)
        for i, page in enumerate(T, 1):
            nums = [t for t in page if re.fullmatch(r'\d\d / \d\d', t)]
            if i > 1: self.assertEqual(nums, [f'{i:02d} / {n:02d}'], f'page {i}')
            tags = [t for t in page if re.match(r'// \d\d — ', t)]
            for t in tags: self.assertTrue(t.startswith(f'// {i - 1:02d} — '), f'page {i}: {t}')
        return T

    def test_npl_without_accessories(self):
        spec = self.sample('npl10_bmf720'); spec['accessories'] = []
        code, res, err = run(spec)
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 10)
        T = self.check_numbers(Presentation(res['pptx']))
        config = T[6]
        self.assertFalse(any('Опції для крана' in t for t in config))
        self.assertFalse(any('ДОДАТКОВІ ОПЦІЇ' in t for p in T for t in p))

    def test_npl_rows_have_no_hydraulics(self):
        code, res, err = run(self.sample('npl10_bmf750'))
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 11)
        T = self.check_numbers(Presentation(res['pptx']))
        for page in (T[6], T[8]):   # configuration and price pages
            self.assertFalse(any('автономна гідравліка' in t.lower() for t in page))
            self.assertEqual(sum(t == 'у комплекті' for t in page), 2)
        self.assertTrue(any('1 978 000 ₴' in t for t in T[8]))
        self.assertTrue(any('ДІЙСНА ДО 25.10.2026' in t for t in T[8]))

    def test_crane_kit_variants(self):
        for n in (1, 3, 5, 8):
            spec = self.sample('bmf750_radiator')
            rows = (spec['rows'] * 2)[:n]
            for i, r in enumerate(rows, 1): r['no'] = i
            spec['rows'] = rows
            code, res, err = run(spec)
            self.assertEqual(code, 0, f'{n} rows: {err}')
            T = self.check_numbers(Presentation(res['pptx']))
            price = T[6]
            self.assertEqual(sum(1 for t in price if re.fullmatch(r'0\d', t)), n, f'{n} rows')

    def test_many_accessories_and_terms(self):
        spec = self.sample('npl10_bmf650')
        spec['accessories'] = spec['accessories'] + spec['accessories'][:3]
        spec['terms'] = spec['terms'][:3]
        code, res, err = run(spec)
        self.assertEqual(code, 0, err)
        T = self.check_numbers(Presentation(res['pptx']))
        opts = T[7]
        self.assertEqual(sum('ціна за запитом' == t for t in opts), 9)
        self.assertTrue(any('Також на замовлення: Регулюючий клапан, Грейфери Hardox, Ротатори.' in t for t in opts))
        self.assertEqual(sum(bool(re.fullmatch(r'T-0\d', t)) for t in T[8]), 3)

    def test_bad_photo_paths(self):
        spec = self.sample('bmf650plus_2pos')
        spec['photos'] = dict(cover='../kpgen/__init__.py', end='bmf/немає.jpg')
        spec['rows'][1]['photo'] = '/etc/hostname'
        spec['accessories'] = [dict(group='crane', title='Ротатори', desc='', photo='../../README.md', price_text='')]
        code, res, err = run(spec)
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 9)
        self.assertEqual(err.count('увага'), 4, err)
        spec['photos'] = dict(cover='bmf/650_a.jpg', cover_focus=[0.5, 2])
        code, _, err = run(spec); self.assertEqual(code, 1); self.assertIn('cover_focus', err)

    def test_ultra_style(self):
        """«Ultra»: crane kit (8 pages, 7 without options) and НПЛ-10 + crane (11 pages)."""
        for name, pages, words in (('bmf720_komplekt', 8, ('BMF', 'Вантажопідйомність')), ('npl10_bmf750', 11, ('НПЛ-10', 'BMF 750'))):
            spec = self.sample(name); spec['style'] = 'ultra'
            spec['accessories'] = self.sample('npl10_bmf750')['accessories']
            code, res, err = run(spec)
            self.assertEqual(code, 0, err); self.assertEqual(res['pages'], pages, name)
            T = texts(Presentation(res['pptx'])); flat = ' '.join(t for p in T for t in p)
            for w in words: self.assertIn(w, flat)
            self.assertNotIn('автономна гідравліка', ' '.join(t for t in T[-3]).lower())
            self.assertIn(f'{pages:02d}', ' '.join(T[-1]))
        spec = self.sample('bmf720_komplekt'); spec['style'] = 'ultra'; spec['accessories'] = []
        code, res, err = run(spec)
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 7)

    def test_ultra_truck(self):
        """«Ultra» for a truck converted to a timber carrier: brand from the conversion line, price on request."""
        with open(os.path.join(HERE, 'specs', 'zil_bmf650.json'), encoding='utf-8') as f: spec = json.load(f)
        spec['style'] = 'ultra'
        code, res, err = run(spec)
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 10)
        flat = ' '.join(t for p in texts(Presentation(res['pptx'])) for t in p)
        self.assertIn('ЗІЛ  ×  BMF 650', flat); self.assertNotIn('КРАЗ', flat)

    def test_npl_label_crane_pages(self):
        """«НПЛ-10 Heavy Label» with BMF 750: crane texts and headlines for 750, chart without the template bars."""
        spec = self.sample('npl10_bmf750'); spec['style'] = 'npl_label'
        code, res, err = run(spec)
        self.assertEqual(code, 0, err); self.assertEqual(res['pages'], 10)
        prs = Presentation(res['pptx']); S = list(prs.slides)
        self.assertFalse(any(sh.name == 'hdr_cover_10t' for sh in S[0].shapes))
        self.assertFalse(any(sh.name == 'dwg_crane' for sh in S[4].shapes))
        lead = [sh.text_frame.text for sh in S[4].shapes if sh.has_text_frame and sh.shape_id == 28][0]
        self.assertIn('7,5', lead); self.assertNotIn('BMF720', lead)
        self.assertFalse(any(sh.has_text_frame and sh.text_frame.text == '1100' for sh in S[5].shapes))

    def test_errors(self):
        spec = self.sample('bmf720_komplekt'); spec['crane']['profile'] = 'bmf850'
        code, _, err = run(spec); self.assertEqual(code, 2); self.assertIn('профілю', err)
        spec = self.sample('bmf720_komplekt'); spec['crane'] = None
        code, _, err = run(spec); self.assertEqual(code, 2)
        spec = self.sample('bmf720_komplekt'); del spec['rows']
        code, _, err = run(spec); self.assertEqual(code, 1); self.assertIn('rows', err)
        spec = self.sample('bmf720_komplekt'); del spec['crane']['specs']['reach_m']
        code, _, err = run(spec); self.assertEqual(code, 1); self.assertIn('reach_m', err)
        spec = self.sample('bmf720_komplekt'); spec['rows'] = spec['rows'] * 3
        code, _, err = run(spec); self.assertEqual(code, 1); self.assertIn('максимум 8', err)


if __name__ == '__main__':
    unittest.main()
