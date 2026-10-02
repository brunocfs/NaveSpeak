import { Component } from "react";
import { reportClientEvent } from "../observability/telemetry.js";
import i18n from "../i18n/index.js";

// Erro de renderização: mostra um fallback em vez da tela branca e reporta
// só nome + mensagem do erro (sem props/estado/component stack).
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    reportClientEvent("client_render_error", {
      error_code: "RENDER_ERROR",
      message: `${error?.name ?? "Error"}: ${error?.message ?? ""}`,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p>{i18n.t("shell.errorBoundary.message")}</p>
        <button type="button" className="rounded px-4 py-2 underline" onClick={() => window.location.reload()}>
          {i18n.t("shell.errorBoundary.reload")}
        </button>
      </div>
    );
  }
}
