@echo off
REM 9 CLOVER - Competitive Operations launcher (Windows).
REM
REM   start-arena.bat              PRODUCTION: builds the web app, then ONE server on :9009
REM                                serves the app + API (no dev server, no auto-reload)
REM   start-arena.bat share        production + a public https link for phones
REM   start-arena.bat update       pull the latest code first, then start (any mode)
REM   start-arena.bat dev          DEVELOPMENT: API :9000 with auto-reload + Vite dev server :9009
REM   start-arena.bat dev share    development + public link
REM
REM First run creates backend\.venv, installs both dependency sets and creates the DB.
REM Production also makes sure backend\.env has a private secret key (and gives a brand-new
REM database a random admin password, shown once in this window).
REM NOTE: a Windows venv cannot be MOVED/RENAMED - if this folder (or any parent) was
REM renamed after the first run, the launcher detects the broken venv and recreates it.
setlocal EnableExtensions
cd /d "%~dp0"
REM Saved before reading the options: SHIFT also moves %0, so %~dp0 is not safe later.
set "ROOT=%~dp0"

set "MODE=prod"
set "SHARE=0"
set "UPDATE=0"
:args
if "%~1"=="" goto args_done
if /i "%~1"=="dev" set "MODE=dev"
if /i "%~1"=="prod" set "MODE=prod"
if /i "%~1"=="share" set "SHARE=1"
if /i "%~1"=="update" set "UPDATE=1"
shift
goto args
:args_done

if "%UPDATE%"=="1" (
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

if /i "%MODE%"=="dev" goto dev

REM ======================= PRODUCTION =======================
REM An older production window still running would block the port.
curl -fs http://localhost:9009/api/health >nul 2>nul && (
  echo [!] 9 Clover is already running on port 9009. Close the "9 CLOVER :9009" window first,
  echo     then run this again so the new build and code are used.
  pause
  exit /b 1
)

echo [*] Checking backend\.env for production...
"%VENV_PY%" backend\scripts\prod_env.py || (echo [x] Could not prepare backend\.env & pause & exit /b 1)

echo [*] Building the web app ^(frontend\dist^)...
pushd frontend
call npm run build
if errorlevel 1 (
  popd
  echo [x] The web app build failed - see the errors above.
  pause
  exit /b 1
)
popd

REM One process serves the built app and the API (backend\app\frontend_static.py).
REM The new window inherits this setting.
set "CLOVER_SERVE_FRONTEND=1"
echo [*] Starting 9 Clover ^(production^) on http://localhost:9009 ...
start "9 CLOVER :9009 (production)" cmd /k "cd /d %ROOT%backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9009 --workers 1 --proxy-headers"

REM Wait until it answers (up to ~40 s) before opening the browser.
set /a TRIES=0
:wait_prod
curl -fs http://localhost:9009/api/health >nul 2>nul && goto prod_up
set /a TRIES+=1
if %TRIES% GEQ 40 goto prod_slow
timeout /t 1 /nobreak >nul
goto wait_prod
:prod_slow
echo [!] Still starting - check the "9 CLOVER :9009" window for errors.
:prod_up

if "%SHARE%"=="1" call :share

echo.
echo   9 Clover : http://localhost:9009          ^(production build^)
echo   Phones   : http://THIS-PC-IP:9009 on the same Wi-Fi  ^(allow it if Windows Firewall asks^)
echo   API docs : http://localhost:9009/docs
echo   Update   : start-arena.bat update   ^(close the server window first^)
echo.
echo   Closing the "9 CLOVER :9009" window stops the server.
echo.
start "" http://localhost:9009
endlocal
exit /b 0

REM ======================= DEVELOPMENT =======================
:dev
REM Module form (python -m uvicorn) - immune to broken exe launchers.
echo [*] DEVELOPMENT mode: auto-reload, not for real use.
echo [*] Starting the API on http://localhost:9000 ...
start "9 CLOVER API :9000" cmd /k "cd /d %ROOT%backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 9000 --reload --reload-dir app"

timeout /t 3 /nobreak >nul

echo [*] Starting the web app on http://localhost:9009 ...
start "9 CLOVER Web :9009" cmd /k "cd /d %ROOT%frontend && npx vite --host 0.0.0.0 --port 9009"

if "%SHARE%"=="1" call :share

echo.
echo   API docs : http://localhost:9000/docs
echo   Web app  : http://localhost:9009
echo   Sign in  : admin / clover2026 on a new database  ^(username = the part of the email before the @^)
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
