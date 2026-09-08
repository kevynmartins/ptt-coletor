# PTT Coletor

Sistema próprio de push-to-talk (walkie-talkie) para os coletores Android, funcionando 100% na
rede WiFi local — sem custo de licença e sem depender de internet.

Duas partes:

- `server/` — servidor relay (Node.js). Roda em um PC/notebook/mini-PC ligado na mesma rede WiFi.
- `android/` — app Android instalado nos coletores.

## 1. Rodar o servidor

Requer Node.js 18+ instalado na máquina que vai hospedar o servidor.

```
cd server
npm install
npm run build
npm start
```

O servidor sobe na porta `8787` e mostra no console os canais disponíveis (Canal 1 a Canal 5).
Ele também se anuncia na rede via mDNS (serviço `_ptt._tcp`), para o app encontrar
automaticamente.

Para descobrir o IP da máquina na rede local (necessário se a descoberta automática não
funcionar e for preciso digitar o endereço manualmente no app):

```
ipconfig        # Windows — veja o "Endereço IPv4" do adaptador WiFi/Ethernet
```

Deixe essa máquina ligada e na mesma rede WiFi dos coletores enquanto o pessoal estiver usando o
PTT. Para rodar em segundo plano no Windows, pode usar `pm2` ou apenas deixar o terminal aberto.

### Senha do painel de administrador

Se a variável de ambiente `ADMIN_PASSWORD` não estiver definida, o servidor gera uma senha
aleatória a cada início e mostra no console (`Senha gerada para esta sessão: ...`). Para fixar
uma senha permanente:

```
# Windows (PowerShell), antes de "npm start":
$env:ADMIN_PASSWORD = "sua-senha-aqui"
npm start
```

## 2. Instalar o app nos coletores

O projeto Android fica em `android/`. Para gerar o APK de debug:

```
cd android
gradle assembleDebug
```

O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`.

Instalar em um coletor conectado via USB (com depuração USB habilitada) ou já pareado por
`adb connect`:

```
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Ou copie o APK para o coletor (pen drive, compartilhamento de rede, e-mail) e instale
manualmente — pode ser necessário habilitar "instalar de fontes desconhecidas" no coletor.

## 3. Criar os usuários dos coletores

Antes de qualquer coletor conseguir entrar, é preciso cadastrar um usuário e senha para ele no
painel de administrador (aba "Usuários", veja abaixo) — o app não deixa mais entrar só digitando
um nome livre. Ao criar (ou editar depois) o usuário, dá pra escolher o **canal padrão** dele —
é para onde a pessoa vai automaticamente ao logar. **Só o administrador decide o canal de cada
coletor** — o operador não escolhe nem troca de canal sozinho no app.

## 4. Usar o app

1. Abra o app "PTT Coletor" no coletor.
2. Digite o usuário e a senha cadastrados pelo administrador, e o nome de exibição (já vem
   preenchido igual ao usuário, mas pode trocar).
3. Toque em "Buscar servidor na rede" (auto-descoberta via mDNS) ou digite manualmente
   `IP:8787` do servidor (ex.: `192.168.0.10:8787`).
4. Toque em "Conectar" — a pessoa já entra direto no canal que o administrador definiu para ela
   (o campo "Canal" na tela só mostra em qual canal está, não dá pra tocar para trocar).
5. Segure o botão grande para falar; solte para ouvir os demais. Enquanto alguém estiver
   falando no canal, o botão fica ocupado até a pessoa soltar (só uma pessoa fala por vez, como
   um rádio de verdade).
6. Para falar individualmente com alguém do canal, toque em "Ligar" ao lado do nome da pessoa —
   conecta na hora (sem "atender"), pausa o canal em grupo enquanto durar, e "Encerrar chamada"
   volta pro canal.

O app roda como serviço em primeiro plano (notificação fixa), então continua recebendo áudio
mesmo com a tela apagada, e reconecta automaticamente se a conexão WiFi cair (exceto se a senha
estiver errada — nesse caso ele volta pra tela de login em vez de ficar tentando de novo).

