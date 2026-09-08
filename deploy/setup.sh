#!/usr/bin/env bash
# Instala e configura o servidor PTT Coletor num Ubuntu limpo.
# Rode como root (ou com sudo) na primeira instalação:
#   sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR="/opt/ptt-coletor"
SERVICE_USER="ptt"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo bash deploy/setup.sh" >&2
  exit 1
fi

echo "==> Instalando dependências do sistema (Node.js 20, build tools)..."
apt-get update -y
apt-get install -y curl build-essential python3
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Criando usuário de serviço '$SERVICE_USER' (sem login)..."
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"

echo "==> Copiando código para $APP_DIR..."
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude 'data' --exclude '.git' \
  --exclude 'android' \
  "$REPO_DIR"/ "$APP_DIR"/

echo "==> Instalando dependências e compilando o servidor..."
cd "$APP_DIR/server"
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npm run build

if [ ! -f "$APP_DIR/server/.env" ]; then
  echo "==> Gerando senha de administrador e arquivo .env..."
  ADMIN_PW="$(openssl rand -base64 18)"
  cat > "$APP_DIR/server/.env" <<EOF
PTT_PORT=8787
ADMIN_PASSWORD=$ADMIN_PW
EOF
  chmod 600 "$APP_DIR/server/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/server/.env"
  echo ""
  echo "########################################################"
  echo "  Senha de administrador gerada: $ADMIN_PW"
  echo "  Guarde essa senha — ela fica em $APP_DIR/server/.env"
  echo "########################################################"
  echo ""
fi

mkdir -p "$APP_DIR/server/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> Instalando serviço systemd..."
cp "$APP_DIR/deploy/ptt-coletor.service" /etc/systemd/system/ptt-coletor.service
systemctl daemon-reload
systemctl enable ptt-coletor
systemctl restart ptt-coletor

echo "==> Liberando a porta 8787 no firewall (se o ufw estiver ativo)..."
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 8787/tcp
fi

echo ""
echo "==> Pronto! Status do serviço:"
systemctl --no-pager status ptt-coletor || true
echo ""
echo "Painel de administrador: http://<ip-do-servidor>:8787/admin"
echo "Logs em tempo real: journalctl -u ptt-coletor -f"
