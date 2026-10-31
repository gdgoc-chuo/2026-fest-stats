@echo off
rem Usage:  kiosk.bat            normal start
rem         kiosk.bat TOKEN      first time only: registers the token on this PC
rem Exit with Alt+F4

set URL=https://gdgoc-chuo.github.io/2026-fest-stats/
if not "%~1"=="" set URL=%URL%#setup=%~1

rem Dedicated profile: token and local backup of responses live here
start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --user-data-dir="%LOCALAPPDATA%\fest-kiosk" --no-first-run --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0 --disable-pinch
