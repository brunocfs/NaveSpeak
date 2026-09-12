✨ Boas-vindas ao NaveSpeak
Olá, meus amigos 👋

Sejam muito bem-vindos ao NaveSpeak.

Muito obrigado por fazerem parte dos testes <3

🚀 Que bom ter vocês aqui
Este espaço foi preparado com carinho para receber cada pessoa que está participando desta fase de testes. A presença de vocês faz toda a diferença para evoluir a experiência, identificar melhorias e construir algo cada vez melhor.

💙 Obrigado por fazer parte
Cada feedback, teste e sugestão tem muito valor. Mais do que experimentar uma plataforma, vocês estão ajudando a moldar o NaveSpeak desde o começo.

🛠️ Durante os testes
Explorem à vontade.

Compartilhem impressões sinceras.

Reportem qualquer detalhe que possa ser melhorado.

Aproveitem para conhecer a proposta do NaveSpeak.

# Novidades da versão 0.3.6

## Chamadas de voz e vídeo

- Painel flutuante (o card que aparece no canto da tela quando a chamada continua rolando fora do canal de voz) agora mostra só UM participante por vez, escolhido automaticamente por quem está com a câmera ligada e falando - vai alternando sozinho conforme a conversa, bem menos poluído com chamadas grandes.
- Dê dois cliques no painel flutuante pra ir direto pro servidor e canal de voz conectado.
- Painel flutuante agora pode ser arrastado com o mouse pra qualquer canto da tela.
- Modo Livre: além do resize, agora dá pra arrastar cada câmera/tela pra qualquer posição dentro do espaço disponível (pode até sobrepor outra) - nunca mais ultrapassa os limites da tela, mesmo redimensionando manualmente.
- Novo botão de Tela Cheia no painel de voz (embutido na sala e na janela separada).
- Novo botão em cada participante/tela pra abrir só aquela mídia numa janela separada, independente do painel principal - dá pra abrir várias ao mesmo tempo.
- Agora também dá pra ocultar sua PRÓPRIA câmera/tela (mesmo botão de olho que já existia pra ocultar a dos outros).
- Ao compartilhar sua tela, a pré-visualização dela pausa sozinha quando o NaveSpeak sai de foco (troca de janela/app) - economiza CPU/GPU; o que os outros participantes veem não muda em nada.

## Correções e Melhorias

- Corrigido: minimizar o painel flutuante não funcionava (clique não chegava no botão).
- Corrigido: painel flutuante arrastado podia ficar "perdido" fora da tela ao redimensionar a janela.
- Corrigido: com o painel numa janela separada, trocar do modo Livre pra Grade (ou vice-versa) bagunçava as câmeras - ficavam empilhadas em coluna estourando a tela, ou minúsculas sem aproveitar o espaço.

# Novidades da versão 0.3.2

## Novidades

- Anexos no chat de canal e privado
  Envie arquivos direto na conversa - até 20MB cada, vários por mensagem. Imagem, vídeo e áudio aparecem inline; o resto vira um chip com nome, tamanho e link de download.

- Arrastar e soltar, com confirmação
  Solte um arquivo em qualquer lugar do chat pra anexar. Ele fica pendente até você confirmar (✓) ou descartar (✕) - nada sobe sem essa confirmação.

- Preview automático de link
  Um link de imagem colado na mensagem já mostra a prévia. Um link do YouTube mostra a miniatura - clique nela pra assistir direto ali, num mini player embutido, sem sair do chat.

- Estatísticas de conexão na sala
  Novo ícone na barra de voz mostra o estado da chamada (bom / instável / ruim) e, ao clicar, abre ping e perda de pacotes em tempo real.

- Efeitos sonoros da chamada
  Sons de entrar e sair do canal, começar a compartilhar tela, ligar/desligar "silenciar todos" e ligação privada tocando - ouvidos por todo mundo já conectado no canal, não só por quem agiu.

- Push-to-Talk
  Agora você pode definir uma keybind para utilizar o "Pressione para Falar" - A utilização deste recurso pela versão browser apenas funciona quando a tela do NaveSpeak está em foco. Para utilizar o recurso com outras janelas em foco é necessário utilizar o aplicativo Desktop!