### Botão físico do PTT e uso em segundo plano

Na tela de Configurações do app (ícone de engrenagem):
- **Mapear o botão físico**: configure o botão lateral do coletor no "Key Programmer" (ou
  "Programmable Keys") da Zebra para simular uma tecla, depois toque em "Mapear agora" no app e
  pressione esse botão uma vez — o app aprende automaticamente qual tecla é essa.
- **Ativar o serviço de acessibilidade**: sem isso, o botão físico só funciona com o app na
  tela. Ativando, ele continua funcionando mesmo com outro app aberto (ex.: o app de coleta).
- **Permitir funcionamento em segundo plano**: isenta o app da otimização de bateria do
  sistema, reduzindo o risco de ele ser encerrado com a tela apagada.

## 5. Painel de administrador

Com o servidor rodando, abra `http://<ip-do-servidor>:8787/admin` em qualquer navegador na
mesma rede WiFi (pelo PC ou até pelo navegador de um coletor). Faça login com a senha de
administrador (veja acima). O painel tem três abas:

**Falar e ouvir** — use o microfone e o fone do computador como se fosse mais um coletor; já
entra autenticado como administrador (sem precisar de usuário/senha de conta) e pode escolher
qualquer canal livremente, diferente dos coletores comuns.

**Usuários** — criar, **editar** (trocar senha e/ou canal padrão) e remover as contas que os
coletores usam para logar no app (guardado no banco SQLite `server/data/ptt.db`, senha nunca
fica em texto puro).

**Canais e atividade** — dois blocos juntos nessa aba:
- Ver em tempo real quem está conectado em cada canal e quem está falando.
- Criar, renomear e remover canais (lista salva em `server/data/ptt.db`).
- Ao lado de cada coletor num canal: um seletor para **mover a pessoa para outro canal na hora**
  (é assim que o administrador troca o canal de alguém já conectado — fica salvo como o novo
  canal padrão da conta, não é só para a sessão atual), o botão **Ligar** (chamada individual) e
  **Expulsar** (derruba a conexão — útil se alguém travar um canal segurando o PTT).
- Histórico de atividade (quem falou, em qual canal, por quanto tempo), guardado em
  `server/data/ptt.db`.

### Armazenamento (SQLite)

Usuários, canais e o histórico de atividade ficam num único banco SQLite em
`server/data/ptt.db` (o arquivo é criado sozinho no primeiro início). Basta fazer backup desse
arquivo para preservar tudo. Se o servidor já tinha rodado antes com a versão anterior (que
guardava tudo em `users.json`/`channels.json`/`activity.log`), esses arquivos são migrados
automaticamente para o banco na primeira vez que o servidor novo inicia — não precisa fazer nada
manual.

Quando um canal é removido, os coletores que estavam nele são avisados e ficam sem canal até o
administrador mover cada um para um canal válido (pela aba Canais ou editando o canal padrão da
conta).

## 6. Deploy em produção (Ubuntu)

Para rodar o servidor de forma permanente num servidor Ubuntu (systemd, reinício automático,
etc.), veja o guia em [`deploy/UBUNTU_SETUP.md`](deploy/UBUNTU_SETUP.md).

## Limitações conhecidas / próximos passos

- Áudio trafega sem compressão (PCM cru) — ótimo para qualidade e simplicidade em WiFi local,
  mas usa mais banda que soluções com Opus. Não deve ser um problema em uma rede local comum.
- A senha de login dos coletores trafega no `hello` do WebSocket e a senha do painel trafega na
  URL do WebSocket (`?password=`) — aceitável em rede local fechada (o modelo de confiança deste
  projeto), mas não deve ser exposto direto à internet sem reforçar isso antes.
- Ligar só é possível para quem já aparece no seu canal atual — não existe (ainda) um diretório
  com todos os coletores online de todos os canais.
- Chamada individual não tem fila: se a pessoa já estiver em outra chamada, só retorna "ocupado"
  em vez de esperar.
