# KpSpec (docs/CONTRACTS.md §5): loading and validation. Messages are for the manager (Ukrainian).
import json, sys
from .profiles import PROFILES, TRAILERS
from .raster import asset_ok

MAX_ROWS = 8          # price page
MAX_TERMS = 7
MAX_CARDS = 9         # accessories page (3 x 3)
REQUIRED_CRANE_SPECS = ('reach_m', 'torque_knm', 'lift_4m_kg', 'lift_full_kg', 'grapple_m2', 'rotator_t', 'turn_deg')


class SpecError(Exception):
    code = 1


class ProfileError(SpecError):
    code = 2


def _pos(p):
    """Admin framing of a tile photo: {zoom >= 1, fx, fy in 0..1} or None."""
    if not isinstance(p, dict): return None
    try:
        z = max(1.0, min(4.0, float(p.get('zoom', 1)))); fx = min(1.0, max(0.0, float(p.get('fx', 0.5)))); fy = min(1.0, max(0.0, float(p.get('fy', 0.5))))
    except (TypeError, ValueError):
        return None
    return None if z == 1.0 and fx == 0.5 and fy == 0.5 else dict(zoom=z, fx=fx, fy=fy)


def _s(v): return '' if v is None else str(v)


def warn(msg): print(f'kpgen: увага: {msg}', file=sys.stderr)


def _photo(path, what, instead='без фото'):
    """Asset path from the spec, '' when it is missing or points outside generator/assets."""
    if not path: return ''
    if asset_ok(path): return path
    warn(f'фото {what} не знайдено в generator/assets: {path!r}; {instead}.')
    return ''


def _photos(photos):
    out = {}
    for k in ('cover', 'end'):
        p = _photo(photos.get(k), 'для ' + ('обкладинки' if k == 'cover' else 'останньої сторінки'), 'взято типове фото крана')
        if not p: continue
        out[k] = p
        f = photos.get(k + '_focus')
        if f is not None:
            try:
                fx, fy = (float(v) for v in f)
                if not (0 <= fx <= 1 and 0 <= fy <= 1): raise ValueError
                out[k + '_focus'] = (fx, fy)
            except (TypeError, ValueError):
                raise SpecError(f'photos.{k}_focus має бути парою чисел від 0 до 1, отримано {f!r}.')
    return out


def load(path):
    try:
        with open(path, encoding='utf-8') as f: spec = json.load(f)
    except (OSError, ValueError) as e:
        raise SpecError(f'Не вдалося прочитати специфікацію КП ({path}): {e}')
    return validate(spec)


def validate(spec):
    if not isinstance(spec, dict): raise SpecError('Специфікація КП має бути JSON-об’єктом.')
    from .styles import STYLES
    if (spec.get('style') or 'dark') not in STYLES:
        raise SpecError(f"Невідомий стиль КП: {spec.get('style')!r}. Є: {', '.join(STYLES)}.")
    if spec.get('template', 'kp_v3') != 'kp_v3':
        raise SpecError(f"Невідомий шаблон КП: {spec.get('template')!r} (підтримується лише kp_v3).")
    missing = [k for k in ('number', 'date', 'client', 'kit_type', 'title', 'rows', 'total_text', 'maker', 'contacts')
               if spec.get(k) in (None, '')]
    if missing: raise SpecError('У специфікації КП бракує полів: ' + ', '.join(missing) + '.')

    crane = spec.get('crane')
    if not crane: raise ProfileError('КП без крана-маніпулятора цей шаблон не будує (поле crane порожнє).')
    prof = crane.get('profile')
    if prof not in PROFILES:
        raise ProfileError(f"Для крана {crane.get('model') or crane.get('id') or ''} немає візуального профілю КП "
                           f"({prof!r}). Підтримуються: {', '.join(sorted(PROFILES))}.")
    specs = {k: _s(v) for k, v in (crane.get('specs') or {}).items() if v not in (None, '')}
    lack = [k for k in REQUIRED_CRANE_SPECS if not specs.get(k)]
    if lack: raise SpecError(f"У характеристиках крана {crane.get('model', '')} бракує: {', '.join(lack)}.")
    crane = dict(crane, specs=specs, model=crane.get('model') or crane.get('id', '').upper())

    rows = spec['rows']
    if not isinstance(rows, list) or not rows: raise SpecError('У КП немає жодної позиції (rows).')
    if len(rows) > MAX_ROWS: raise SpecError(f'Забагато позицій для сторінки «Вартість»: {len(rows)} (максимум {MAX_ROWS}).')
    rows = [dict(no=r.get('no', i), title=_s(r.get('title')), desc=_s(r.get('desc')), qty=r.get('qty', 1),
                 price_text=_s(r.get('price_text')), item_id=r.get('item_id'), kind=r.get('kind'),
                 photo=_photo(r.get('photo'), f'позиції {i}'), photo_force=bool(r.get('photo_force')),
                 photo_pos=_pos(r.get('photo_pos')))
            for i, r in enumerate(rows, 1)]
    terms = [dict(title=_s(t.get('title')), text=_s(t.get('text'))) for t in (spec.get('terms') or [])]
    if len(terms) > MAX_TERMS: raise SpecError(f'Забагато умов співпраці: {len(terms)} (максимум {MAX_TERMS}).')
    accs = [dict(group=_s(a.get('group')), title=_s(a.get('title')), desc=_s(a.get('desc')),
                 photo=_photo(a.get('photo'), f"опції «{_s(a.get('title'))}»"),
                 price_text=_s(a.get('price_text')) or 'ціна за запитом') for a in (spec.get('accessories') or [])]

    npl = spec.get('npl')
    if spec['kit_type'] == 'npl_crane' and not npl:
        npl = {}
    if npl is not None:
        npl = dict(brakes=_s(npl.get('brakes')) or 'гідравлічна', wheels=_s(npl.get('wheels')) or '500/45-22,5',
                   stakes=_s(npl.get('stakes')) or '4', lead=_s(npl.get('lead')), lead2=_s(npl.get('lead2')))

    trailer = spec.get('trailer') if npl is None else None
    if trailer:
        if trailer.get('profile') not in TRAILERS:
            raise ProfileError(f"Для причепа {trailer.get('model') or trailer.get('id') or ''} немає сторінок КП "
                               f"({trailer.get('profile')!r}). Підтримуються: {', '.join(sorted(TRAILERS))}.")
        trailer = dict(trailer, model=_s(trailer.get('model')), title=_s(trailer.get('title')), short=_s(trailer.get('short')),
                       specs={k: _s(v) for k, v in (trailer.get('specs') or {}).items() if v not in (None, '')})

    client = spec['client'] if isinstance(spec['client'], dict) else {'name': _s(spec['client'])}
    contacts = spec['contacts']
    maker = spec['maker']
    return dict(spec, crane=crane, rows=rows, terms=terms, accessories=accs, npl=npl, trailer=trailer or None,
                client=dict(name=_s(client.get('name')), contact=_s(client.get('contact'))),
                contacts=dict(phones=list(contacts.get('phones') or []), email=_s(contacts.get('email')),
                              sites=list(contacts.get('sites') or []), address=_s(contacts.get('address')),
                              socials=contacts.get('socials')),
                maker=dict(name=_s(maker.get('name')), line=_s(maker.get('line')) or f"Виробник: {_s(maker.get('name'))}"),
                valid_until=_s(spec.get('valid_until')), price_note=_s(spec.get('price_note')),
                photos=_photos(spec.get('photos') or {}))
