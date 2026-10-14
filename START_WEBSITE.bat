@echo off
cd /d "%~dp0"
echo ============================================
echo IoT Monitoring System - Web + API
 echo ============================================
if not exist ".env" (
  echo [LOI] Chua co .env. Copy .env.example thanh .env va dien MySQL / MQTT / JWT_SECRET.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [LOI] Chua cai thu vien. Mo PowerShell tai thu muc nay va chay: npm install
  pause
  exit /b 1
)
echo Khi server san sang, mo http://127.0.0.1:3000
call npm start
pause
