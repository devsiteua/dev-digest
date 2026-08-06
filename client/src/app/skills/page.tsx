import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills — the Skills index, one tile per skill, the way /agents lists
   agents. Thin route entry; the view, its cards, editor, import drawer and i18n
   are colocated under _components. Opening a tile routes to /skills/[id], where
   the same list returns as a rail beside the editor. */
export default function SkillsPage() {
  return <SkillsListView />;
}
