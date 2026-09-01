# Deploy em produção — NaveSpeak (VPS)

Guia de deploy do NaveSpeak numa VPS própria, exposta na internet pública com
domínio próprio. Cobre do provisionamento do zero até a rotina de
atualização. Todos os comandos assumem **Ubuntu 24.04 LTS**.

> Convenções usadas neste guia:
>
> - `deploy@vps` → comando rodado como o usuário de deploy (não-root).
> - `root@vps` → comando que precisa root (só na fase de provisionamento/hardening).
> - `SEU_DOMINIO` → o domínio real apontando pro IP da VPS (registro `A`).
> - Caminho do projeto na VPS: `/opt/navespeak`.

---

## 1. Visão geral da arquitetura

```
                        Internet
                            │
              ┌─────────────┴─────────────┐
              │        portas públicas      │
              │  80/tcp, 443/tcp (Nginx)    │
              │  40000-40100/udp+tcp        │
              │  (mediasoup, WebRTC direto) │
              └─────────────┬─────────────┘
                            │
     ┌──────────────────────┼───────────────────────────┐
     │                       ▼                             │
     │   Nginx (TLS: Let's Encrypt)                        │
     │   - proxy_pass → 127.0.0.1:PORT (HTTP + WS upgrade) │
     │                       │                             │
     │                       ▼                             │
     │   Node.js (PM2, 1 processo) — 127.0.0.1:PORT        │
     │   Express API + Socket.IO + client estático (dist)  │
     │   + mediasoup workers (portas UDP/TCP do range)     │
     │                       │                             │
     │           ┌───────────┴───────────┐                 │
     │           ▼                       ▼                 │
     │   PostgreSQL (127.0.0.1)   Redis (127.0.0.1)         │
     │   dados persistentes       rate limit/presença/cache │
     │                                                      │
     │                  VPS (Ubuntu 24.04)                  │
     └──────────────────────────────────────────────────────┘
```

Pontos-chave desse desenho, específicos deste projeto:

- **Um único processo Node serve tudo**: API REST (`/api/*`), Socket.IO
  (chat, presença, DM, chamadas) e o build estático do client React
  (`client/dist`), veja `server/src/index.js`. Não existe front-end separado
  em produção — o Nginx só precisa de **um upstream**.
- **mediasoup não passa pelo Nginx.** A sinalização (quem conecta em quem)
  vai por Socket.IO/HTTPS normalmente, mas a mídia (áudio/vídeo/tela) em si é
  WebRTC — os workers mediasoup abrem portas UDP/TCP diretamente
  (`MEDIASOUP_MIN_PORT`–`MEDIASOUP_MAX_PORT`, default `40000`–`40100`, ver
  `server/src/mediasoup/config.js`). Essas portas precisam estar acessíveis
  publicamente e sem proxy.
- **Node nunca fica exposto direto à internet** — só escuta em `127.0.0.1` (ou
  em `0.0.0.0` com o firewall bloqueando acesso externo à porta). O Nginx é o
  único ponto de entrada HTTP(S).

---

## 2. Sistema operacional recomendado

**Ubuntu 24.04 LTS.** Suporte até 2029, pacotes recentes (Node via
NodeSource, PostgreSQL 16, Redis 7 disponíveis diretamente), maior
familiaridade/documentação que alternativas. Debian 12 é uma alternativa
válida (mais minimalista, ciclo de release mais conservador) se você já tem
esse padrão operacional — os comandos deste guia são praticamente idênticos
(mesmo `apt`, `systemd`, `ufw`).

Evite distros não-LTS ou com ciclo de vida curto (você teria que fazer
upgrade de major version com muito mais frequência num servidor de
produção).

---

## 3. Provisionamento inicial da VPS

Ao contratar a VPS (DigitalOcean, Hetzner, Vultr, etc.), escolha:

