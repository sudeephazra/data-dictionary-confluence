# Contributing

This guide explains how to add features to the Redshift Data Dictionary Forge app without breaking page-owned persistence, legacy data compatibility, preview behavior, or the Confluence editing experience.

## Before you start

1. Read `README.md`, `manifest.yml`, and the existing implementation and tests for the area you plan to change.
2. Install dependencies with `npm install`.
3. Run `npm run ci` to establish a baseline before editing.
4. Keep the work focused. Do not mix feature changes with unrelated formatting, dependency, or generated-file changes.
5. Do not deploy or install from a feature branch as part of the contribution. Validate locally with `forge lint`, `forge build`, and preview screenshots.

If a baseline check fails because a bundled support artifact is missing, restore or generate that project-provided artifact before evaluating application failures. Do not bypass manifest validation, linting, tests, or coverage checks.

## Feature-development workflow

### 1. Define the behavior and data ownership

Decide which execution path the feature affects:

- **Page-owned macro data:** Current metadata and rows belong in the versioned `tableData` macro configuration. Update the serializer and parser together when the stored shape changes.
- **Legacy data:** KVS is a compatibility read path for macro instances created by earlier releases. Preserve existing keys and fallback behavior unless the feature includes a tested migration.
- **Preview mode:** Preview must render useful mock content without bridge calls, KVS access, loading spinners, or persistence.
- **Live mode:** Use real configuration or platform data. Show failures to the user; never replace live failures with mock data.

For a stored-schema change, keep parsing backward compatible. Increment the payload version only when the parser can explicitly handle the transition, and add round-trip and older-version tests.

### 2. Update shared domain types

Add or change application types in `src/types/index.ts`. Keep defaults, allowed-value constants, serialization, parsing, resolver payloads, and response types consistent.

Do not edit `src/types/forge-ui-types.ts`; it is generated. Import UI Kit component prop types from the type barrel and runtime values directly from `@forge/react`.

### 3. Implement backend behavior when required

Backend resolvers live in `src/resolvers/index.ts` and are exported through `src/index.ts`.

- Give each resolver a stable, descriptive key and invoke that exact key from the frontend.
- Validate untrusted payloads before reading or writing data.
- Wrap platform and storage operations in error handling, log useful context with `console.error`, and let the frontend display a live error state.
- Use `@forge/api` for Atlassian REST calls. Use `asUser()` for user-present actions that should respect and represent the current user; use `asApp()` for system or background work.
- Before adding or changing an Atlassian REST endpoint, verify the exact method and path in the current Forge documentation and confirm that it is not deprecated.
- Add the minimum required manifest scopes. `allowImpersonation` is only for offline impersonation with `asUser(accountId)`, not ordinary `asUser()` calls from UI modules.

Do not use direct unauthenticated `fetch` for Atlassian APIs and do not add fallback mock responses to live resolver failures.

### 4. Implement the Forge UI Kit experience

Frontend code lives in `src/frontend/index.tsx` and must use components from `@forge/react`; standard HTML elements are not supported by UI Kit.

Preserve the app's mode-specific behavior:

- The macro configuration editor is editable.
- Changes are submitted to the Confluence page draft with `view.submit({ config, keepEditing: true })`.
- The inline macro remains read-only while the page is being edited.
- The published macro remains read-only.
- Preview mode remains editable, uses representative mock data, and never persists.

Use Atlassian design tokens through `xcss`. Keep accessibility labels, disabled states, loading states, validation messages, and visible error messages accurate for the new behavior.

When adding a field, update all relevant pieces in one change:

1. Domain type and default value.
2. Allowed values or options, if applicable.
3. Preview mock data.
4. Editor control and read-only rendering.
5. Change handler and page-draft submission.
6. Validation rules and messages.
7. Serialization and backward-compatible parsing.
8. Frontend, resolver, and integration tests as applicable.

### 5. Update the manifest only when needed

`manifest.yml` defines a Confluence `macro`, its configuration resource, the resolver function, static icon resources, the Node.js runtime, and permissions.

- Keep the top-level Confluence macro key as `macro`, not `confluence:macro`.
- Add new modules, functions, resources, or scopes only when the feature uses them.
- Keep scopes synchronized with every API and KVS operation.
- Never invent, blank, or replace `app.id` with a placeholder. Run `forge register <app-name>` only when `app.id` is genuinely missing or blank.
- Remember that manifest changes require a new Forge deployment before they are visible on a site.

### 6. Add meaningful tests

Update the existing test file nearest to the code instead of creating a parallel test file for the same feature:

- `src/frontend/__tests__/index.test.tsx` for rendering, editing, validation, draft submissions, preview, and error states.
- `src/resolvers/__tests__/index.test.ts` for resolver validation, KVS behavior, logging, and platform calls.
- `src/__tests__/integration.test.ts` for serialization, migration, and frontend/backend data contracts.

Use the shims and helpers supplied by `@forge/testing-framework`:

- Set frontend context and resolver responses through the `@forge/bridge` shim.
- Use `createFrontendContext` and `createBackendContext` for realistic Forge contexts.
- Use `createTestHarness` and fixture or KVS helpers for real resolver behavior.
- Reset bridge, storage, fixtures, and spies between tests.

Never manually mock `@forge/*` modules. Do not add no-op assertions or tests that only prove a mock returns its configured value.

At minimum, cover the normal path, cold start or empty data, invalid input, persistence or API failure, preview mode, and any relevant legacy-data transition.

### 7. Update documentation

Update `README.md` whenever a feature changes user-visible fields, validation, persistence, permissions, commands, setup, or the project structure. Preserve the **Deploy and install:** instructions, including registration, deployment, installation, and tunneling guidance.

Document architectural decisions in code comments only when the reasoning is not evident from the implementation. Avoid comments that merely restate the code.

## Required validation

Run the quality gates in this order and fix every failure:

```bash
npm run ci
forge lint
forge build
```

Then render every UI module with representative mock data and take screenshots. Review them for layout problems, blank screens, error boundaries, missing content, incorrect editable states, and Atlassian Design System inconsistencies. Re-run the affected checks after every fix.

The `npm run ci` command includes manifest validation, TypeScript checking, Jest coverage, and ESLint. Do not substitute a narrower command for the final validation pass.

## Pull request checklist

- [ ] The feature works in the macro configuration editor and remains read-only elsewhere.
- [ ] Preview mode shows representative mock data and performs no persistence.
- [ ] Live failures are visible and are not replaced with mock data.
- [ ] Stored-shape changes are backward compatible and migration behavior is tested.
- [ ] Resolver inputs are validated and failures are logged with useful context.
- [ ] Manifest scopes match all storage and API usage.
- [ ] New Atlassian REST routes were verified as current and non-deprecated.
- [ ] Existing tests were updated with normal, error, edge, and cold-start coverage.
- [ ] `npm run ci`, `forge lint`, and `forge build` pass without errors.
- [ ] All UI modules were screenshot-tested and visually reviewed.
- [ ] `README.md` and this guide reflect the final behavior.
- [ ] No generated UI type files, placeholder app IDs, TODO tests, or unrelated files were changed.
