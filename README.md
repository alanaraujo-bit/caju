# Caju

SaaS de atendimento empresarial exclusivamente por WhatsApp. Este repositório contém a aplicação web, a API e o esquema PostgreSQL multiempresa.

O estágio atual entrega cadastro e login reais, sessões revogáveis, recuperação preparada para SMTP, empresa, equipe por convite, departamentos, horários, contatos, etiquetas, respostas rápidas, retornos, auditoria, quatro temas e PWA, mais a operação de atendimento: conexão do WhatsApp por QR Code, inbox com histórico, mídia privada, fila de envio durável, notas internas, assumir/transferir/finalizar e recibos de leitura. Ver `docs/ROADMAP.md` para o que já foi validado e o que ainda depende de um número real.

## Desenvolvimento

Requer Node.js 24 e acesso a um PostgreSQL. A aplicação usa duas credenciais diferentes:

- `MIGRATION_DATABASE_URL`: proprietário do banco, usado somente para migrations.
- `DATABASE_URL`: papel `caju_app`, sem superusuário e sem `BYPASSRLS`, usado pela API.

Variáveis locais em `.env`:

```dotenv
DATABASE_URL=postgresql://caju_app:...@localhost:5432/caju
MIGRATION_DATABASE_URL=postgresql://postgres:...@localhost:5432/caju
APP_URL=http://127.0.0.1:5173
PORT=3001
```

Sem PostgreSQL instalado, `scripts/local.mjs` sobe um cluster embutido e privado em `.local/`:

```bash
npm install
node scripts/local.mjs dev    # API + web com banco local persistente
node scripts/local.mjs test   # testes de integração
node scripts/local.mjs e2e    # Playwright desktop + mobile
npm run build
```

Com um PostgreSQL próprio, os comandos diretos continuam valendo: `npm run db:migrate`, `npm run dev:api`, `npm run dev`, `npm test`, `npm run test:e2e`. Publicação: `node scripts/release.mjs` (ver `docs/OPERATIONS.md`).

## Ambientes

- Web: Vercel, projeto `aionixdev/caju`.
- API e PostgreSQL: Railway, projeto `CAJU`.
- Produção provisória: https://caju-one.vercel.app
- Saúde da API pela mesma origem: https://caju-one.vercel.app/api/health

Consulte [arquitetura](docs/ARCHITECTURE.md), [operação](docs/OPERATIONS.md) e [roadmap](docs/ROADMAP.md).
