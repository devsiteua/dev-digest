import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval — the workspace's Eval Dashboard.

   `/eval` and not `/evals`, deliberately: `activeKeyFor` already returns the
   `eval` nav key for `pathname.startsWith("/eval")`
   (`src/components/app-shell/helpers.ts`), so the sidebar highlights correctly
   with no edit to that file — and `/eval/compare` inherits the same highlight.

   Thin route entry; the view and its components are colocated under
   `_components`. */
export default function EvalPage() {
  return <EvalDashboardView />;
}
