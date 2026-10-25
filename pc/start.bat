@echo off
chcp 65001 >nul
title Конфігуратор КП
cd /d "%~dp0"
if not exist data mkdir data

rem ---------------------------------------------------------------- Python
call :findpy
if defined PY goto py_ok
echo.
echo Python 3.11+ не знайдено на цьому комп'ютері.
choice /c YN /m "Завантажити і встановити Python 3.12 автоматично? Y = так, N = ні"
if errorlevel 2 goto py_manual
set "PYURL=https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
set "PYEXE=%TEMP%\python-3.12.10-amd64.exe"
if exist "%PYEXE%" del /q "%PYEXE%"
echo Завантажую Python 3.12.10 з python.org...
curl.exe -L --fail -o "%PYEXE%" "%PYURL%"
if not exist "%PYEXE%" powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest -UseBasicParsing -Uri '%PYURL%' -OutFile '%PYEXE%'"
if not exist "%PYEXE%" goto py_manual
for %%A in ("%PYEXE%") do if %%~zA LSS 5000000 goto py_manual
echo Встановлюю Python: з'явиться вікно з прогресом, зачекайте до кінця.
start "" /wait "%PYEXE%" /passive InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
call :findpy
if defined PY goto py_ok
echo.
echo Python встановлено, але Windows ще не бачить його в цьому вікні.
echo Закрийте це вікно і запустіть start.bat ще раз.
pause
exit /b 1

:py_manual
echo.
echo Встановіть Python вручну:
echo   1. Завантажте https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe
echo   2. Запустіть файл, внизу позначте "Add python.exe to PATH", натисніть "Install Now".
echo   3. Запустіть start.bat знову.
echo Файл .msix "Python install manager" не потрібен.
pause
exit /b 1

:py_ok
echo Python: %PY%

rem ---------------------------------------------------------------- бібліотеки
%PY% -c "import pptx, PIL, numpy" >nul 2>nul
if not errorlevel 1 goto libs_ok
echo Встановлюю бібліотеки python-pptx, Pillow, numpy (потрібен інтернет, лише раз)...
%PY% -m pip --version >nul 2>nul
if errorlevel 1 %PY% -m ensurepip --upgrade
%PY% -m pip install --user -r requirements.txt
%PY% -c "import pptx, PIL, numpy" >nul 2>nul
if not errorlevel 1 goto libs_ok
echo.
echo Не вдалося встановити бібліотеки. Надішліть, будь ласка, знімок цього вікна.
pause
exit /b 1
:libs_ok

rem ---------------------------------------------------------------- LibreOffice (для PDF)
call :findlo
if defined LO goto lo_ok
echo.
echo LibreOffice не знайдено: без нього КП створюється лише в PPTX, без PDF.
where winget >nul 2>nul
if errorlevel 1 goto lo_page
choice /c YN /m "Встановити LibreOffice автоматично? Y = так, N = продовжити без PDF"
if errorlevel 2 goto lo_skip
winget install -e --id TheDocumentFoundation.LibreOffice --accept-package-agreements --accept-source-agreements
call :findlo
if defined LO goto lo_ok
:lo_skip
goto lo_later
:lo_page
choice /c YN /m "Відкрити сторінку завантаження LibreOffice в браузері? Y = так, N = ні"
if errorlevel 2 goto lo_later
start "" "https://www.libreoffice.org/download/download-libreoffice/"
echo Після встановлення LibreOffice запустіть start.bat знову, тоді КП будуть і в PDF.
:lo_later
echo Продовжую без PDF. LibreOffice можна встановити пізніше: https://www.libreoffice.org/download/
goto run
:lo_ok
set "KPGEN_SOFFICE=%LO%"
echo LibreOffice: %LO%

:run
echo.
echo Запускаю конфігуратор. Браузер відкриється сам: http://127.0.0.1:8765
echo Щоб закрити програму, закрийте це вікно.
%PY% server.py %*
pause
exit /b 0

rem ---------------------------------------------------------------- пошук
:findpy
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY exit /b 0
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY exit /b 0
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do (
  if exist "%%~D\python.exe" set PY="%%~D\python.exe"
)
exit /b 0

:findlo
set "LO="
if exist "%ProgramFiles%\LibreOffice\program\soffice.exe" set "LO=%ProgramFiles%\LibreOffice\program\soffice.exe"
if not defined LO if exist "%ProgramFiles(x86)%\LibreOffice\program\soffice.exe" set "LO=%ProgramFiles(x86)%\LibreOffice\program\soffice.exe"
exit /b 0
