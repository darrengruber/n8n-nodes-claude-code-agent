module.exports = {
  testEnvironment: 'node',
  preset: 'ts-jest',
  testMatch: [
    '**/test/**/*.test.ts',
    '!**/node_modules/**',
    '!**/dist/**'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/n8n-official-release/'
  ],
  collectCoverageFrom: [
    'nodes/**/*.ts',
    '!nodes/**/*.d.ts',
    '!**/test/**',
    '!**/fixtures/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^~/(.*)$': '<rootDir>/$1'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  globals: {},
  verbose: true,
  errorOnDeprecated: true,
  bail: false
};