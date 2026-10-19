#!/usr/bin/env bash
# Linux / macOS: python3 -m pip install --user -r requirements.txt  (раз), далі цей скрипт.
cd "$(dirname "$0")" && exec python3 server.py "$@"
