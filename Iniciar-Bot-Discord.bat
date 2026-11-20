@echo off
title Bot Discord - Oferta Steam (IA Open-Source + MCP)
cd /d "%~dp0"

echo ========================================================
echo   Bot de Discord - Oferta Steam + IA Gamer MCP
echo ========================================================
echo.

rem 1. Verificar si Node.js esta disponible
where node >nul 2>nul
if %errorlevel% neq 0 goto :sin_node
goto :verificar_deps

:sin_node
echo [!] Node.js no esta en el PATH del sistema.
if exist "scripts\asegurar-node.bat" (
  call "scripts\asegurar-node.bat"
  where node >nul 2>nul
  if %errorlevel% neq 0 goto :error_node
) else (
  goto :error_node
)

:verificar_deps
rem 2. Verificar dependencias
if not exist "node_modules" goto :instalar_deps
goto :verificar_build

:instalar_deps
echo [*] Instalando dependencias necesarias...
call npm install
if %errorlevel% neq 0 goto :error_npm

:verificar_build
rem 3. Verificar compilacion
if not exist "dist\index.js" goto :compilar
goto :verificar_env

:compilar
echo [*] Compilando servidor MCP oferta-steam...
call npm run build
if %errorlevel% neq 0 goto :error_build

:verificar_env
rem 4. Verificar archivo de configuracion .env
if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [*] Se ha creado el archivo .env a partir de .env.example.
  )
)

findstr /i /c:"DISCORD_BOT_TOKEN=" .env >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] AVISO: No se encontro la clave DISCORD_BOT_TOKEN en tu archivo .env.
  echo     Abre el archivo .env y pega tu token del bot de Discord.
  echo.
  pause
)

echo [*] Iniciando Bot de Discord conectado al MCP oferta-steam e IA Libre...
echo.
node scripts/bot-discord.mjs
if %errorlevel% neq 0 (
  echo.
  echo [ERROR] El bot se ha detenido. Revisa el mensaje superior.
  pause
)
exit /b 0

:error_node
echo [ERROR] Se requiere Node.js LTS para ejecutar el bot.
echo Descargalo desde https://nodejs.org
pause
exit /b 1

:error_npm
echo [ERROR] No se pudieron instalar las dependencias con npm.
pause
exit /b 1

:error_build
echo [ERROR] Fallo la compilacion de TypeScript.
pause
exit /b 1
