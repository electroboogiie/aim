# PDF export through LibreOffice. Each run gets its own LibreOffice profile so parallel runs do not
# block each other on the shared user profile.
import os, shutil, signal, subprocess, tempfile


class PdfError(Exception):
    pass


def soffice_bin():
    for name in (os.environ.get('KPGEN_SOFFICE'), 'soffice', 'libreoffice'):
        if name and shutil.which(name): return shutil.which(name)
    raise PdfError('Не знайдено LibreOffice (soffice) для створення PDF.')


def to_pdf(pptx, out_dir, timeout=None):
    timeout = timeout or int(os.environ.get('KPGEN_PDF_TIMEOUT', '180'))
    profile = tempfile.mkdtemp(prefix='kpgen_lo_')
    try:
        pdf = os.path.join(out_dir, os.path.splitext(os.path.basename(pptx))[0] + '.pdf')
        if os.path.exists(pdf): os.remove(pdf)   # soffice may exit 0 without writing: never report a stale file
        cmd = [soffice_bin(), f'-env:UserInstallation=file://{profile}', '--headless', '--norestore',
               '--convert-to', 'pdf', '--outdir', out_dir, pptx]
        # own session: on timeout the whole LibreOffice tree (wrapper + soffice.bin) is killed
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            try: os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            p.communicate()
            raise PdfError(f'LibreOffice не встиг створити PDF за {timeout} с.')
        if p.returncode != 0 or not os.path.exists(pdf):
            raise PdfError(f'LibreOffice не створив PDF (код {p.returncode}): {(err or out).strip()[-500:]}')
        return pdf
    finally:
        shutil.rmtree(profile, ignore_errors=True)
