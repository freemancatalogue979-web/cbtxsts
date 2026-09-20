@echo off
REM Quiz Arena - Windows launcher. Starts the API (:3000) and the web app (:5173).
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

if not exist "frontend\node_modules" (
  echo [*] Installing frontend dependencies...
  pushd frontend
  call npm install
  popd
)

echo [*] Starting the API on http://localhost:3000 ...
start "Quiz Arena API :3000" cmd /k "cd /d %~dp0backend && .venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 3000 --reload --reload-dir app"

timeout /t 3 /nobreak >nul

echo [*] Starting the web app on http://localhost:5173 ...
start "Quiz Arena Web :5173" cmd /k "cd /d %~dp0frontend && npx vite --host 0.0.0.0 --port 5173"

echo.
echo   API docs : http://localhost:3000/docs
echo   Web app  : http://localhost:5173
echo   Staff    : admin@quizarena.ng / arena2026
echo.
echo   Closing the two terminal windows stops the servers.
echo.
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
endlocal
