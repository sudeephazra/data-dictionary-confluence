// Shared config used by both frontend and backend test projects.
// Frontend tests run in jsdom (browser-like DOM for React components).
// Backend tests run in Node (matching the Forge resolver runtime), which
// natively provides Web API globals like TextEncoder, ReadableStream, fetch
// etc. — avoiding the polyfill issues that occur when testing Node code
// under jsdom.
const sharedConfig = {
  preset: 'ts-jest',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { useESM: false }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Transform ESM-only packages (e.g. uuid) so Jest can process them
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  // @forge/testing-framework shims — fake @forge/* modules for local testing
  moduleNameMapper: {
    '^@forge/api$': '<rootDir>/.testing-framework/dist/shims/forge-api/index.js',
    '^@forge/kvs$': '<rootDir>/.testing-framework/dist/shims/forge-kvs/index.js',
    '^@forge/bridge$': '<rootDir>/.testing-framework/dist/shims/forge-bridge/index.js',
    '^@forge/react$': '<rootDir>/.testing-framework/dist/shims/forge-react/index.js',
    '^@forge/react/jira$': '<rootDir>/.testing-framework/dist/shims/forge-react-jira/index.js',
    '^@forge/resolver$': '<rootDir>/.testing-framework/dist/shims/forge-resolver/index.js',
    '^@forge/events$': '<rootDir>/.testing-framework/dist/shims/forge-events/index.js',
    '^@forge/testing-framework$': '<rootDir>/.testing-framework/dist/index.js',
  },
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: ['src/**/*.(ts|tsx)', '!src/**/*.d.ts', '!src/types/**'],
  // AGENTS ARE NOT AUTHORIZED TO CHANGE THE COVERAGE THRESHOLDS
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    './src/resolvers/**': {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
    './src/frontend/**': {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  projects: [
    {
      ...sharedConfig,
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testEnvironmentOptions: {
        customExportConditions: ['node', 'node-addons'],
      },
      testMatch: [
        '<rootDir>/src/frontend/**/__tests__/**/*.(ts|tsx|js)',
        '<rootDir>/src/frontend/**/*.(test|spec).(ts|tsx|js)',
      ],
      setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
    },
    {
      ...sharedConfig,
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/resolvers/**/__tests__/**/*.(ts|tsx|js)',
        '<rootDir>/src/resolvers/**/*.(test|spec).(ts|tsx|js)',
        '<rootDir>/src/__tests__/**/*.(ts|tsx|js)',
        '<rootDir>/src/__tests__/**/*.(test|spec).(ts|tsx|js)',
      ],
    },
  ],
};
