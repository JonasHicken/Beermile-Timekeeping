@echo off
REM Launches the timing dev server from this folder. Using a batch launcher
REM (cd into %~dp0 = this script's dir) avoids the npm "--prefix <path with
REM spaces>" bug that fails with "'C:\Program' is not recognized". Vite reads
REM the port from the PORT env var the preview harness assigns (see vite.config.js).
cd /d "%~dp0"
call npx vite
