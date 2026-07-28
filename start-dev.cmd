@echo off
cd /d %~dp0
set NODE_ENV=development
"%~dp0node_modules\.bin\tsx.CMD" server/_core/index.ts < NUL
