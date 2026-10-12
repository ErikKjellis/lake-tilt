@echo off
rem Serve the Altevatnet visualisation and open it in the default browser.
cd /d "%~dp0"
start "" http://localhost:8765/
python tools\serve.py 8765
