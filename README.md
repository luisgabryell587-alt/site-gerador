# PROXY WIRE RED — Node.js

Painel de licenças com URLs limpas (sem .php).

## URLs

| Rota | Função |
|------|--------|
| `/` | Ativar key + download |
| `/revendedor` | Painel do revendedor |
| `/admin` | Painel do administrador |
| `/dono` | Painel do dono |
| `/api` | API de validação (para o app) |

## Código do Dono

```
250911
```

## Instalação

```bash
npm install
npm start
```

O servidor sobe em `http://localhost:3000` (ou a porta do `PORT`).

## Formato da Key

Prefixo + caracteres aleatórios **sem hífen**:

```
CLASH0FZ3LG
BIELJ827K9X
```

## API (app)

```bash
curl -X POST http://localhost:3000/api \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","key":"CLASH0FZ3LG","hwid":"DEVICE-ID"}'
```

## Configurações no painel Dono

- Nome e subtítulo do site
- Cor principal (botões, destaques)
- Texto do aviso
- Link do WhatsApp
- URL de download do app
- Preços de cada duração de key

## Deploy

Qualquer host com Node.js 18+:

- Railway
- Render
- VPS (PM2)
- Hostinger Node
- etc.

```bash
npm install
NODE_ENV=production PORT=3000 npm start
```
