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

## Responsividade e movimento

Desktop prioriza densidade confortável e navegação persistente. Até 700px, o shell usa menu lateral temporário, barra inferior, tabelas transformadas em listas e controles com alvo mínimo de 40–48px. Conteúdo nunca depende de hover.

O único movimento expressivo é a chegada curta do mascote na autenticação. Transições operacionais duram 150–350ms e usam transform; `prefers-reduced-motion` remove todas.
