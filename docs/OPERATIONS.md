# Operação

## Publicação

A API usa o `Dockerfile` da raiz, executa como usuário sem privilégios e expõe `/api/health`. O frontend usa `vercel.json`, que compila `apps/web` e encaminha `/api/*` ao domínio público da API.

Antes de publicar:

```bash
npm ci
npm run build
node scripts/with-db.mjs test
node scripts/with-db.mjs e2e
```

Aplicar migrations antes da versão que depende delas:

```bash
node scripts/with-db.mjs migrate
```

Depois, publicar e observar o estado terminal `SUCCESS`/`READY`:

```bash
railway up --service api --environment production --detach
vercel deploy --prod --yes
```

## Variáveis

API:

- `DATABASE_URL`: papel restrito da aplicação.
- `APP_URL`: origens permitidas, separadas por vírgula.
- `PORT`: fornecida pelo Railway.
- `NODE_ENV=production`.
- `SMTP_URL` e `MAIL_FROM`: habilitam recuperação por e-mail.

`MIGRATION_DATABASE_URL` não deve permanecer no serviço da API. Ela pertence ao procedimento de migration.

## Diagnóstico

Cada erro inesperado registra rota, request ID, tenant quando conhecido e código técnico, sem corpo nem dados privados. A mensagem apresentada ao usuário inclui o request ID. Para incidentes, correlacione esse código com os logs delimitados do Railway.

Verificações iniciais:

1. `/api/health` responde `status: ok`;
2. deployment da API está `SUCCESS`;
3. Vercel está `READY`;
4. erros HTTP 5xx e logs da operação;
5. conectividade privada API → PostgreSQL.

## Backup, retenção e LGPD

Antes da liberação comercial, habilitar backups/PITR compatíveis com o plano Railway e ensaiar uma restauração em ambiente isolado. Definir contratualmente retenção de mensagens, mídias, auditoria e contas desativadas. A exportação e exclusão de dados pessoais devem preservar obrigações legais e trilha administrativa, com acesso excepcional sempre auditado.

## Pendências externas

- domínio comercial e DNS;
- remetente SMTP verificado;
- conta Meta e número na API oficial do WhatsApp;
- políticas comerciais de planos, retenção e suporte;
- monitoramento externo e alertas de plantão.
