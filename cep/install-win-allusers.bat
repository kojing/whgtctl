@echo off
rem 全ユーザー用の場所に入れる（ユーザー名に全角文字があるときの回避策）。右クリック > 管理者として実行
chcp 65001 > nul
set DEST=C:\Program Files (x86)\Common Files\Adobe\CEP\extensions
if not exist "%DEST%" mkdir "%DEST%"
for %%e in (whgtctl hello) do (
  if exist "%DEST%\%%e" rmdir /S /Q "%DEST%\%%e"
  xcopy /E /I /Y "%~dp0%%e" "%DEST%\%%e" > nul
  if exist "%APPDATA%\Adobe\CEP\extensions\%%e" rmdir /S /Q "%APPDATA%\Adobe\CEP\extensions\%%e"
)
for %%v in (9 10 11 12 13) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f > nul
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v LogLevel /t REG_SZ /d 6 /f > nul
)
echo 入れました: %DEST%
echo Illustrator を再起動してください。
pause
