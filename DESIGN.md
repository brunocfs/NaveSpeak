# Design do NaveSpeak

Padrão visual e de código pra toda UI nova do client (`client/src`). Na dúvida,
copie o componente existente mais parecido em vez de inventar um estilo novo.

## Stack

- **Tailwind v4** direto no JSX (`@import "tailwindcss"` em `src/styles/index.css`).
  Não criar arquivos `.css` novos nem classes em `index.css` para telas comuns.
- `index.css` só guarda: tokens de tema, scrollbar global, CSS legado
  (`auth-card`, `modal-card`, `source-*`) e efeitos que o Tailwind não cobre bem
  (keyframes, pseudo-elementos: `turbo-button`, `cipher-button`, `styled-name-*`).
- Ícones: **`lucide-react`**. Não desenhar `<svg>` inline para ícones novos.
- Sem libs de UI (nada de MUI, Radix, shadcn). Componentes próprios em `src/components`.

## Tema (claro/escuro)

- Dark mode é a classe `.dark` no `<html>` (alternada pelo `PreferencesContext`).
  Usar a variante `dark:` em **todo** elemento com cor. Toda cor clara precisa do
  par escuro.
- Neutros: escala **`slate`**.

| Papel            | Claro                                | Escuro                                         |
| ---------------- | ------------------------------------ | ---------------------------------------------- |
| Fundo da página  | `bg-slate-100`                       | `dark:bg-[#0f1117]`                            |
| Card / modal     | `bg-white`                           | `dark:bg-[#181a20]` (ou `dark:bg-slate-900`)   |
| Input            | `bg-white`                           | `dark:bg-[#0f1117]`                            |
| Item de lista    | `bg-slate-50`                        | `dark:bg-slate-800/60`                         |
| Borda / ring     | `border-slate-300`, `ring-slate-200` | `dark:border-slate-700`, `dark:ring-slate-800` |
| Título           | `text-slate-900`                     | `dark:text-white`                              |
| Label            | `text-slate-700`                     | `dark:text-slate-300`                          |
| Texto secundário | `text-slate-500` / `text-slate-600`  | `dark:text-slate-400`                          |

## Cores de destaque

- **Primária: `purple`** (`purple-600` claro / `purple-500` escuro). O refactor
  está migrando de `blue` para `purple`; código novo usa `purple`. Não criar
  `blue` novo como cor primária.
- Perigo: `red` (`text-red-600 dark:text-red-400`).
- Sucesso / online: `emerald`.
- Info / admin: `sky`.
- Temas especiais (Turbo, cifra) usam as classes próprias de `index.css`. Não
  recriar esses gradientes no JSX.

## Tipografia

- Fonte do sistema (definida em `:root`). `font-display` (Space Grotesk) e
  `font-signal` (JetBrains Mono) só no branding (LoginPage, Turbo).
- Tamanhos: corpo `text-sm`, auxiliar `text-xs`, badge `text-[11px]`, título de
  modal/seção `text-lg font-semibold`. Evitar `text-base` e maiores fora de páginas.

## Forma e espaçamento

- Raio: `rounded-2xl` em card/modal, `rounded-xl` em input/botão/item de lista,
  `rounded-lg` em botão pequeno/ícone, `rounded-full` em avatar/badge/pill/toggle.
- Card: `p-6 shadow-sm ring-1` (modal: `shadow-xl`).
- Espaço vertical: `space-y-4` no formulário, `space-y-2` na lista, `mb-5` abaixo
  do cabeçalho do modal, `mt-6` antes dos botões.
- Todo clicável tem `cursor-pointer transition`.

## Receitas

Botões:

```jsx
// primário
"cursor-pointer rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:opacity-60 dark:bg-purple-500 dark:hover:bg-purple-400";
// secundário
"cursor-pointer rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
// pequeno (ação em linha de lista)
"cursor-pointer rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700";
// perigo pequeno
"cursor-pointer rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40";
// ícone (fechar etc.) - sempre com aria-label
"cursor-pointer rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300";
```

Input:

```jsx
"w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-slate-700 dark:bg-[#0f1117] dark:text-white dark:placeholder:text-slate-500";
```