- Imagem: Ubuntu 24.04 LTS x64.
- Tamanho mínimo recomendado: 2 vCPU / 4 GB RAM (mediasoup + PostgreSQL +
  Redis + Node juntos; suba se o número de salas de voz simultâneas for
  grande — cada worker mediasoup consome CPU proporcional aos streams ativos).
- Configure o DNS: registro `A` de `SEU_DOMINIO` apontando pro IP público da
  VPS, antes de chegar na etapa de TLS (Let's Encrypt precisa o domínio já
  resolvendo).

Primeiro acesso (root, só nesta etapa):

```bash
# no seu computador, copie sua chave pública SSH pra VPS se o provedor não
# já tiver feito isso na criação:
ssh-copy-id root@IP_DA_VPS

ssh root@IP_DA_VPS
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades curl git
```

---

## 4. Hardening básico

```bash
# --- SSH: só chave, sem root, porta não-padrão (opcional mas recomendado) ---
# edite /etc/ssh/sshd_config:
#   PermitRootLogin no
#   PasswordAuthentication no
#   Port 2222              # opcional - reduz scans automatizados na 22
systemctl restart ssh

# --- updates automáticos de segurança ---
dpkg-reconfigure -plow unattended-upgrades

# --- fail2ban: bane IPs com tentativas de força bruta no SSH ---
systemctl enable --now fail2ban

# --- firewall: ver seção 14 para o conjunto completo de regras ---
ufw allow 2222/tcp   # ou 22/tcp se não trocou a porta
ufw enable
```

Não desabilite o firewall do provedor (se houver, ex. "Cloud Firewall") —
mantenha as duas camadas (`ufw` local + firewall do provedor) com as mesmas
regras da seção 14.

---

## 5. Usuário de deploy e permissões

Nunca rode a aplicação como `root`. Crie um usuário dedicado:

```bash
# como root:
adduser deploy
usermod -aG sudo deploy   # sudo só pra comandos pontuais, ver abaixo

# copie sua chave SSH pra esse usuário também:
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

su - deploy
```

Restrinja o `sudo` do `deploy` aos comandos que ele realmente precisa
(reiniciar/recarregar serviços), em vez de sudo irrestrito. Como root:

```bash
visudo -f /etc/sudoers.d/deploy
```

```
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx, /usr/bin/systemctl restart nginx
deploy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart navespeak
```

(a unit `navespeak` é a alternativa systemd da seção 10 — se você for usar
PM2 sob o próprio usuário `deploy`, sem systemd, nem precisa dessa segunda
linha, `pm2 restart` já roda sem sudo.)

O código e o `.env` de produção pertencem ao `deploy`:

```bash
sudo mkdir -p /opt/navespeak
sudo chown deploy:deploy /opt/navespeak
```

---

## 6. Instalação de runtime e dependências

Como `deploy` (com `sudo` quando indicado):

```bash
# --- Node.js 20 LTS via NodeSource (não use o pacote genérico do apt, fica desatualizado) ---
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirme v20.x

# --- PostgreSQL ---
sudo apt install -y postgresql postgresql-contrib

# --- Redis ---
sudo apt install -y redis-server

# --- Nginx ---
sudo apt install -y nginx

# --- Certbot (Let's Encrypt) ---
sudo apt install -y certbot python3-certbot-nginx

# --- PM2 (gerenciador de processo Node) ---
sudo npm install -g pm2
```

---

## 7. Banco de dados

O driver ativo do projeto é **PostgreSQL** (`server/src/config/db.js`, pool
`pg`; o `db.mysql.js`/README mencionam MySQL mas é caminho legado não usado).
O schema já vem com a criação recomendada de um usuário de aplicação com
privilégio mínimo — reuse exatamente isso, nunca conecte a aplicação como
superuser:

```bash
sudo -u postgres createdb navespeak
sudo -u postgres psql -d navespeak -f /opt/navespeak/database/schema-postgre.sql
```

O próprio `schema-postgre.sql` documenta e (comentado) inclui:

