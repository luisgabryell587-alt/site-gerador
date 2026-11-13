# Hospedagem em deplexo.com

Este pacote é uma aplicação Node.js/Express com SQLite local por padrão. O diretório `data/` precisa ter permissão de escrita para o usuário que executa o Node.js. Também é possível definir `DATABASE_URL` para o MySQL/MariaDB da hospedagem; nesse modo o snapshot do banco SQLite é armazenado no banco externo.

## Requisitos

- Node.js 20 ou superior
- npm
- Domínio `deplexo.com` apontando para o servidor
- HTTPS configurado no proxy reverso ou painel da hospedagem

## Instalação direta

```bash
unzip deplexo-proxywire.zip -d /var/www/deplexo
cd /var/www/deplexo
cp .env.example .env
npm install --omit=dev
mkdir -p data
chmod 775 data
PORT=3000 npm start
```

Para produção, execute com PM2 ou como serviço systemd e use Nginx/Apache como proxy reverso. O proxy deve encaminhar `https://deplexo.com/` para `http://127.0.0.1:3000/` e manter os headers `Host`, `X-Forwarded-For` e `X-Forwarded-Proto`.

## Docker

```bash
docker build -t deplexo-proxywire .
docker run -d --name deplexo-proxywire --restart unless-stopped \
  -p 3000:3000 \
  -v /var/lib/deplexo/data:/app/data \
  --env-file .env \
  deplexo-proxywire
```

O volume `/app/data` é obrigatório quando estiver usando SQLite, para não perder as keys ao recriar o container.

## Verificação

```bash
curl -i https://deplexo.com/api/health
```

A resposta esperada contém `"ok":true`. O código inicial do dono é `250911`; altere o acesso depois do primeiro login.

As rotas principais são `/`, `/dono`, `/admin`, `/revendedor`, `/api/health`, `/api/proxy/q/validate-key` e `/brevent/validate.php`.
