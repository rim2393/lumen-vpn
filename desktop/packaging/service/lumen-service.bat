@echo off
set APP_HOME=%~dp0..
set JAVA_EXE=%APP_HOME%\jre\bin\java.exe
if not exist "%JAVA_EXE%" set JAVA_EXE=java
"%JAVA_EXE%" -cp "%APP_HOME%\lib\*" tel.lumentech.vpn.desktop.WindowsServiceKt
