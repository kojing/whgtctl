@echo off
rem whgtctl パネルを Illustrator に入れる（Windows）
chcp 65001 > nul
set DEST=%APPDATA%\Adobe\CEP\extensions
if not exist "%DEST%" mkdir "%DEST%"
for %%e in (whgtctl hello) do (
  if exist "%DEST%\%%e" rmdir /S /Q "%DEST%\%%e"
  xcopy /E /I /Y "%~dp0%%e" "%DEST%\%%e" > nul
)
rem 署名していないパネルを読み込めるようにし、原因調査のためのログを出す（CEP 9〜13）
for %%v in (9 10 11 12 13) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f > nul
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v LogLevel /t REG_SZ /d 6 /f > nul
)
echo.
echo 入れました: %DEST%
echo   whgtctl  … ウィンドウ ^> エクステンション（レガシー）^> whgtctl 光学補正
echo   hello    … ウィンドウ ^> エクステンション（レガシー）^> CEP test （緑の画面が出れば CEP は動いています）
echo.
echo ユーザーフォルダー: %USERPROFILE%
echo （ここに日本語などの全角文字が入っていると、パネルが空になることがあります）
echo.
echo Illustrator を再起動してください。
pause
