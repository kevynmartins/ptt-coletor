# Deploy em produção (Ubuntu)

Este guia coloca o servidor PTT rodando como serviço systemd num Ubuntu Server, reiniciando
sozinho se cair e subindo automaticamente quando a máquina reiniciar.

O app Android **não** faz parte deste deploy — ele continua sendo instalado manualmente nos
coletores (veja o README principal), só apontando para o IP/porta deste servidor.

## 1. Enviar o código para o servidor

Na sua máquina, com o repositório já clonado do GitHub:

```bash
git clone <url-do-repositorio-github> ptt-coletor
scp -r ptt-coletor usuario@ip-do-servidor:/tmp/ptt-coletor
```

Ou, direto no servidor via SSH:

```bash
ssh usuario@ip-do-servidor
git clone <url-do-repositorio-github> /tmp/ptt-coletor
```

## 2. Rodar o instalador

Ainda com uma sessão SSH aberta no servidor:

```bash
cd /tmp/ptt-coletor
sudo bash deploy/setup.sh
```

O script faz tudo automaticamente:
- Instala Node.js 20 e as ferramentas de build necessárias (o `better-sqlite3` compila um
  módulo nativo na instalação).
- Cria um usuário de sistema `ptt` (sem shell de login) para rodar o serviço, sem privilégios
  desnecessários.
- Copia o código para `/opt/ptt-coletor` (fica separado da pasta temporária do clone).
- Roda `npm ci` e `npm run build` no servidor.
- Gera uma senha de administrador aleatória e salva em `/opt/ptt-coletor/server/.env`
  (só na primeira vez — se rodar de novo, mantém a senha já gerada).
- Instala e ativa o serviço systemd `ptt-coletor`, configurado para iniciar sozinho no boot e
  reiniciar automaticamente se o processo cair.
- Libera a porta `8787/tcp` no firewall (`ufw`), se estiver ativo.

Ao final ele mostra a senha de administrador gerada — **anote**, ela só aparece nessa primeira
execução (depois fica só no arquivo `.env`, que tem permissão restrita).

## 3. Confirmar que está no ar

```bash
sudo systemctl status ptt-coletor
curl http://localhost:8787/health
```

Painel de administrador: `http://<ip-do-servidor>:8787/admin`

## Comandos úteis do dia a dia

```bash
sudo systemctl restart ptt-coletor      # reiniciar o serviço
sudo systemctl stop ptt-coletor         # parar
sudo journalctl -u ptt-coletor -f       # acompanhar os logs em tempo real
```

## Atualizar para uma versão nova do código

```bash
cd /tmp/ptt-coletor   # ou clone de novo se já tiver apagado
git pull
sudo bash deploy/setup.sh   # reaplica tudo (não mexe na senha nem no banco já existentes)
```

O banco SQLite (`/opt/ptt-coletor/server/data/ptt.db`, com usuários/canais/histórico) e o
arquivo `.env` (senha de admin) **não são apagados** ao reaplicar o setup — só o código é
atualizado.

## Backup

Basta copiar um arquivo para preservar todos os dados (usuários, canais, histórico):

```bash
sudo cp /opt/ptt-coletor/server/data/ptt.db ~/ptt-backup-$(date +%F).db
```

## Segurança / rede

- Este servidor foi desenhado para redes locais fechadas (WiFi da empresa). Se for expor a
  porta 8787 para a internet, coloque um proxy reverso com HTTPS na frente (ex.: nginx +
  Let's Encrypt) — a senha de admin e as senhas de login hoje trafegam sem TLS.
- O arquivo `/opt/ptt-coletor/server/.env` guarda a senha de administrador em texto puro;
  garanta que só o usuário `ptt`/root tenha acesso a ele (o `setup.sh` já aplica
  `chmod 600`).