Label: `mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300`, com
`htmlFor` apontando pro `id` do input.

Opção selecionável (segmentado, `aria-pressed`):

```jsx
selected
  ? "border-purple-500 bg-purple-50 text-purple-700 dark:border-purple-400 dark:bg-purple-950/40 dark:text-purple-300"
  : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
```

Badge: `rounded-full px-2 py-0.5 text-[11px] font-semibold` +
`bg-{cor}-100 text-{cor}-700 dark:bg-{cor}-500/15 dark:text-{cor}-300`.

Erro: `<p className="text-xs text-red-500 dark:text-red-400">{error}</p>`.

Toggle: usar `components/Toggle.jsx`, não criar outro switch.
Avatar: usar `components/Avatar.jsx`. Nome estilizado: `StyledUsername.jsx`.

## Modal

Referência: `CreateChannelModal.jsx`.

- Renderizar via `createPortal(..., document.body)`.
- Overlay: `fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8`,
  com `role="dialog"`, `aria-modal="true"`, `aria-label` e `onClick={onClose}`.
- Card: `w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-[#181a20] dark:ring-slate-800`
  com `onClick={(e) => e.stopPropagation()}`.
- Cabeçalho: título à esquerda, botão fechar (lucide `X`) à direita.
- Rodapé: Cancelar (secundário) + Confirmar (primário), `flex gap-2`, lado a lado com `w-full`.
- Formulário é um `<form onSubmit>`; o botão de submit fica desabilitado enquanto
  `submitting` ou com campo obrigatório vazio, e o texto muda ("Criar" → "Criando...").

## Seção / painel

Referência: `AdminUsersPanel.jsx`.

- `<section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">`
- Cabeçalho `mb-4 flex flex-wrap items-center gap-3` com `h2 text-lg font-semibold`.
- Classes repetidas no mesmo arquivo viram constantes de string no topo
  (`const actionBtn = "..."`), não componentes novos.

## Card de configuração (aba TURBO)

Referência: `TurboSettings.jsx` e `TurboProfileSection.jsx`. Dentro da aba TURBO
das Preferências, todo bloco de configuração usa o mesmo card compacto, sem
exceção (inclusive banner e estilo do nome):

- `<section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/60">`
- Não usar o card de seção branco (`rounded-2xl bg-white p-6 shadow-sm ring-1`) nessa aba.
- Convite/estado do TURBO no topo: `border-purple-400/30 bg-linear-to-r from-purple-600/10 to-fuchsia-500/10`.

## Código

- Componentes `.jsx` com `export default function Nome(...)`, um por arquivo, em
  `src/components` (telas inteiras em `src/pages`).
- Chamadas HTTP em `src/api/<recurso>.js`, funções de uma linha em cima de
  `apiRequest` (`./http.js`). Componente não chama `fetch` direto.
- Estado global em `src/context/*`, lógica reutilizável em `src/hooks/use*.js`.
  Reusar o que já existe (`useAuth`, `ToastContext`, `PreferencesContext`, etc.).
- Classes condicionais: template string ou `[...].join(" ")`. Sem `clsx`.
- Textos da UI em **português (pt-BR)**. Datas com `toLocaleString("pt-BR")`.
- Comentários em português, explicando o _porquê_ (regra de negócio, permissão
  reforçada no servidor, limitação de navegador/Electron), não o óbvio.
- Erros: `try/catch` mostrando `err.message` com uma mensagem padrão em pt-BR.

## Acessibilidade e plataforma

- Botão só com ícone sempre tem `aria-label`. Estados com `aria-pressed`,
  `aria-checked`, `aria-selected`.
- Foco visível: `focus-visible:ring-2 focus-visible:ring-purple-500`.
- Animações novas em CSS respeitam `@media (prefers-reduced-motion: reduce)`.
- Electron: a `TitleBar` ocupa 36px e `h-screen`/`min-h-screen` já descontam essa
  altura (`html.electron-app`). Usar essas classes para altura de tela cheia,
  nunca `100vh` fixo no JSX. Painel `fixed` de tela cheia usa
  `inset-x-0 bottom-0 top-(--titlebar-h)` em vez de `inset-0`, senão cobre a
  TitleBar.
