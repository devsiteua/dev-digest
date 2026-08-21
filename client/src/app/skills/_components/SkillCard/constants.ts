/* Presentation vocabulary for a skill now lives in `@/lib/skills`: the agent
   editor's Skills tab renders skills too, and this folder is private to the
   /skills route. Re-exported so this component's own imports stay local. */
export { SOURCE_ICON, TYPE_COLOR, isUntrusted } from "@/lib/skills";
