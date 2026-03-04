# TESS Face Security

MVP de seguranca para eventos com:

- reconhecimento facial assistido (webcam + `face-api.js` no navegador);
- API Node.js + MySQL para cadastro de perfis e logs de deteccao;
- IA operacional **TESS** usando OpenAI para analise de risco e recomendacoes.
- HUD estilo \"jarvis\" com graficos em tempo real e auto-scan continuo.

## Importante (uso responsavel)

- Use apenas com base legal e consentimento (LGPD).
- Mantenha validacao humana na decisao final.
- Reconhecimento facial pode gerar falso positivo.
- Este projeto e educacional/MVP, nao substitui sistema de seguranca profissional certificado.

## Arquitetura

- `public/`: painel web (HUD, camera, charts, cadastro, identificacao, TESS).
- `src/server.js`: API HTTP + arquivos estaticos.
- `src/services/recognition.js`: comparacao de embeddings faciais.
- `src/services/tess.js`: integracao com OpenAI.
- `src/services/profiles.js`: repositorio MySQL.
- `src/db.js`: conexao e schema.

## HUD em tempo real (v2)

- Overlay visual sobre a camera com box da face detectada.
- Auto-scan periodico para reconhecimento continuo.
- Graficos operacionais:
  - sinal facial e confianca;
  - match vs sem match (janela 1h);
  - timeline de deteccoes por bucket de tempo;
  - distribuicao por categoria (staff/vip/blocked/guest/unknown).
- Medidor de risco dinamico (LOW/MEDIUM/HIGH/CRITICAL).

## Como funciona o reconhecimento

1. O navegador captura o rosto e gera um descriptor numerico (embedding).
2. O backend compara com embeddings cadastrados (distancia euclidiana).
3. Se a distancia for menor que `RECOGNITION_THRESHOLD`, retorna match.
4. Toda tentativa gera log em `detections`.

## Variaveis de ambiente

Copie `.env.example` para `.env`:

```bash
cp .env.example .env
```

Principais variaveis:

- `DATABASE_URL` (ou `MYSQLHOST`, `MYSQLUSER`, `MYSQLDATABASE`...)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4.1-mini`)
- `RECOGNITION_THRESHOLD` (default recomendado: `0.5`)

## Rodar localmente

1. Instale dependencias:

```bash
npm install
```

2. Suba um MySQL local:

```bash
docker run --name tess-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=tess_security \
  -p 3306:3306 \
  -d mysql:8.0
```

3. Inicie o servidor:

```bash
npm start
```

4. Abra no navegador:

- `http://localhost:3000`

## Endpoints principais

- `GET /health`
- `GET /api/status`
- `GET /api/profiles`
- `POST /api/profiles`
- `DELETE /api/profiles/:id`
- `POST /api/recognition/identify`
- `GET /api/detections`
- `GET /api/analytics/summary`
- `GET /api/analytics/timeline?minutes=90&bucket=3`
- `POST /api/tess/analyze`

## Deploy no Railway

1. Suba este projeto para GitHub.
2. No Railway, `New Project` -> `Deploy from GitHub Repo`.
3. Adicione um servico MySQL no mesmo projeto.
4. Em `Variables` do servico da API, configure:

```txt
DATABASE_URL=${{MySQL.MYSQL_URL}}
OPENAI_API_KEY=sua_chave_openai
OPENAI_MODEL=gpt-4.1-mini
RECOGNITION_THRESHOLD=0.5
```

5. Redeploy.
6. Em `Networking`, gere dominio publico (`*.up.railway.app`).

## Comandos Git (atualizacao)

```bash
cd "/Users/lealx/Documents/New project/tess-face-security"
git add .
git commit -m "feat: neural hud com graficos e auto-scan"
git push
```

## Ideias para evolucao

- cadastrar multiplas fotos por pessoa e media de embeddings;
- fila de alertas em tempo real (WebSocket);
- trilha de auditoria com aprovacao do operador;
- modulo mobile para equipe de campo;
- RBAC por perfil (operador/supervisor/admin);
- criptografia de embeddings em repouso.
