@echo off
chcp 65001 >nul
title Конфігуратор КП
cd /d "%~dp0"
set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" ( where python >nul 2>nul && set PY=python )
if "%PY%"=="" (
  echo Не знайдено Python. Встановіть Python 3.11 або новіший з https://www.python.org/downloads/
  echo ^(під час встановлення позначте "Add python.exe to PATH"^), потім запустіть цей файл знову.
  pause & exit /b 1
)
if not exist data\.deps-ok (
  echo Перший запуск: встановлюю бібліотеки python-pptx, Pillow, numpy...
  %PY% -m pip install --user -r requirements.txt || ( echo Не вдалося встановити бібліотеки. & pause & exit /b 1 )
  if not exist data mkdir data
  echo ok> data\.deps-ok
)
if not exist "%ProgramFiles%\LibreOffice\program\soffice.exe" if not exist "%ProgramFiles(x86)%\LibreOffice\program\soffice.exe" (
  echo Увага: не знайдено LibreOffice. PPTX створюватиметься, PDF - ні. Встановіть LibreOffice з https://www.libreoffice.org/download/
)
%PY% server.py
pause
