@echo off
rem ============================================================
rem  dev.bat - controle do ambiente local (Windows)
rem  Uso:  scripts\dev.bat [start^|stop^|restart^|status^|logs^|shell^|prod^|prod-stop]
rem  Encapsula o docker compose para o dev nao decorar comandos.
rem  Desenvolvimento le o .env.dev (Supabase local + Cloudinary de dev);
rem  so prod/prod-stop leem o .env (imagem de producao local).
rem ============================================================
setlocal
cd /d "%~dp0\.."

set "ACAO=%~1"
if "%ACAO%"=="" set "ACAO=start"

rem O compose exige o arquivo de ambiente; sem ele a subida falha com erro obscuro.
set "ARQUIVO_ENV=.env.dev"
if /i "%ACAO%"=="prod"      set "ARQUIVO_ENV=.env"
if /i "%ACAO%"=="prod-stop" set "ARQUIVO_ENV=.env"
if not exist "%ARQUIVO_ENV%" (
  echo [ERRO] Arquivo %ARQUIVO_ENV% nao encontrado.
  echo        Rode:  copy .env.example %ARQUIVO_ENV%
  if /i "%ARQUIVO_ENV%"==".env.dev" (
    echo        Supabase LOCAL: a URL e a chave anon que "npx supabase status"
    echo        mostra na pasta snake-thai. Cloudinary: o ambiente de DEV.
  ) else (
    echo        Depois preencha as credenciais do Supabase e da Cloudinary.
  )
  exit /b 1
)

if /i "%ACAO%"=="start"     ( docker compose up -d --build & docker compose ps & goto fim )
if /i "%ACAO%"=="stop"      ( docker compose down & goto fim )
if /i "%ACAO%"=="restart"   ( docker compose down & docker compose up -d --build & goto fim )
if /i "%ACAO%"=="status"    ( docker compose ps & goto fim )
if /i "%ACAO%"=="logs"      ( docker compose logs -f api & goto fim )
if /i "%ACAO%"=="shell"     ( docker compose exec api sh & goto fim )
if /i "%ACAO%"=="prod"      ( docker compose -f docker-compose.prod.yml up -d --build & docker compose -f docker-compose.prod.yml ps & goto fim )
if /i "%ACAO%"=="prod-stop" ( docker compose -f docker-compose.prod.yml down & goto fim )

echo Uso: scripts\dev.bat [start^|stop^|restart^|status^|logs^|shell^|prod^|prod-stop]
echo.
echo   start      sobe a API em modo desenvolvimento (hot reload)
echo   stop       derruba os conteineres
echo   restart    derruba e sobe de novo
echo   status     lista os conteineres e a saude deles
echo   logs       acompanha os logs da API
echo   shell      abre um shell dentro do conteiner
echo   prod       sobe a imagem de PRODUCAO local (paridade com a Render)
echo   prod-stop  derruba a imagem de producao local
exit /b 1

:fim
endlocal
