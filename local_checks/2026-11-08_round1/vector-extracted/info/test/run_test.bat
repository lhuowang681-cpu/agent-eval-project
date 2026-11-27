

@echo on

if not exist %LIBRARY_LIB%\vector.dll exit 1
IF %ERRORLEVEL% NEQ 0 exit /B 1
if not exist %LIBRARY_PREFIX%\share\extension\vector--0.8.6.sql exit 1
IF %ERRORLEVEL% NEQ 0 exit /B 1
if not exist %LIBRARY_PREFIX%\share\extension\vector.control exit 1
IF %ERRORLEVEL% NEQ 0 exit /B 1
exit /B 0
