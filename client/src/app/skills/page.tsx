import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills — the Skills list with no skill selected. Thin route entry; the
   view, its cards, editor, import drawer and i18n are colocated under
   _components. Selecting a skill routes to /skills/[id], which renders the same
   list plus the editor. */
export default function SkillsPage() {
  return <SkillsListView />;
}