```sql
CREATE ROLE navespeak_app WITH LOGIN PASSWORD 'uma-senha-forte-unica';
GRANT CONNECT ON DATABASE navespeak TO navespeak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO navespeak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO navespeak_app;
```

Gere uma senha forte dedicada (`openssl rand -hex 32`) e use exatamente essa
role/senha em `DB_USER`/`DB_PASSWORD` no `.env` de produção (seção 8) — nunca
o usuário `postgres`.

Por padrão o PostgreSQL do Ubuntu já escuta só em `127.0.0.1` — confirme em
`/etc/postgresql/16/main/postgresql.conf` (`listen_addresses = 'localhost'`)
e não mude isso: o banco não deve ser alcançável de fora da VPS.

---

## 8. Variáveis de ambiente e segredos

`server/.env` (nunca commitado — já está no `.gitignore`), permissão restrita
ao dono:

```bash
touch /opt/navespeak/server/.env
chmod 600 /opt/navespeak/server/.env   # dono: deploy, ninguém mais lê
```

Conteúdo (baseado em `server/.env.example`, com os valores de produção):

```env
# ---- Servidor ----
NODE_ENV=production
PORT=4100
CORS_ORIGIN=https://SEU_DOMINIO

# ---- Banco de dados ----
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=navespeak
DB_USER=navespeak_app
DB_PASSWORD=<gerado com: openssl rand -hex 32>

# ---- Autenticação ----
JWT_ACCESS_SECRET=<gerado com: openssl rand -hex 64>
JWT_REFRESH_SECRET=<outro segredo diferente, mesmo comando>
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
COOKIE_SECURE=true

# ---- mediasoup ----
MEDIASOUP_ANNOUNCED_IP=<IP público da VPS>
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=40100

# ---- Redis ----
REDIS_URL=redis://:<senha do requirepass, seção 15>@127.0.0.1:6379
ENABLE_REDIS_ADAPTER=false
```

Pontos que o `server/src/config/env.js` já valida e falha rápido se
faltarem: `DB_PASSWORD`, `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (mínimo 16
caracteres, e **não podem ser iguais** em produção — o processo recusa subir
se forem). `COOKIE_SECURE=true` só funciona corretamente com HTTPS de
verdade na frente (seção 13) — sem isso o cookie de refresh token não seria
enviado pelo navegador.

**Pré-requisito de código antes do primeiro deploy**: adicione
`app.set('trust proxy', 1)` em `server/src/index.js` (perto do
`const app = express()`). Sem isso, atrás do Nginx, o Express não enxerga o
IP real do cliente via `X-Forwarded-For` — o rate limit por IP
(`server/src/middleware/rateLimit.js`) passaria a contar todas as requisições
como vindas do próprio Nginx (`127.0.0.1`), compartilhando o limite entre
todos os usuários em vez de aplicar por pessoa.

`client/.env` **não precisa existir em produção** — em build de produção
(`vite build`), `VITE_API_URL` vazio já significa "mesma origem", e é
exatamente isso que você quer (o próprio Express serve o client).

---

## 9. Build do projeto

Na VPS, como `deploy`:

```bash
cd /opt/navespeak
git clone <url-do-repo> .   # ou git pull, se já clonado
npm install                  # instala os 3 workspaces (server, client, electron)
npm run build:client         # gera client/dist
```

O workspace `electron/` é o cliente desktop — não roda na VPS, `npm install`
na raiz vai instalar as dependências dele também (é inofensivo, mas você não
precisa rodar nada desse workspace no servidor).

Rode a migration/schema (seção 7) antes do primeiro start. Crie o diretório
de uploads, que é gerado em runtime e precisa existir com permissão de
escrita para o processo Node:

```bash
mkdir -p /opt/navespeak/server/uploads
```

---

## 10. Execução do processo em produção

### Opção recomendada: PM2, modo `fork` (instância única)

**Não use o modo `cluster` do PM2 aqui.** Os workers mediasoup já paralelizam
por CPU dentro do próprio processo Node (`server/src/mediasoup/workers.js`,
1 worker por núcleo, até 4), e a reconciliação de presença no boot
(`resetEphemeralPresenceOnBoot` em `server/src/config/redis.js`) assume uma
única instância — em modo `cluster` você teria vários processos Node
disputando a mesma presença/roster de voz sem sticky sessions no Socket.IO,
quebrando o app.

Crie `/opt/navespeak/ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "navespeak",
      cwd: "/opt/navespeak/server",
      script: "src/index.js",
      interpreter: "node",
      instances: 1, // NUNCA 'max'/cluster - ver justificativa acima
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
  ],
};
```

```bash
cd /opt/navespeak
pm2 start ecosystem.config.cjs
pm2 save                 # salva a lista de processos
pm2 startup systemd      # imprime um comando `sudo env PATH=...` - rode-o
                          # uma vez para o PM2 subir sozinho no boot da VPS
