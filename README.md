# Caju

SaaS de atendimento empresarial exclusivamente por WhatsApp. Este repositório contém a aplicação web, a API e o esquema PostgreSQL multiempresa.

O estágio atual entrega uma fundação utilizável: cadastro e login reais, sessões revogáveis, recuperação preparada para SMTP, empresa, equipe por convite, departamentos, horários, contatos, etiquetas, respostas rápidas, retornos, auditoria, quatro temas e PWA. A conexão WhatsApp e a central de atendimento são o próximo estágio e aparecem como indisponíveis até existir integração oficial funcional.

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

Comandos:

```bash
npm install
npm run db:migrate
npm run dev:api
npm run dev
npm run build
npm test
npm run test:e2e
```

Os scripts em `scripts/` adaptam esses comandos ao banco privado do Railway. Eles não imprimem credenciais.

## Ambientes

- Web: Vercel, projeto `aionixdev/caju`.
- API e PostgreSQL: Railway, projeto `CAJU`.
- Produção provisória: https://caju-one.vercel.app
- Saúde da API pela mesma origem: https://caju-one.vercel.app/api/health

Consulte [arquitetura](docs/ARCHITECTURE.md), [operação](docs/OPERATIONS.md) e [roadmap](docs/ROADMAP.md).
