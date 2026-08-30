import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs — every review an agent ran inside CI, newest first. Thin
   route entry; the list, its columns and its empty state live in _components.
   Ported from screen_ciruns.jsx (artboards `ci-runs` and `e-ci`). */
export default function CiRunsPage() {
  return <CiRunsView />;
}