```

Operação do dia a dia: `pm2 status`, `pm2 logs navespeak`, `pm2 restart
navespeak`, `pm2 reload navespeak` (reinício com o mínimo de indisponibilidade
possível — como é 1 processo único, ainda há um instante sem servir
requisições; não é zero-downtime real, que exigiria 2+ instâncias).

### Alternativa: `systemd` unit puro

Se preferir não depender do PM2 (menos uma ferramenta pra manter, mais
"nativo" do Linux), crie `/etc/systemd/system/navespeak.service`:

```ini
[Unit]
Description=NaveSpeak server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/navespeak/server
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now navespeak
```

Perde os extras do PM2 (`pm2 monit`, `pm2-logrotate`, reload facilitado) mas
ganha integração total com `journalctl -u navespeak` e o restante do systemd.
Este guia usa PM2 como padrão nos exemplos seguintes; troque
`pm2 restart navespeak` por `sudo systemctl restart navespeak` se escolher
esta rota.

---

## 11. Proxy reverso — Nginx

`/etc/nginx/sites-available/navespeak`:

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO;
    return 301 https://$host$request_uri;   # HTTP -> HTTPS sempre
}

server {
    listen 443 ssl http2;
    server_name SEU_DOMINIO;

    # gerenciado pelo certbot (seção 13) - caminhos preenchidos automaticamente
    ssl_certificate     /etc/letsencrypt/live/SEU_DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/SEU_DOMINIO/privkey.pem;

    client_max_body_size 5m;   # avatar em base64 (limite da app é 3mb no JSON)

    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_http_version 1.1;

        # obrigatório para Socket.IO (WebSocket) funcionar através do proxy
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # conexões de chat/presença ficam abertas o tempo todo - timeout
        # generoso evita que o Nginx derrube sockets ociosos
        proxy_read_timeout 75s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/navespeak /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 12. Apache vs Nginx — análise e recomendação

**Recomendação: Nginx. Apache não é necessário neste projeto.**

Por quê:

- Não há PHP, `.htaccess` de terceiros, nem nenhum outro uso típico de Apache
  neste stack — é um único processo Node servindo API + WebSocket + estáticos.
- O Nginx configura upgrade de WebSocket (`Upgrade`/`Connection: upgrade`)
  de forma direta, como mostrado na seção 11 — essencial pro Socket.IO
  (chat, presença, sinalização de voz/tela ficam conectados o tempo todo).
  O Apache também consegue, via `mod_proxy_wstunnel` + `mod_proxy_http`, mas
  é módulo extra pra habilitar sem nenhum ganho aqui.
- Nginx tende a ter overhead menor sob muitas conexões _long-lived_
  simultâneas (exatamente o padrão de uma sala de voz/chat com vários
  usuários conectados o tempo todo) — arquitetura orientada a eventos vs. o
  modelo tradicional de processos/threads do Apache (mod_prefork/mpm_event
  reduz isso, mas ainda é mais configuração para igualar o comportamento
  padrão do Nginx).

Quando _usar_ Apache faria sentido (não é o caso aqui, mas para referência
futura): você já tem um parque de aplicações legadas rodando em Apache
(outros vhosts, `.htaccess` herdado de outro sistema), ou a equipe já domina
Apache profundamente e prefere não introduzir uma segunda ferramenta. Nenhum
desses cenários se aplica ao NaveSpeak hoje.

---

## 13. HTTPS/TLS

```bash
sudo certbot --nginx -d SEU_DOMINIO
```

O Certbot edita o `server_name`/bloco `443` automaticamente e configura
renovação. Confirme o timer automático (o pacote `certbot` do Ubuntu já
instala um):

```bash
systemctl status certbot.timer
sudo certbot renew --dry-run    # testa a renovação sem esperar expirar
```

Com HTTPS ativo na frente:

- `COOKIE_SECURE=true` no `.env` (seção 8) passa a funcionar — o navegador só
  envia o cookie do refresh token em conexões HTTPS.
- `app.set('trust proxy', 1)` (seção 8) faz o Express confiar no
  `X-Forwarded-Proto`/`X-Forwarded-For` que o Nginx envia.
- `CORS_ORIGIN=https://SEU_DOMINIO` (não `http://`) no `.env`.

