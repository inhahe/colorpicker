@echo off
REM Copy color picker files to D:\github\colorpicker for pushing to GitHub
REM Does NOT delete existing files in the destination

set SRC=D:\visual studio projects\colorpicker
set DST=D:\github\colorpicker

echo Copying to %DST% ...

REM Create directories
if not exist "%DST%" mkdir "%DST%"
if not exist "%DST%\js" mkdir "%DST%\js"

REM Root files
copy /Y "%SRC%\index.html" "%DST%\index.html"
copy /Y "%SRC%\style.css" "%DST%\style.css"
copy /Y "%SRC%\server.py" "%DST%\server.py"
copy /Y "%SRC%\todo.txt" "%DST%\todo.txt"
copy /Y "%SRC%\FEATURES.md" "%DST%\FEATURES.md"

REM JS modules
copy /Y "%SRC%\js\app.js" "%DST%\js\app.js"
copy /Y "%SRC%\js\collections.js" "%DST%\js\collections.js"
copy /Y "%SRC%\js\color-engine.js" "%DST%\js\color-engine.js"
copy /Y "%SRC%\js\gl-renderer.js" "%DST%\js\gl-renderer.js"
copy /Y "%SRC%\js\state.js" "%DST%\js\state.js"
copy /Y "%SRC%\js\ui-3d-v2.js" "%DST%\js\ui-3d-v2.js"
copy /Y "%SRC%\js\ui-harmony.js" "%DST%\js\ui-harmony.js"
copy /Y "%SRC%\js\ui-hex-picker.js" "%DST%\js\ui-hex-picker.js"
copy /Y "%SRC%\js\ui-info.js" "%DST%\js\ui-info.js"
copy /Y "%SRC%\js\ui-output.js" "%DST%\js\ui-output.js"
copy /Y "%SRC%\js\ui-palette.js" "%DST%\js\ui-palette.js"
copy /Y "%SRC%\js\ui-picker-v2.js" "%DST%\js\ui-picker-v2.js"
copy /Y "%SRC%\js\ui-rbf-gradient.js" "%DST%\js\ui-rbf-gradient.js"
copy /Y "%SRC%\js\ui-icc.js" "%DST%\js\ui-icc.js"

REM Docs
copy /Y "%SRC%\TODO-remaining.md" "%DST%\TODO-remaining.md"
copy /Y "%SRC%\copy-to-github.bat" "%DST%\copy-to-github.bat"

echo.
echo Done. %DST% is ready for git push.
