# Client specs

Specs for work confined to `@devdigest/web`. Anything that also changes the API or the
contracts belongs in the root [`../../specs/`](../../specs/README.md).

Format, status values, and the promotion rules are defined once in the root specs README.
Copy [`../../specs/TEMPLATE.md`](../../specs/TEMPLATE.md).

Client-specific sections worth filling in every time:

- **Screens and components** — which routes and `_components/` folders are touched.
- **Data** — which hooks are added or changed, and which query keys must be invalidated.
- **Copy** — which `messages/en/*.json` namespaces gain strings.
- **Empty / loading / error states** — name them explicitly; they are the parts most often
  forgotten and most often caught in review.

No open client-only specs.
