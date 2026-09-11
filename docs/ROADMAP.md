# Execução do produto

O repositório iniciou vazio. Este arquivo distingue entrega validada de escopo futuro; não substitui os requisitos integrais do proprietário.

## Estágio 1 — fundação e preparação da operação (concluído)

Autenticação, sessão revogável, recuperação real com provedor de e-mail, empresa isolada, autorização granular, onboarding persistido, usuários por convite, departamentos e associação, horários, contatos, etiquetas, mensagens rápidas, auditoria, quatro temas e PWA. Publicação Vercel + Railway. Gate: cadastro → nova sessão → configurar → convidar → aceitar → contato → logout; isolamento e permissões verificados em PostgreSQL real.

## Estágio 2 — atendimento WhatsApp (código completo; gate com número real pendente)

Entregue e coberto por testes de integração e e2e: conexão por QR Code com sessão cifrada, retomada automática, reconexão progressiva e erros visíveis; captura idempotente por ID externo (texto, mídia, localização, contato, enquete; reações e sinais de protocolo ficam fora); inbox com atualização periódica, busca por contato, protocolo e conteúdo, filtros por status e paginação; mídia privada validada por assinatura, servida só à empresa dona; fila de envio durável com idempotência por requisição, despacho apenas pelo dono da conexão, estado "sem confirmação" em vez de reenvio automático e recibos de entrega/leitura; recibo de leitura ao cliente quando alguém da equipe abre a conversa; assumir, atribuir, transferir por responsável e departamento com controle de versão, notas internas, finalizar com motivo, reabertura automática quando o cliente escreve; contato e atendimento ligados nos dois sentidos.

Gate pendente (exige um número real e acesso à produção): ler o QR, receber texto/imagem/áudio/documento/localização de um cliente, responder com texto e anexo, conferir tique azul e recibos, derrubar a conexão e ver a fila drenar ao reconectar, e repetir com dois usuários e dois tenants. Anexos acima de ~4 MB pela origem da Vercel (rewrite para o Railway) ainda não foram verificados em produção.

Fora do escopo deste estágio, por desenho: reenvio automático de mensagens incertas (duplicaria mensagens reais), presença "digitando", edição e exclusão de mensagens, mídia de visualização única.

## Estágio 3 — produtividade e supervisão

Retornos, programação compatível com o canal, busca por protocolo e conteúdo, presença, conflitos, menções, notificações, campos personalizados, supervisão por departamento, métricas derivadas e exportações.

## Estágio 4 — gestão da plataforma e automação

Construtor simples de fluxos e execução versionada, super admin com acesso excepcional auditado, gestão de planos e bloqueios, saúde da plataforma, métricas operacionais, backups e restauração ensaiada, políticas de retenção e atendimento LGPD.

## Gate comercial

Não liberar clientes pagantes até concluir: número real e ciclo de mídia; e-mail verificado; teste de carga; recuperação de desastre; monitoramento externo; revisão de segurança e retenção; decisões comerciais de planos; todos os fluxos contratados do plano. Build aprovado sozinho não equivale a prontidão comercial.
