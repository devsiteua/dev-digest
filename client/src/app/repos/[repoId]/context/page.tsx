import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context — the L05 Project Context folder (design screen
   key `project-context`, artboards `context` / `e-context`). Thin route entry;
   the document list, the read-only preview, the upload control and their i18n
   are colocated under _components. */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
