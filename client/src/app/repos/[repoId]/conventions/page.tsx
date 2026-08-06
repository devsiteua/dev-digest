import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions — the L02 conventions extractor (design
   screen key `conventions`, N7). Thin route entry; the header, the accept/reject
   bar, the candidate cards and their i18n are colocated under _components.
   Rewording a candidate and the "create skill from conventions" modal are not
   here yet — they arrive with the merge flow. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