---

## 14. Firewall e portas expostas

| Porta                        | Serviço                  | Exposição                                       |
| ---------------------------- | ------------------------ | ----------------------------------------------- |
| 2222 (ou 22)                 | SSH                      | **Pública**, só chave                           |
| 80/tcp                       | Nginx (redirect HTTPS)   | **Pública**                                     |
| 443/tcp                      | Nginx (TLS)              | **Pública** — único ponto de entrada HTTP(S)    |
| 40000–40100/udp+tcp          | mediasoup (mídia WebRTC) | **Pública** — obrigatório, não passa por proxy  |
| 4100 (ou o `PORT` escolhido) | Node/Express             | **Interna** — só `127.0.0.1`, nunca no firewall |
| 5432                         | PostgreSQL               | **Interna** — só `127.0.0.1`, nunca no firewall |
| 6379                         | Redis                    | **Interna** — só `127.0.0.1`, nunca no firewall |

Como proteger a aplicação sem expor a porta do Node diretamente: o Node só
precisa aceitar conexões vindas do próprio Nginx, que já está na mesma
máquina — então ele escuta em `127.0.0.1:PORT` (comportamento padrão do
`http.createServer(...).listen(PORT)` em `server/src/index.js`, que já
funciona assim sem mudança) e o firewall **nunca abre essa porta pra fora**.
O Nginx conversa com o Node por loopback (`proxy_pass
http://127.0.0.1:4100`), e é o único processo que fala com a internet nas
portas 80/443.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

sudo ufw allow 2222/tcp        # SSH (ajuste se manteve a 22)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 40000:40100/udp
sudo ufw allow 40000:40100/tcp

sudo ufw enable
sudo ufw status verbose
```

Note que 5432 e 6379 **não aparecem** nas regras — é assim que eles ficam
inacessíveis de fora: nem entram na allowlist, e por padrão o PostgreSQL e o
Redis do Ubuntu já escutam só em `127.0.0.1` (confirme isso — é a segunda
camada de proteção, redundante com o firewall).

---

## 15. Redis em produção

`server/src/config/redis.js` usa o Redis para rate limit compartilhado (com
fail-open — se o Redis cair, o app não trava, só para de limitar), presença
online/offline, cache de histórico de mensagens (TTL curto) e,
opcionalmente, o adapter do Socket.IO para multi-instância
(`ENABLE_REDIS_ADAPTER`, hoje `false` — instância única). Como nada disso é
fonte de verdade (tudo tolera perda), a config de produção prioriza
segurança e simplicidade sobre durabilidade:

`/etc/redis/redis.conf`:

```conf
bind 127.0.0.1 -::1
requirepass <senha forte, ex.: openssl rand -hex 32>

