@echo off
rem Usage:  kiosk.bat          token is read from the gas_token file next to this bat
rem         kiosk.bat TOKEN    pass the token explicitly
rem Edge kiosk mode runs InPrivate: nothing is kept once Edge closes,
rem so the token is registered on every launch. Exit with Alt+F4.

set URL=https://gdgoc-chuo.github.io/2026-fest-stats/
set TOKEN=%~1
if "%TOKEN%"=="" if exist "%~dp0gas_token" set /p TOKEN=<"%~dp0gas_token"
if not "%TOKEN%"=="" set URL=%URL%#setup=%TOKEN%

rem Folder to pick as the CSV destination in the admin panel
if not exist "%~dp0data" mkdir "%~dp0data"

rem Dedicated profile so this never attaches to an Edge window that is already open
start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --user-data-dir="%LOCALAPPDATA%\fest-kiosk" --no-first-run --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch
