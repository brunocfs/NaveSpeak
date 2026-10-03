// Palco das demos animadas: decorativo (aria-hidden), a descrição fica no texto
// da seção. `.tl-stage` desliga as animações CSS com prefers-reduced-motion.
export default function Stage({ children, className = '' }) {
  return (
    <div
      aria-hidden="true"
      className={`tl-stage relative flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl border border-purple-400/20 bg-[#0b0618]/80 p-4 ${className}`}
    >
      {children}
    </div>
  );
}
