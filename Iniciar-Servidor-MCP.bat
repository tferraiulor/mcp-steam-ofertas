@echo off
title Servidor MCP - Oferta Steam
cd /d "%~dp0"

echo ========================================================
echo   Servidor MCP: Oferta Steam (Stdio)
echo ========================================================
echo.
echo Iniciando servidor en modo Stdio...
echo (Este modo es utilizado por Claude Desktop, Cursor, Opencode y el Bot de Discord)
echo.
node dist/index.js
pause
