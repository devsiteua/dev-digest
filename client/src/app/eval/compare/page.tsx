import { RunComparison } from "./_components/RunComparison";

/* Route: /eval/compare?a=&b= — two eval runs side by side.

   Still under `/eval`, so `activeKeyFor` keeps the sidebar's Eval Dashboard
   entry highlighted with no edit to `components/app-shell/helpers.ts`. */
export default function EvalComparePage() {
  return <RunComparison />;
}