- Sensibilidade de Microfones e Supressor de Ruido
  Adicionado novos controles de supressor de ruido e também o recurso para controlar a sensibilidade do seu microfone!

- Menções - @username
  Agora é possivel mencionar seus amigos no chat!

- Algumas melhorias no visual!

- Novo supressor de ruído: DeepFilterNet3
  Em Preferências > Áudio agora tem a opção DeepFilterNet3, o supressor mais forte da lista - nos nossos testes ele derruba cerca de 20dB do ruído de fundo (teclado, ventilador, conversa) praticamente sem mexer na sua voz. Na primeira vez que você entrar em voz com ele, o app baixa ~24MB de modelo (só uma vez) e ele usa mais CPU que os outros. O nível agora vale a régua inteira: 0% deixa o áudio intocado e 100% libera o corte máximo.

## Correções e Melhorias

- Corrigido: menu de participante e prévia de perfil (clique direito/clique na sidebar de voz) ficavam pulando de posição se você clicasse dentro deles.
- Corrigido: o chat abria com o scroll no topo ou no meio em vez de ir direto pra mensagem mais recente.
- Scroll do chat agora mantém sua posição ao trocar de conversa e voltar (se você tinha subido pra ler o histórico) e ganhou um botão pra pular direto pro fim quando chega mensagem nova enquanto você lê mensagens antigas.
- Corrigido: o contador de mensagens não lidas na lista de servidores não descia depois de ler as mensagens do canal.

# Novidades da versão 0.3.0

## Chamadas de voz e vídeo

- Painel de voz agora com dois modos de layout de vídeo, escolha salva por você: **Grade** (padrão) e **Livre**.
- Modo Grade: grid 100% automático - calcula sozinho colunas/linhas pra deixar cada participante o maior possível mantendo a proporção, e se reorganiza sozinho a cada pessoa que entra/sai (2 pessoas = lado a lado; 3 = 2 em cima + 1 embaixo; 4 = 2x2; e assim por diante). Vale tanto com o painel embutido na sala quanto na janela separada.
- Modo Livre: mesmo grid automático, mas com resize manual - arraste o canto inferior direito de qualquer mídia pra redimensioná-la (a proporção é sempre preservada, nunca distorce). (Bugs conhecidos e melhorias ainda sendo aplicadas!)
- Fixar (pin) agora aceita vários participantes/telas ao mesmo tempo, todos ganhando destaque juntos.
- Botão novo pra esconder do grid quem está sem câmera/tela ligada (só microfone) - quem fixou ou está compartilhando tela nunca some.
- Corrigido: minimizar o painel flutuante cortava o áudio da chamada inteira (agora só esconde a janela, o áudio continua).
- Corrigido: abrir a chamada em uma janela separada não respeitava o tema (fundo sempre claro).
- Painel principal agora avisa quando a chamada está aberta em outra janela, com botão pra trazer de volta.

## Servidores

- Barra de membros do servidor agora pode ser ocultada/expandida - ocultar libera mais espaço pro chat/voz.

# Novidades da versão 0.2.0

## Servidores

- Foto do servidor agora aparece na lista de servidores e no topo da sala.
- Contagem de mensagens não lidas: total por servidor na tela inicial e individual por canal de texto dentro da sala.
- Ajustes de layout na tela do servidor (canais, chat/voz e membros preenchem a altura da tela, cada um com scroll próprio).

## Novidades desta versão

- Este modal de novidades, com histórico das versões.
- Página para enviar relatos de bug ou sugestões de melhoria.

---

## Em desenvolvimento:

- Possibilidade de abaixar o volume individualmente.
- Melhoria e correções da emissão de notificações.
- Melhoria nos paineis de chat/voz dos servidores e conversas privadas.
- Possibilidade de envio de mensagens para um usuário sem estár na lista de amigos.

Encontrou um problema ou tem uma ideia? Use o botão **Reportar** na tela inicial.
