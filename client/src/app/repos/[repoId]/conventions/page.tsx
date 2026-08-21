import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions — the L02 conventions extractor (design
   screen key `conventions`, N7). Thin route entry; the header, the scan report,
   the accept/reject bar, the candidate cards, the reword editor, the "create
   skill from conventions" modal and their i18n are colocated under
   _components. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
