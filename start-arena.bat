@echo off
REM 9 CLOVER - Competitive Operations launcher (Windows).
REM Starts the API (:9000) and the web app (:9009) - the web app proxies /api to the API.
REM   start-arena.bat         both servers
REM   start-arena.bat share   both servers + a public https link for phones
REM First run creates backend\.venv, installs both dependency sets and seeds the DB.
REM NOTE: a Windows venv cannot be MOVED/RENAMED - if this folder (or any parent)
REM was renamed after the first run, the launcher detects the broken venv and
REM recreates it automatically.
setlocal EnableExtensions
cd /d "%~dp0"

REM Optional: start-arena.bat update  ->  pull the latest code first (running API
REM reloads itself afterwards -- uvicorn --reload watches backend\app\ and vite
REM hot-reloads the frontend, so a pull alone updates a running app).
if /i "%~1"=="update" (
  echo [*] Pulling latest code...
  git pull --rebase || echo [!] pull reported a conflict - fix it and re-run.
)

where py >nul 2>nul && (set "PYTHON=py -3") || (set "PYTHON=python")
where node >nul 2>nul || (
  echo [x] Node.js is required - install it from https://nodejs.org then re-run.
  pause
  exit /b 1
)

set "VENV_PY=backend\.venv\Scripts\python.exe"

REM Self-heal: a venv that was moved/copied fails this probe - rebuild it.
if exist "%VENV_PY%" (
  "%VENV_PY%" -c "pass" >nul 2>nul || (
    echo [!] Existing virtualenv is broken ^(folder was moved/copied^) - recreating...
    rmdir /s /q backend\.venv
  )
)

if not exist "%VENV_PY%" (
  echo [*] Creating Python virtualenv in backend\.venv ...
  %PYTHON% -m venv backend\.venv || (echo [x] Could not create the virtualenv. Is Python 3.11+ installed? & pause & exit /b 1)
)

echo [*] Installing backend dependencies...
"%VENV_PY%" -m pip install --quiet --upgrade pip
"%VENV_PY%" -m pip install --quiet -r backend\requirements.txt

REM Reinstall frontend dependencies on first run and whenever the lockfile changes.
set "NEED_NPM=0"
if not exist "frontend\node_modules" set "NEED_NPM=1"
if not exist "frontend\node_modules\.arena-lock" set "NEED_NPM=1"
if "%NEED_NPM%"=="0" fc /b "frontend\package-lock.json" "frontend\node_modules\.arena-lock" >nul 2>nul || set "NEED_NPM=1"
if "%NEED_NPM%"=="1" (
  echo [*] Installing frontend dependencies...
  pushd frontend
  call npm install && copy /y package-lock.json node_modules\.arena-lock >nul
  popd
)

REM Module form (python -m uvicorn) - immune to broken exe launchers.
echo [*] Starting the API on http://localhost:9000 ...
start "9 CLOVER API :9000" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload --reload-dir app"

timeout /t 3 /nobreak >nul

echo [*] Starting the web app on http://localhost:9009 ...
start "9 CLOVER Web :9009" cmd /k "cd /d %~dp0frontend && npx vite --host 0.0.0.0 --port 9009"

if /i "%~1"=="share" call :share

echo.
echo   API docs : http://localhost:9000/docs
echo   Web app  : http://localhost:9009
echo   Sign in  : admin@9clover.gg / clover2026  (roster/staff accounts use the same password)
echo.
echo   Closing the two terminal windows stops the servers.
echo.
timeout /t 6 /nobreak >nul
start "" http://localhost:9009
endlocal
exit /b 0

:share
echo [*] Opening a public https link (Cloudflare quick tunnel, free, no account)...
where cloudflared >nul 2>nul || (
  echo [*] Installing cloudflared with winget...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements >nul 2>nul
)
where cloudflared >nul 2>nul && (
  start "9 CLOVER public link" cmd /k "echo Share the https://....trycloudflare.com link below with the squad. ^& cloudflared tunnel --no-autoupdate --url http://localhost:9009"
) || (
  start "9 CLOVER public link" cmd /k "echo Share the https://....trycloudflare.com link below with the squad. ^& npx --yes cloudflared tunnel --no-autoupdate --url http://localhost:9009"
)
echo [*] Look in the "9 CLOVER public link" window for your https://....trycloudflare.com address.
exit /b 0
