@echo off
title eOfficeGate Updater
color 0b
echo ========================================================
echo               eOfficeGate - 1-Click Updater
echo ========================================================
echo.
cd /d "%~dp0"

echo [1/2] Checking for updates from GitHub...
git pull origin main 2>nul
if %ERRORLEVEL% EQU 0 (
    echo.
    echo Git pull successful!
) else (
    echo Git pull not available. Downloading latest release files via PowerShell...
    powershell -ExecutionPolicy Bypass -Command "& { Write-Host 'Updating extension files...'; $repo='Hackers-lab/eoffice_extension'; $branch='main'; $files=@('manifest.json','content.js','background.js','popup.html','popup.js','options.html'); foreach($f in $files){ Invoke-WebRequest -Uri ('https://raw.githubusercontent.com/' + $repo + '/' + $branch + '/eofficegate/' + $f) -OutFile ('eofficegate\' + $f); Write-Host ('  Updated ' + $f) } }"
)

echo.
echo ========================================================
echo [2/2] Files updated successfully!
echo.
echo Please open chrome://extensions in Chrome and click
echo the Reload (circle arrow) button on eOfficeGate.
echo ========================================================
echo.
pause
