# Operação

## Desenvolvimento e validação local

`scripts/local.mjs` sobe um PostgreSQL embutido privado (`.local/`, fora do git) com o papel `caju_app` e aplica as migrations. Nenhuma credencial do Railway participa.

```bash
node scripts/local.mjs dev    # API em 3001 + web em 5173, banco persistente em .local/development
node scripts/local.mjs test   # testes de integração em banco descartável
node scripts/local.mjs e2e    # Playwright desktop + mobile, com axe em quatro temas
```

## Publicação

A API usa o `Dockerfile` da raiz, executa como usuário sem privilégios e expõe `/api/health`. O frontend usa `vercel.json`, que compila `apps/web` e encaminha `/api/*` ao domínio público da API.

**A migration precisa chegar ao banco antes do código novo atender tráfego.** As migrations são aditivas (colunas, tabelas e constraints mais amplas), então o código anterior continua funcionando no esquema novo; o contrário não vale — código novo em esquema antigo perde mensagens recebidas em silêncio (o WhatsApp confirma a entrega ao gateway e não reenvia). Por isso o comando de boot do serviço (`railway.json`) é `node apps/api/dist/migrate.js && npm start`: quando `MIGRATION_DATABASE_URL` está presente, as migrations rodam antes de o servidor abrir a porta; quando está ausente ou esvaziada, o boot segue sem tocar no esquema.

`scripts/release.mjs` executa a sequência inteira e é a forma recomendada de publicar:

```bash
node scripts/release.mjs --dry-run   # mostra os passos sem alterar nada
node scripts/release.mjs             # API + web + smoke tests
```

O que ele faz, na ordem: typecheck e build; coloca `MIGRATION_DATABASE_URL` (a `DATABASE_URL` do serviço Postgres) no serviço `api` com `--skip-deploys`; `railway up --detach`; aguarda o deployment terminar em `SUCCESS` (falha em `FAILED`/`CRASHED`); esvazia a variável de volta (um marcador que `migrate.js` reconhece como "nada a aplicar"; `variable delete` dispararia outro deploy); confere `/api/health` na API pública; `vercel deploy --prod --yes`; confere `/api/health` pela origem da Vercel. Se o deployment falhar, a variável é esvaziada mesmo assim e o deploy anterior continua no ar.

Depois de `SUCCESS`, dois pontos que o smoke test não enxerga:

1. **A sessão do WhatsApp volta sozinha, mas não na hora.** O container novo só assume a conexão quando a concessão do container antigo expira (até 45 s após ele ser removido) e a varredura periódica a recolhe. Abra Configurações → WhatsApp e confirme que o estado volta a "conectado" sem pedir um novo QR Code, e que mensagens enfileiradas durante a troca saem. Só então a publicação está funcionando, não apenas publicada.
2. **Publique em horário calmo na primeira vez que uma migration mexer em `messages`.** A 006 recria a constraint de status (varredura da tabela com lock exclusivo) e cria índices sem `CONCURRENTLY`; em tabelas pequenas leva milissegundos, mas durante o lock as mensagens recebidas pelo container antigo ficam aguardando.

Manualmente, os comandos equivalentes são:

```bash
railway variable set MIGRATION_DATABASE_URL --stdin --service api --skip-deploys   # cole a URL do Postgres
railway up --service api --environment production --detach
railway deployment list --service api --json                                      # até SUCCESS
railway variable set MIGRATION_DATABASE_URL --stdin --service api --skip-deploys   # esvaziada-apos-publicacao
npx -y vercel@latest deploy --prod --yes
```

## Variáveis

API:

- `DATABASE_URL`: papel restrito da aplicação.
- `APP_URL`: origens permitidas, separadas por vírgula.
- `PORT`: fornecida pelo Railway.
- `NODE_ENV=production`.
- `WHATSAPP_SESSION_KEY`: 32 bytes aleatórios em base64; cifra credenciais e chaves do aparelho vinculado. Rotação exige um procedimento de recifragem e nunca deve ser feita apagando o valor antigo.
- `SMTP_URL` e `MAIL_FROM`: habilitam recuperação por e-mail.

`MIGRATION_DATABASE_URL` só existe no serviço da API durante uma publicação; `scripts/release.mjs` a esvazia ao final. Um valor que não seja uma URL `postgresql://` significa "nenhuma migration a aplicar".

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

## Retenção de mídia

Anexos recebidos e enviados ficam em `message_media.content` (`bytea`, até 10 MB por mensagem) sob RLS, sem cota por empresa nem limpeza automática. Antes da liberação comercial, definir retenção (por exemplo, remover o conteúdo de mídia com mais de 90 dias mantendo o registro da mensagem) e acompanhar `pg_total_relation_size('message_media')`: acima de 5 GB o volume do Railway e o tempo de backup passam a pesar. A alternativa estrutural é mover o conteúdo para um bucket privado com URLs assinadas.

## Pendências externas

- domínio comercial e DNS;
- remetente SMTP verificado;
- número real de WhatsApp para o gate de conexão, mensagens e mídia;
- políticas comerciais de planos, retenção e suporte;
- monitoramento externo e alertas de plantão.
