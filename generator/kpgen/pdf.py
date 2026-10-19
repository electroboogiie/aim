# PDF export through LibreOffice. Each run gets its own LibreOffice profile so parallel runs do not
# block each other on the shared user profile.
import os, pathlib, shutil, signal, subprocess, tempfile

WIN_PATHS = [os.path.join(os.environ.get(v, ''), 'LibreOffice', 'program', 'soffice.exe')
             for v in ('ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432') if os.environ.get(v)]


class PdfError(Exception):
    pass


def soffice_bin():
    for name in (os.environ.get('KPGEN_SOFFICE'), 'soffice', 'libreoffice'):
        if name and shutil.which(name): return shutil.which(name)
    for path in WIN_PATHS:
        if os.path.isfile(path): return path
    raise PdfError('Не знайдено LibreOffice (soffice) для створення PDF.')


def to_pdf(pptx, out_dir, timeout=None):
    return convert(pptx, out_dir, 'pdf', timeout)


def to_png(pptx, out_dir, timeout=None):
    """PNG of the first slide (LibreOffice exports only the first page to PNG): the KP cover preview."""
    return convert(pptx, out_dir, 'png', timeout)


def convert(pptx, out_dir, fmt, timeout=None):
    timeout = timeout or int(os.environ.get('KPGEN_PDF_TIMEOUT', '180'))
    profile = tempfile.mkdtemp(prefix='kpgen_lo_')
    try:
        pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(pptx))[0] + '.' + fmt)
        if os.path.exists(pdf): os.remove(pdf)   # soffice may exit 0 without writing: never report a stale file
        cmd = [soffice_bin(), '-env:UserInstallation=' + pathlib.Path(profile).as_uri(), '--headless', '--norestore',
               '--convert-to', fmt, '--outdir', out_dir, pptx]
        # own session: on timeout the whole LibreOffice tree (wrapper + soffice.bin) is killed
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             encoding='utf-8', errors='replace', start_new_session=True)
        try:
            out, err = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                if hasattr(os, 'killpg'): os.killpg(p.pid, signal.SIGKILL)
                else: p.kill()
            except ProcessLookupError: pass
            p.communicate()
            raise PdfError(f'LibreOffice не встиг створити {fmt.upper()} за {timeout} с.')
        if p.returncode != 0 or not os.path.exists(pdf):
            raise PdfError(f'LibreOffice не створив {fmt.upper()} (код {p.returncode}): {(err or out).strip()[-500:]}')
        return pdf
    finally:
        shutil.rmtree(profile, ignore_errors=True)
