# Sistema visual do Caju

## Direção

O Caju se comporta como um balcão de atendimento organizado: o próximo passo é óbvio, o estado aparece perto da ação e a interface mantém espaço para trabalhar por horas. A marca vive no mascote, no coral e na voz cuidadosa; as telas operacionais permanecem calmas.

## Identidade

O ativo oficial está em `apps/web/public/brand/caju.png` e não deve ser redesenhado. Nunito Sans Variable é a família de interface, com formas amigáveis e boa legibilidade em densidade operacional. Títulos usam peso 750–850 e tracking entre -0.025em e -0.035em; corpo usa 400–650.

Coral comunica ação principal, seleção e identidade. Âmbar comunica atenção e conexão pendente. Verde comunica conclusão. Azul comunica informação. Cores nunca substituem texto ou ícone.

## Temas

Os temas são sistemas completos definidos por tokens CSS:

- `claro`: branco quente, cinza mineral e coral profundo;
- `escuro`: grafite neutro e coral suave;
- `areia`: papel, oliva mineral e terracota;
- `cafe`: cacau escuro, areia clara e pêssego.

Superfícies, campos, divisores, foco, seleção, feedback e previews derivam dos mesmos papéis sem copiar valores entre temas. A preferência é salva na conta e antecipada por `theme.js` para evitar flash.

## Componentes e composição

Raios de 7–12px dominam; pills ficam restritas a estados pequenos. Elevação aparece apenas em diálogos e avisos flutuantes. Listas usam divisores, não coleções de cards. Configurações têm índice lateral no desktop e faixa horizontal no celular. A navegação móvel é inferior e preserva quatro destinos primários.

Botões descrevem a ação. Formulários mantêm rótulo persistente, ajuda junto ao campo, estado de processamento, erro recuperável e confirmação discreta. Alterações não salvas interrompem a saída da tela. Ações irreversíveis usam confirmação focada.

### Conexão WhatsApp por QR Code

O fluxo de conexão por QR Code usa uma composição própria, mas permanece dentro do sistema. O QR é sempre escuro sobre branco, inclusive nos temas escuros, dentro de um quadro elevado com cantos geométricos no coral do tema e a marca oficial em escala discreta no centro. No desktop, o quadro ocupa uma coluna própria e as instruções ficam ao lado; a leitura visual começa no código e segue para o próximo passo, a validade e a proteção da sessão.

**A Regra do QR Legível.** Contraste, área de respiro e integridade do código têm prioridade sobre decoração: o fundo branco e o primeiro plano quase preto não recebem tonalização do tema, os cantos coral ficam fora da área codificada e a marca central nunca domina nem encobre os padrões de leitura.

A experiência distingue preparação inicial, QR disponível, conexão ou sincronização em progresso, tentativa automática de reconexão, operação normal, atenção necessária e remoção. O estado aparece junto à ação correspondente: âmbar para espera ou atenção, verde para operação confirmada e vermelho apenas para a ação destrutiva. O estado conectado mostra identidade e número, fatos de confiança e uma faixa ativa alinhada; atenção oferece recuperação primária e remoção secundária; remover exige confirmação explícita que explica o encerramento da sessão e a exclusão das chaves.

**A Regra da Confirmação Observável.** Ler o QR inicia o processo, mas nunca comunica sucesso por si só. A interface só declara conexão quando o estado persistido confirma a operação; enquanto isso, progresso, sincronização e reconexão usam mensagens próprias e recuperáveis.

## Responsividade e movimento

Desktop prioriza densidade confortável e navegação persistente. Até 700px, o shell usa menu lateral temporário, barra inferior, tabelas transformadas em listas e controles com alvo mínimo de 40–48px. Conteúdo nunca depende de hover.

No fluxo de WhatsApp, até 700px as composições de duas colunas passam a uma sequência vertical. O QR inteiro permanece no primeiro viewport útil, em quadro de 238px com código de 202px, antes das instruções. A cópia troca para “Use outro aparelho para escanear”, mantém o caminho do WhatsApp visível e orienta abrir o Caju no computador quando houver apenas um celular. No estado conectado, a faixa ativa permanece alinhada ao nome e ao número; fatos de confiança empilham sem perder seus divisores e ações podem quebrar linha sem reduzir o alvo de toque.

O único movimento expressivo é a chegada curta do mascote na autenticação. Transições operacionais duram 150–350ms e usam transform; durante conexão e reconexão, um pulso lento sinaliza atividade sem sugerir conclusão. `prefers-reduced-motion` remove todas.
