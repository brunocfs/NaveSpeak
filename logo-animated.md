# Logo e animações do NaveSpeak

Registro das logos novas e da animação de voo do foguete. Tudo fica em
`client/src/components` (componentes) e `client/src/styles/index.css`
(animações).

## Status

- **Definitiva: V1.** As outras (V2–V6) ficam guardadas para uso futuro.
- A V1 já substituiu a logo antiga nas páginas: `LoginPage`, `DownloadPage`,
  `RoomsPage` e `ServerInvitePage` (em `RoomPage` só havia imports sem uso,
  removidos). `client/src/assets/nvspk*.svg` e os favicons em `client/public`
  continuam sendo os antigos.
- Preview de todas as versões e da animação: `npm run dev` no `client` e abrir
  `/logo-preview.html`. A página não entra no build.

## Versões

| Versão | Arquivo | Ideia | Hover | Classes CSS |
|---|---|---|---|---|
| **V1** (definitiva) | `NavespeakLogoV1.jsx` | Foguete inclinado 35°. O corpo é formado por três peças: ponta com janela, N e S. A perna direita do N emenda na barra de cima do S. Chama roxa. | Foguete dá uma volta completa e trepida, chama cresce e tremula | `nvs-*` |
| V2 | `NavespeakLogoV2.jsx` | V1 com letras chanfradas (S angular, N com pontas cortadas) | Igual à V1 | `nvs-*` |
| V3 | `NavespeakLogoV3.jsx` | Planeta que é balão de fala, ondas de voz dentro, anel orbital e foguete em órbita | Foguete percorre a órbita (passa por trás do planeta), barras de voz pulsam, estrelas cintilam | `nvs3-*` |
| V4 | `NavespeakLogoV4.jsx` | "Eclipse": lua-balão com crateras na frente de um sol roxo, crescente de luz e brilho de diamante | Lua desliza revelando mais luz, anéis de voz se expandem, brilho cintila | `nvs4-*` |
| V5 | `NavespeakLogoV5.jsx` | "Nave": fuselagem esguia, asas em lâmina separadas, cabine roxa, três rastros que lembram barras de áudio | Nave avança e trepida, rastros viram equalizador | `nvs5-*` |
| V6 | `NavespeakLogoV6.jsx` | V3 com um sol realista no lugar do balão: esfera de plasma roxa (núcleo quase branco, borda mais escura), granulação sutil e coroa de borda irregular. Usa a mesma cena orbital (`OrbitLogo`, exportada de `NavespeakLogoV3.jsx`) | Órbita e estrelas de fundo como na V3, coroa gira e tremula, sol pulsa, brilho respira | `nvs3-*` + `nvs6-*` |

Todas:

- São SVG inline (componente React). Com `<img>` o hover não funciona, porque
  ele anima partes internas do desenho.
- Seguem o tema sozinhas: o corpo usa `currentColor` (cor do texto do pai) e
  os detalhes roxos são fixos. Um componente serve claro e escuro.
- Aceitam `className` (tamanho, padrão `h-10 w-10`) e `title` (texto
  acessível).
- Respeitam `prefers-reduced-motion`: sem animação para quem pediu menos
  movimento.

```jsx
import NavespeakLogoV1 from "../components/NavespeakLogoV1.jsx";

<NavespeakLogoV1 className="h-10 w-10" />
```

### Detalhes da V1

- O desenho do foguete fica em `NavespeakRocketV1`, exportado de
  `NavespeakLogoV1.jsx`. A logo e a animação de voo usam o mesmo desenho, então
  um ajuste nele vale para as duas.
- O foguete é desenhado em pé (bico em y=0, base do S em y=100, eixo em x=50)
  e a logo inclina 35°. As letras e a chama ficam num grupo com `skewY(-35deg)`,
  que desfaz a inclinação só na horizontal: as barras do S ficam retas na tela e
  as pernas do N seguem o eixo do foguete. A silhueta do corpo (mask) recorta as
  letras no contorno.

## Animação de voo (decolagem e pouso)

Arquivo: `NavespeakLanding.jsx`. Não é hover: roda **uma vez ao montar** o
componente, com duração de **9s**. Começa e termina com o foguete pousado.

```jsx
import NavespeakLanding from "../components/NavespeakLanding.jsx";

<NavespeakLanding className="h-64 w-64" />
```

### Sequência

| Tempo | % | O que acontece |
|---|---|---|
| 0–0,8s | 0–8,89% | Pousado. Chama acende, plataforma brilha, poeira sai pros lados |
| 0,8–1,8s | 8,89–20% | Sobe reto, acelerando |
| 1,8–3s | 20–33,33% | Inclina até 35° (pose da logo) e sai pelo canto de cima à direita, de bico |
| 3–5s | 33,33–55,56% | Fora da tela |
| 5–6,8s | 55,56–75,56% | Volta de ré pelo mesmo canto, com a chama freando |
| 6,8–7,8s | 75,56–86,67% | Termina de se endireitar sobre a plataforma |
| 7,8–8,5s | 86,67–94,67% | Desce e toca a plataforma |
| 8,5–9s | 94,67–100% | Quique leve, chama apaga, poeira sai pros lados |

As luzes roxas da plataforma piscam o tempo todo.

### Regras que não podem quebrar

- **N e S sempre em pé na tela.** `nvsl-rocket` (posição e inclinação) e
  `nvsl-skew` (skew das letras e da chama) precisam ter **os mesmos percentuais
  e o mesmo easing** em cada trecho, com skew = −inclinação. Ao mexer num
  keyframe de um, ajuste o outro igual.
- Já foram testadas e **descartadas**: foguete rígido (só girando, letras com o
  skew fixo da V1) e letras em itálico no pouso. Nos dois casos a chama e as
  letras ficaram tortas e diferentes da logo. Pousado, o foguete fica na
  vertical com N e S retos.
- O estilo base (sem animação) é a pose pousada. É o começo, o fim e o que
  aparece com `prefers-reduced-motion`.

### Ajustes comuns

Tudo no bloco `nvsl-*` do `index.css`:

- **Repetir a animação:** remonte o componente trocando a `key`
  (`<NavespeakLanding key={n} />`). O preview faz isso no botão "Repetir".
- **Loop infinito** (ex.: tela de carregamento): troque `both` por `infinite`
  nas animações de 9s (`nvsl-rocket`, `nvsl-skew`, `nvsl-flame`, `nvsl-glow`,
  `nvsl-dust`).
- **Duração total ou pausa fora da tela:** mude os `9s` e recalcule os
  percentuais (tempo ÷ duração × 100). A pausa é o trecho 33,33%–55,56%.
- **Cena:** `viewBox` 200×200. A plataforma fica em y=176 e o foguete é
  desenhado em escala 0,7, ancorado no centro da base.

## Pendências para adotar a V1

1. `RoomsPage3.jsx` e as cópias `* copy.jsx` (fora das rotas) ainda importam
   a logo antiga. Remover esses arquivos ou trocar quando voltarem a ser usados.
2. Gerar favicon (`client/public/favicon*.svg`, `favicon-256.png`) e ícones do
   Electron em PNG a partir da V1. Em tamanhos pequenos o favicon é estático
   (sem hover).
3. Decidir o que fazer com o `logo-preview.html`: remover quando não for mais
   usado para comparar.
