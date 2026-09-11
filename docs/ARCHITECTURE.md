# Arquitetura

## Limites do sistema

`apps/web` é uma SPA React/Vite servida pela Vercel. O navegador usa somente `/api`; a Vercel encaminha as chamadas para a API Fastify no Railway. A API é a única camada com acesso ao PostgreSQL. Essa origem única simplifica cookies, CSRF e deploy de frontend.

`apps/api` agrupa autenticação e domínios operacionais. Os contratos HTTP são validados com Zod. Operações que alteram mais de um registro usam uma transação. Eventos administrativos e operacionais relevantes geram `audit_events` na mesma transação da alteração.

## Isolamento multiempresa

Toda tabela operacional possui `tenant_id`. Chaves estrangeiras compostas impedem associações entre empresas. A API abre uma transação e executa `set_config('caju.tenant_id', tenant, true)` antes de consultar dados. O valor dura somente naquela transação.

PostgreSQL aplica Row Level Security e `FORCE ROW LEVEL SECURITY` em todas as tabelas operacionais. A conexão da API usa `caju_app`, criado como `NOSUPERUSER NOBYPASSRLS`. Consultas sem tenant falham fechadas. Funções de autenticação anteriores à escolha do tenant expõem somente o mínimo necessário e usam `SECURITY DEFINER` com `search_path` fixo.

O isolamento possui quatro camadas complementares:

1. sessão vinculada ao usuário e à empresa;
2. permissão verificada em cada rota;
3. tenant fixado na transação;
4. RLS e chaves compostas no banco.

## Autenticação e segurança

Senhas usam `scrypt` com sal aleatório. Tokens de sessão, convite e recuperação têm 256 bits aleatórios e o banco guarda somente SHA-256. Cookies são `HttpOnly`, `SameSite=Lax` e `Secure` em produção. Sessões expiram em sete dias e também por 24 horas sem atividade; alteração de senha revoga as anteriores.

Mutações exigem cabeçalho próprio e origem permitida. Helmet, CSP na Vercel, limite de corpo, timeouts, rate limit persistido e mensagens sem enumeração de conta completam a fundação. Logs removem corpo, cookies e autorização.

Perfis fornecem conjuntos iniciais de permissões, porém a associação guarda permissões adicionais em JSON para evolução sem depender apenas dos três nomes fixos.

## Dados e desempenho

Contatos e retornos possuem índices alinhados às consultas atuais. Listas usam paginação limitada. A API usa pool pequeno e `statement_timeout` por transação. O limite de plano é verificado após bloquear a empresa, evitando ultrapassagem por requisições simultâneas.

A PWA guarda somente a tela offline e a imagem da marca. Documentos autenticados e respostas da API nunca entram no cache do service worker.

## Integração WhatsApp planejada

A integração oficial terá credenciais cifradas, verificação de assinatura do webhook, idempotência por ID externo, inbox/outbox persistentes, ordenação por timestamp do canal, reconciliação de entrega, mídia em armazenamento privado e eventos de conexão observáveis. Nenhuma tela de inbox será liberada antes desse ciclo funcionar com um número real.
