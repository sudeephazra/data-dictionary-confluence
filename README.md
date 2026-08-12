# Redshift Data Dictionary for Confluence

Redshift Data Dictionary is an Atlassian Forge macro for documenting Redshift tables directly on Confluence pages. It provides an editable Forge UI Kit table for table ownership, operational metadata, column definitions, Redshift-specific settings, sample values, and PII flags.

## Current capabilities

- Captures table metadata: service, table name, environment, business reason, load type, contact, team, and manager.
- Captures column metadata: column name, data type, length, nullable state, sort or partition key, copy-to-Redshift state, sample value, and PII state.
- Supports `String`, `Number`, `Date`, `DateTime`, `Boolean`, and `JSON` data types.
- Supports development, integration, staging, UAT, and production environments.
- Allows rows to be added, edited, and removed in the macro configuration editor.
- Keeps the inline macro read-only in Confluence page edit mode and in the published page.
- Adds configuration changes to the Confluence page draft automatically; the changes become permanent when the page is saved.
- Loads older KVS-backed macro data when no page-owned configuration exists, so existing macros remain readable during migration.
- Displays editable sample data in Forge preview mode without persisting it.
- Reports invalid saved configuration and persistence failures to the user instead of replacing data with mock content.
- Sends structured frontend errors to Forge logs through the backend resolver.

## Validation rules

Each column row is checked as it is edited:

- Column name is required.
- Data type is required and must be one of the supported values.
- String columns require a length no greater than `65535`.
- Any supplied length must be a positive integer.
- Sample value is required.

Validation feedback is displayed beside the affected field. Draft updates are still submitted while editing so page-owned changes are not lost.

## How persistence works

The Confluence macro configuration is the source of truth for current data. Metadata and rows are serialized into the versioned `tableData` configuration property and submitted to the page draft with `view.submit`. Saving the Confluence page commits those draft changes.

The `getTableData` resolver and the `storage:app` scope remain in place for backward compatibility. If the macro has no `tableData` configuration, the frontend can read an older KVS record using a page- and macro-instance-scoped key, with fallbacks for keys used by earlier releases. Normal edits in the macro configuration editor do not write new KVS records.

## Using the macro

1. Edit a Confluence page and insert the **Redshift Data Dictionary** macro.
2. Enter the table metadata and add the required column rows in the macro configuration editor.
3. Correct any validation messages shown next to column fields.
4. Close the macro editor and save the Confluence page to persist the draft configuration.
5. View the published page. The macro is read-only until it is edited again through the macro configuration editor.

## Development

### Prerequisites

- Node.js 22, matching the Forge `nodejs22.x` runtime in `manifest.yml`
- npm
- Atlassian Forge CLI (`npm install --global @forge/cli`)
- An Atlassian account with access to a Forge development environment and a Confluence site

### Get started

1. **Install dependencies:**

   ```bash
   npm install
   ```

   `package.json` pins `@atlaskit/tokens` through an override so transitive dependencies resolve to one version and do not unnecessarily increase the bundle size.

2. **Validate your setup:**

   ```bash
   npm run ci
   ```

   This runs manifest validation, TypeScript checking, Jest with coverage, and ESLint.

3. **Deploy and install:**

   ```bash
   # Register the app only if app.id is blank or missing in manifest.yml
   forge register redshift-data-dictionary

   # Deploy to Atlassian's infrastructure
   forge deploy

   # Install to your development site
   forge install

   # Debug locally with a temporary tunnel
   forge tunnel
   ```

   This repository already contains a registered `app.id`. Never replace it with a placeholder or invented ARI. Manifest changes require a new deployment.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Run the TypeScript no-emit build check. |
| `npm run type-check` | Run the same TypeScript no-emit check directly. |
| `npm run lint` | Check source files with ESLint and Forge-specific rules. |
| `npm run lint:fix` | Apply safe ESLint fixes to source files. |
| `npm run validate:manifest` | Validate `manifest.yml` with the bundled manifest rules. |
| `npm run test` | Run all Jest projects. |
| `npm run test:watch` | Run Jest in watch mode. |
| `npm run test:coverage` | Run Jest and produce a coverage report. |
| `npm run ci` | Run the complete local validation pipeline. |
| `forge lint` | Run Forge platform lint checks. |
| `forge build` | Verify that Forge can bundle the app. |

### Project structure

```text
.
|-- .testing-framework/        # Local Forge shims, contexts, fixtures, and test harness
|-- src/
|   |-- index.ts               # Forge resolver entry point
|   |-- resolvers/
|   |   |-- index.ts           # KVS compatibility and frontend error resolvers
|   |   `-- __tests__/         # Resolver tests
|   |-- frontend/
|   |   |-- index.tsx          # Forge UI Kit macro and configuration UI
|   |   |-- utils/             # Frontend error logging and error boundary
|   |   `-- __tests__/         # UI and interaction tests
|   |-- types/
|   |   |-- index.ts           # Domain model and macro serialization helpers
|   |   `-- forge-ui-types.ts  # Generated Forge UI Kit type definitions
|   |-- __tests__/             # Integration and framework tests
|   `-- setupTests.ts          # Jest DOM setup
|-- static/images/             # Macro icon assets
|-- manifest.yml               # Forge modules, resources, runtime, and permissions
|-- jest.config.cjs            # Frontend and backend Jest projects
`-- eslint.config.js           # ESLint and Forge rules
```

### Testing approach

Tests use Jest and the local `@forge/testing-framework` package. Forge modules are mapped to the shims in `.testing-framework`, so tests should configure `bridge`, realistic product contexts, resolver harnesses, and KVS fixtures directly. Do not manually mock `@forge/react`, `@forge/bridge`, `@forge/api`, `@forge/kvs`, or `@forge/resolver`.

Frontend tests cover page-owned configuration, read-only and configuration modes, preview mode, draft submission, validation, legacy loading, and visible error states. Backend and integration tests cover KVS compatibility, cold starts, serialization, and structured error logging.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the feature-development workflow, architecture constraints, required tests, and completion checklist.

## Forge UI Kit types

`src/types/forge-ui-types.ts` contains generated type definitions for Forge UI Kit components. Import these as types through `src/types/index.ts`, but import runtime components and helpers such as `Box`, `Button`, `ForgeReconciler`, and `xcss` directly from `@forge/react`. Do not edit the generated file manually.

## Permissions

The manifest currently requests only `storage:app`, which is used by the legacy KVS compatibility path. Any new platform API must be added deliberately with the minimum required scope, verified against the current Atlassian Forge documentation, and covered by tests.

## License

See [LICENSE.txt](LICENSE.txt).
