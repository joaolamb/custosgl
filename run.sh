#!/bin/bash
# Dashboard de Custos — startup script
cd "$(dirname "$0")"
pip3 install -q flask pandas openpyxl
python3 app.py 5050