maxmemory 256mb
maxmemory-policy allkeys-lru   # sob pressão de memória, descarta o menos
                                 # usado - o código já trata cache miss/erro
                                 # de Redis sem quebrar (fail-open)

save 900 1                      # snapshot RDB básico - evita perder tudo
                                 # num restart; não é crítico, dados são
                                 # efêmeros por natureza (rate limit/presença)

rename-command FLUSHALL ""      # opcional: reduz o dano de um comando
rename-command FLUSHDB ""       # perigoso executado por engano/vazamento
```

```bash
sudo systemctl restart redis-server
```

No `.env` (seção 8): `REDIS_URL=redis://:<mesma senha>@127.0.0.1:6379`.

---

## 16. Logs, monitoramento e backup

### Logs

```bash
pm2 install pm2-logrotate     # PM2 não rotaciona logs por padrão
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

Nginx já rotaciona via `logrotate` padrão do Ubuntu
(`/etc/logrotate.d/nginx`, nada a fazer). PostgreSQL loga em
`/var/log/postgresql/`, também sob `logrotate` padrão.

### Monitoramento

- `pm2 status` / `pm2 monit` — CPU/memória do processo Node em tempo real.
- Healthcheck simples usando o endpoint que já existe
  (`GET /api/health` → `{ ok: true }`, `server/src/index.js`):

```bash
# cron a cada 5 min, alerta se o endpoint não responder 200
*/5 * * * * curl -sf https://SEU_DOMINIO/api/health > /dev/null || echo "NaveSpeak down" | mail -s "Alerta" seu-email@exemplo.com
```

Ou um serviço externo de uptime (UptimeRobot, Better Uptime, etc.) apontado
pra mesma URL — mais simples que manter um cron de alerta por e-mail, e
também detecta a VPS inteira ficar inacessível.

- Não é necessário Prometheus/Grafana para este porte de aplicação — considere
  só se o volume de usuários crescer muito e você precisar de métricas
  históricas mais ricas.

### Backup

```bash
# /opt/navespeak/scripts/backup.sh (crie este script)
#!/bin/bash
set -euo pipefail
DEST=/var/backups/navespeak
DATE=$(date +%F)
mkdir -p "$DEST"

pg_dump -U navespeak_app -h 127.0.0.1 navespeak | gzip > "$DEST/db-$DATE.sql.gz"
tar czf "$DEST/uploads-$DATE.tar.gz" -C /opt/navespeak/server uploads
gpg --symmetric --cipher-algo AES256 --batch --passphrase-file /root/.backup-passphrase \
    -o "$DEST/env-$DATE.gpg" /opt/navespeak/server/.env

# retenção: apaga backups locais com mais de 14 dias (os enviados para fora
# ficam guardados conforme a política do destino externo)
find "$DEST" -mtime +14 -delete
```

```bash
chmod +x /opt/navespeak/scripts/backup.sh
# cron diário, como root ou via sudoers restrito:
0 3 * * * /opt/navespeak/scripts/backup.sh
```

**Envie os backups para fora da VPS** (outro host, object storage tipo S3/
Backblaze, etc. via `rclone`/`aws s3 cp`) — um backup que só existe na mesma
máquina não protege contra perda do VPS inteiro. Retenção sugerida: 7 diários

- 4 semanais no destino externo.

---

## 17. Rotina segura de atualização/deploy

Recomendado: tags/releases Git em vez de deploy direto de commits soltos na
branch principal — facilita rollback preciso.

```bash
cd /opt/navespeak
git fetch --tags
git checkout <tag-da-release>       # ex.: v1.2.0

npm install                          # pega dependências novas, se houver
npm run migrate --workspace server   # só se a release trouxer migration nova
npm run build:client                 # rebuild do client

pm2 reload navespeak                 # ou: sudo systemctl restart navespeak

