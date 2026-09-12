import { useCallback, useEffect, useRef, useState } from "react";

// Posição de scroll de cada chat (canal ou DM), guardada fora do componente
// - sobrevive a ChatPanel/DmPanel trocarem de channelId/friend sem desmontar
// (ver RoomPage.jsx/RoomsPage.jsx: nenhum dos dois usa `key`, é a mesma
// instância reaproveitada). Um F5 perde este Map (volta pro fim, que é
// exatamente o comportamento pedido pra "primeira vez que abre o chat").
const savedScrollTop = new Map();

const BOTTOM_SLACK_PX = 48; // folga pra considerar "está no fim"

function isNearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
}

// Scroll do chat (ChatPanel.jsx/DmPanel.jsx): abre um chat pela primeira vez
// → vai pro fim. Reabre um chat que o usuário tinha rolado pra cima →
// restaura a posição salva. Mensagem nova chega com ele já no fim →
// acompanha. Chega com ele lendo histórico acima → não move, só acende
// `hasNewMessage` (pro botão "ir pro fim" piscar).
//
// `key` identifica o chat (ex.: `channel:${channelId}` ou `dm:${friend.id}`)
// - precisa ser único entre canais e DMs. `loading` é o mesmo estado que o
// painel já usa pra mostrar "Carregando mensagens...": o efeito de
// posicionamento só decide algo quando ele vira `false` (histórico chegou).
export function useChatScroll(key, messages, loading) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const isAtBottomRef = useRef(true);
  // false enquanto o histórico deste chat ainda não foi posicionado uma
  // primeira vez - evita o efeito de "mensagem nova" abaixo de reagir à
  // carga inicial como se fosse mensagem chegando.
  const readyRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [hasNewMessage, setHasNewMessage] = useState(false);

  const scrollToBottom = useCallback((behavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
    setHasNewMessage(false);
  }, []);

  // Trocou de chat: força o próximo posicionamento a tratar como "abertura",
  // não como mensagem nova chegando no chat anterior.
  useEffect(() => {
    readyRef.current = false;
    setHasNewMessage(false);
  }, [key]);

  // Não depende de `key` de propósito: só deve agir quando o histórico
  // realmente chegou (`loading` virou false) ou quando `messages` muda -
  // reagir à simples troca de `channelId`/`friend.id` (antes do fetch
  // responder) posicionaria com o DOM/mensagens do chat ANTERIOR ainda na
  // tela.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loading) return;
    const container = containerRef.current;
    if (!container) return;

    if (!readyRef.current) {
      const saved = savedScrollTop.get(key);
      if (saved != null) {
        container.scrollTop = saved;
      } else {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
      readyRef.current = true;
    } else if (isAtBottomRef.current) {
      scrollToBottom("smooth");
    } else {
      setHasNewMessage(true);
    }

    const atBottom = isNearBottom(container);
    isAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
  }, [loading, messages, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    savedScrollTop.set(key, container.scrollTop);
    const atBottom = isNearBottom(container);
    isAtBottomRef.current = atBottom;
    setShowJumpToBottom(!atBottom);
    if (atBottom) setHasNewMessage(false);
  }, [key]);

  return {
    containerRef,
    bottomRef,
    onScroll: handleScroll,
    showJumpToBottom,
    hasNewMessage,
    scrollToBottom: () => scrollToBottom("smooth"),
  };
}
