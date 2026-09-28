@echo off
REM Absolute Genesis - Windows launcher. Starts the API (:3000) and the web app (:5173).
REM   start-arena.bat         both servers
REM   start-arena.bat share   both servers + a public https link for installing on phones
REM First run creates backend\.venv, installs both dependency sets and seeds the DB.
setlocal EnableExtensions
cd /d "%~dp0"

where py >nul 2>nul && (set "PYTHON=py -3") || (set "PYTHON=python")
where node >nul 2>nul || (
  echo [x] Node.js is required - install it from https://nodejs.org then re-run.
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [*] Creating Python virtualenv in backend\.venv ...
  %PYTHON% -m venv backend\.venv || (echo [x] Could not create the virtualenv. Is Python 3.11+ installed? & pause & exit /b 1)
)

echo [*] Installing backend dependencies...
backend\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
backend\.venv\Scripts\python.exe -m pip install --quiet -r backend\requirements.txt

REM AI key for "Make it easy to read" (Gemini or DeepSeek): asked once, saved to
REM backend\.env (git-ignored, never pushed). Press Enter to skip.
if not defined GEMINI_API_KEY if not defined DEEPSEEK_API_KEY (
  findstr /b /r /c:"GEMINI_API_KEY=." /c:"DEEPSEEK_API_KEY=." "backend\.env" >nul 2>nul || call :askkey
)

if not exist "frontend\node_modules" (
  echo [*] Installing frontend dependencies...
  pushd frontend
  call npm install
  popd
)

echo [*] Starting the API on http://localhost:3000 ...
start "Absolute Genesis API :3000" cmd /k "cd /d %~dp0backend && .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 3000 --reload --reload-dir app"

timeout /t 3 /nobreak >nul

echo [*] Starting the web app on http://localhost:5173 ...
start "Absolute Genesis Web :5173" cmd /k "cd /d %~dp0frontend && npx vite --host 0.0.0.0 --port 5173"

REM "start-arena.bat share": a free public https link (Cloudflare quick tunnel)
REM so phones can install Absolute Genesis as a real app. Plain http://192.168.x.x
REM links can only ever make a shortcut on Android.
if /i "%~1"=="share" call :share

echo.
echo   API docs : http://localhost:3000/docs
echo   Web app  : http://localhost:5173
echo   Staff    : admin@quizarena.ng / arena2026
echo   Install  : open http://localhost:5173 in Chrome or Edge, click "Install app".
echo              Phones need an https link (see README, "Install as an app").
echo.
echo   Closing the two terminal windows stops the servers.
echo.
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
endlocal
exit /b 0

:share
echo [*] Opening a public https link for phones (Cloudflare quick tunnel, free, no account)...
where cloudflared >nul 2>nul || (
  echo [*] Installing cloudflared with winget...
  winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements >nul 2>nul
)
where cloudflared >nul 2>nul && (
  start "Absolute Genesis public link" cmd /k "echo Open the https://....trycloudflare.com link below on your phone, then tap Install app. & cloudflared tunnel --no-autoupdate --url http://localhost:5173"
) || (
  start "Absolute Genesis public link" cmd /k "echo Open the https://....trycloudflare.com link below on your phone, then tap Install app. & npx --yes cloudflared tunnel --no-autoupdate --url http://localhost:5173"
)
echo [*] Look in the "Absolute Genesis public link" window for your https://....trycloudflare.com address.
echo     If winget is missing: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
exit /b 0

:askkey
echo [*] Paste your Gemini or DeepSeek API key for the AI rewrite, then press Enter (or just Enter to skip):
set "GKEY="
set /p "GKEY=Key: "
if not defined GKEY (
  echo [*] Skipped - you can add GEMINI_API_KEY=... or DEEPSEEK_API_KEY=... to backend\.env later.
  exit /b 0
)
set "GNAME=GEMINI_API_KEY"
if /i "%GKEY:~0,3%"=="sk-" set "GNAME=DEEPSEEK_API_KEY"
if exist "backend\.env" (
  findstr /v /b /c:"%GNAME%=" "backend\.env" > "backend\.env.tmp"
) else (
  type nul > "backend\.env.tmp"
)
>>"backend\.env.tmp" echo %GNAME%=%GKEY%
move /y "backend\.env.tmp" "backend\.env" >nul
set "GKEY="
echo [*] Saved as %GNAME% in backend\.env (kept out of git).
exit /b 0
