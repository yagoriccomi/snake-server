#!/usr/bin/env bash
# ============================================================
#  dev.sh - controle do ambiente local (Linux/Mac)
#  Uso:  ./scripts/dev.sh [start|stop|restart|status|logs|shell|prod|prod-stop]
#  Encapsula o docker compose para o dev nao decorar comandos.
#  Toda a config vem do .env (fonte unica de verdade).
#  Torne executavel uma vez:  chmod +x scripts/dev.sh
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ACAO="${1:-start}"
PROD_FILE="docker-compose.prod.yml"

# O compose exige o .env; sem ele a subida falha com erro obscuro.
if [ ! -f ".env" ]; then
  echo "[ERRO] Arquivo .env nao encontrado."
  echo "       Rode:  cp .env.example .env"
  echo "       Depois preencha as credenciais do Supabase e da Cloudinary."
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
