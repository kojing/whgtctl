@echo off
rem whgtctl パネルを Illustrator に入れる（Windows）
chcp 65001 > nul
set DEST=%APPDATA%\Adobe\CEP\extensions\whgtctl
if exist "%DEST%" rmdir /S /Q "%DEST%"
xcopy /E /I /Y "%~dp0whgtctl" "%DEST%" > nul
rem 署名していないパネルを読み込めるようにする（CEP 9〜13）
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f > nul
echo 入れました: %DEST%
echo Illustrator を再起動して、ウィンドウ ^> エクステンション（レガシー）^> whgtctl 光学補正 を開いてください。
pause
