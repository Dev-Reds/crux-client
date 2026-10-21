@echo off
rem Startet den Crux Client im Entwicklungsmodus (Electron).
rem Der Ordner muss node_modules enthalten -> einmalig: npm install
cd /d "%~dp0"
npm start
