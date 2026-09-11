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

## Gateway WhatsApp por QR Code

O caminho principal vincula o Caju como aparelho multidispositivo por meio do Baileys 7. As credenciais e chaves Signal são serializadas com suporte a buffers e cifradas individualmente com AES-256-GCM antes de chegar ao PostgreSQL. `WHATSAPP_SESSION_KEY` permanece somente no serviço. O QR existe apenas na memória e expira rapidamente; nunca é persistido nem escrito em logs.

O gateway mantém uma conexão por número e restaura sessões ativas depois de reinícios. Uma concessão distribuída de 45 segundos, renovada a cada 15 segundos no PostgreSQL, impede duas instâncias sobrepostas durante deploys de controlarem o mesmo número. Uma varredura periódica assume sessões abandonadas quando a concessão expira. Quedas transitórias usam reconexão exponencial com jitter. Logout, sessão inválida e bloqueio tornam-se estados de atenção que exigem novo QR, em vez de ciclos silenciosos. O banco guarda estado, telefone, erro humano e tentativas para diagnóstico. Todos os registros continuam sob RLS; uma função `SECURITY DEFINER` limitada retorna somente tenant e ID necessários para a retomada no boot.

Esta conexão usa um cliente não oficial de WhatsApp Web e pode ser afetada por mudanças ou restrições do WhatsApp. Por isso, não existe promessa técnica de conexão ininterrupta. O produto prioriza atendimento receptivo, impede disparos indiscriminados por desenho e mantém a integração oficial como alternativa futura.

## Inbox, outbox e mídia

Cada mensagem do canal é idempotente por `(tenant, conexão, external_id)`; a conversa é única por `(tenant, conexão, remote_jid)` e guarda prévia, contagem de não lidas, status, responsável, departamento e uma `version` que protege assumir/transferir/finalizar contra alterações simultâneas (`409`). Localização, contato compartilhado e enquete viram texto (`kind` próprio); reações, edições, exclusões e chaves de grupo não entram no histórico. Mídia recebida é baixada com limite de 10 MB, validada pela assinatura do arquivo (não pela extensão) e guardada em `message_media` sob RLS; a rota que a serve exige sessão da empresa dona, força `nosniff` e `no-store`.

O envio é uma fila no próprio PostgreSQL: a rota grava a mensagem como `queued` com `request_id` (idempotência por requisição: repetir a mesma requisição devolve a mesma mensagem, mudar o conteúdo com o mesmo ID devolve `409`). Só o processo que detém a concessão da conexão despacha, uma mensagem por vez com `SKIP LOCKED`; um envio interrompido vira `uncertain` e nunca é reenviado automaticamente, porque o WhatsApp pode ter entregue. Os recibos do canal (`sent`, `delivered`, `read`) avançam o status apenas para frente, inclusive a partir de `uncertain`. Quando alguém da equipe abre a conversa, o gateway confirma leitura ao cliente uma vez por mensagem (`receipted_at`).

Migrations são aditivas e precisam preceder o código que as usa; ver o procedimento em `docs/OPERATIONS.md`.
