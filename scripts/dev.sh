#!/usr/bin/env bash
# ============================================================
#  dev.sh - controle do ambiente local (Linux/Mac)
#  Uso:  ./scripts/dev.sh [start|stop|restart|status|logs|shell|prod|prod-stop]
#  Encapsula o docker compose para o dev nao decorar comandos.
#  Desenvolvimento le o .env.dev (Supabase local + Cloudinary de dev);
#  so prod/prod-stop leem o .env (imagem de producao local).
#  Torne executavel uma vez:  chmod +x scripts/dev.sh
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ACAO="${1:-start}"
PROD_FILE="docker-compose.prod.yml"

# O compose exige o arquivo de ambiente; sem ele a subida falha com erro obscuro.
case "$ACAO" in
  prod|prod-stop) ARQUIVO_ENV=".env" ;;
  *) ARQUIVO_ENV=".env.dev" ;;
esac
if [ ! -f "$ARQUIVO_ENV" ]; then
  echo "[ERRO] Arquivo $ARQUIVO_ENV nao encontrado."
  echo "       Rode:  cp .env.example $ARQUIVO_ENV"
  if [ "$ARQUIVO_ENV" = ".env.dev" ]; then
    echo "       Supabase LOCAL: a URL e a chave anon que 'npx supabase status'"
    echo "       mostra na pasta snake-thai. Cloudinary: o ambiente de DEV."
  else
    echo "       Depois preencha as credenciais do Supabase e da Cloudinary."
  fi
  exit 1
fi

case "$ACAO" in
  start)
    docker compose up -d --build
    docker compose ps
    ;;
  stop)
    docker compose down
    ;;
  restart)
    docker compose down
    docker compose up -d --build
    ;;
  status)
    docker compose ps
    ;;
  logs)
    docker compose logs -f api
    ;;
  shell)
    docker compose exec api sh
    ;;
  prod)
    docker compose -f "$PROD_FILE" up -d --build
    docker compose -f "$PROD_FILE" ps
    ;;
  prod-stop)
    docker compose -f "$PROD_FILE" down
    ;;
  *)
    cat <<'USO'
Uso: ./scripts/dev.sh [start|stop|restart|status|logs|shell|prod|prod-stop]

  start      sobe a API em modo desenvolvimento (hot reload)
  stop       derruba os conteineres
  restart    derruba e sobe de novo
  status     lista os conteineres e a saude deles
  logs       acompanha os logs da API
  shell      abre um shell dentro do conteiner
  prod       sobe a imagem de PRODUCAO local (paridade com a Render)
  prod-stop  derruba a imagem de producao local
USO
    exit 1
    ;;
esac