curl -sf https://SEU_DOMINIO/api/health   # smoke test pós-deploy
```

**Rollback**, se algo quebrar:

```bash
cd /opt/navespeak
git checkout <tag-anterior-estavel>
npm install
npm run build:client
pm2 reload navespeak
```

(rollback de banco — se a release quebrada incluiu uma migration destrutiva
— exige restaurar do backup da seção 16; migrations aditivas/reversíveis são
mais seguras de reverter só voltando o código.)

Nunca edite código direto na VPS fora desse fluxo (`git checkout` +
build) — mudanças manuais somem no próximo deploy e tornam o rollback
imprevisível.

---

## 18. Checklist de produção

- [ ] DNS: `SEU_DOMINIO` resolvendo para o IP da VPS
- [ ] SSH: só chave, root desabilitado, porta não-padrão (opcional)
- [ ] `fail2ban` e `unattended-upgrades` ativos
- [ ] Usuário `deploy` não-root, dono de `/opt/navespeak`, sudo restrito a comandos específicos
- [ ] Node.js 20 LTS, PostgreSQL, Redis, Nginx, Certbot, PM2 instalados
- [ ] `schema-postgre.sql` aplicado; role `navespeak_app` com privilégio mínimo (nunca superuser)
- [ ] `server/.env` criado com `chmod 600`, segredos gerados via `openssl rand`, `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`
- [ ] `COOKIE_SECURE=true`, `CORS_ORIGIN=https://SEU_DOMINIO`, `MEDIASOUP_ANNOUNCED_IP=<IP público>`
- [ ] `app.set('trust proxy', 1)` adicionado em `server/src/index.js`
- [ ] `npm run build:client` executado, `client/dist` gerado
- [ ] `server/uploads/` criado, com permissão de escrita
- [ ] PM2 rodando em modo `fork`/1 instância (`ecosystem.config.cjs`), `pm2 save` + `pm2 startup` configurados
- [ ] Nginx com proxy reverso + upgrade de WebSocket configurado, `nginx -t` sem erro
- [ ] TLS via Certbot ativo, `certbot renew --dry-run` OK, redirect 80→443
- [ ] `ufw`: só 22/2222, 80, 443, 40000-40100 (udp+tcp) públicas; Node/Postgres/Redis só em `127.0.0.1`
- [ ] Redis com `bind 127.0.0.1`, `requirepass`, `maxmemory`+`allkeys-lru`
- [ ] `pm2-logrotate` instalado; healthcheck (`/api/health`) monitorado (cron ou serviço externo)
- [ ] Backup diário (DB + uploads + `.env` cifrado) automatizado e **enviado para fora da VPS**
- [ ] Fluxo de deploy testado (`git checkout <tag>` → build → `pm2 reload` → smoke test) e rollback documentado/testado pelo menos uma vez

---

## 19. Stack final recomendada

| Camada                    | Escolha                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| SO                        | Ubuntu 24.04 LTS                                                                             |
| Runtime                   | Node.js 20 LTS (NodeSource)                                                                  |
| Processo                  | PM2, modo `fork`, 1 instância (alternativa: `systemd` unit)                                  |
| Proxy reverso             | **Nginx** (não Apache)                                                                       |
| TLS                       | Let's Encrypt via Certbot, plugin Nginx                                                      |
| Banco de dados            | PostgreSQL 16, usuário de aplicação com privilégio mínimo                                    |
| Cache/rate limit/presença | Redis 7, `bind 127.0.0.1` + `requirepass`                                                    |
| Firewall                  | `ufw` (22/2222, 80, 443, 40000-40100 udp+tcp públicas; resto interno)                        |
| WebRTC                    | mediasoup, portas UDP/TCP 40000-40100 públicas, `MEDIASOUP_ANNOUNCED_IP` = IP público da VPS |
| Backup                    | `pg_dump` + `uploads/` + `.env` cifrado, diário, enviado para fora da VPS                    |
| Monitoramento             | `pm2 monit`/`pm2 status` + healthcheck em `/api/health`                                      |
