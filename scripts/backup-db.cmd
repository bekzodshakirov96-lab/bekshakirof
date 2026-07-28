@echo off
REM NOKDAUN database backup (mysqldump).
REM Manual run: double-click this file.
REM Automatic: create a daily task in Windows Task Scheduler pointing to this file.

setlocal
set MYSQL_BIN=C:\xampp\mysql\bin
set DB_NAME=nokdaun_finance
set DB_USER=root
set BACKUP_DIR=%~dp0..\backups

REM Timestamp via PowerShell (the old `wmic` command is gone in newer Windows 11).
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%I

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

echo Backing up %DB_NAME% ...
"%MYSQL_BIN%\mysqldump.exe" -u %DB_USER% --single-transaction --routines --events %DB_NAME% > "%BACKUP_DIR%\nokdaun_%STAMP%.sql"

if errorlevel 1 (
  echo ERROR: backup failed. Check that MySQL is running.
  exit /b 1
)

echo Done: %BACKUP_DIR%\nokdaun_%STAMP%.sql

REM Delete backups older than 30 days so the disk does not fill up.
forfiles /p "%BACKUP_DIR%" /m nokdaun_*.sql /d -30 /c "cmd /c del @path" 2>nul

echo.
echo IMPORTANT: copy these files to another location (external disk or cloud)
echo regularly - if this computer fails, this folder is lost too.
