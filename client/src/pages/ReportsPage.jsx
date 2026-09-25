import { Link } from "react-router-dom";
import BugReportPanel from "../components/BugReportPanel.jsx";
import DownloadAppLink from "../components/DownloadAppLink.jsx";

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/rooms"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              &larr;
            </Link>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Reportar bug ou sugestão</h1>
          </div>
          <DownloadAppLink />
        </div>
      </header>

      <main>
        <BugReportPanel />
      </main>
    </div>
  );
}
