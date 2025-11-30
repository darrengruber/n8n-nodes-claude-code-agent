/**
 * Jest test setup file
 * Global configuration and mocks for all tests
 */

/// <reference path="./types.d.ts" />

// Mock console methods to avoid noise in test output
const originalConsole = { ...console };

beforeEach(() => {
  jest.clearAllMocks();

  // Restore console methods but mock some that might be noisy
  console.log = jest.fn();
  console.debug = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterEach(() => {
  // Restore original console methods
  Object.assign(console, originalConsole);
});

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.N8N_VERSION = '0.0.0-test';
process.env.N8N_RUNNERS_ENABLED = 'false';
process.env.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = 'false';

// Mock timers
jest.useFakeTimers();

// Global test utilities
global.testUtils = {
  createMockContainer: (overrides = {}) => ({
    Id: 'test-container-123',
    Image: 'alpine:latest',
    State: {
      Status: 'running',
      Running: true,
      ExitCode: 0
    },
    ...overrides
  }),

  createMockExecuteFunctions: (overrides = {}) => ({
    getInputData: jest.fn(),
    getNodeParameter: jest.fn(),
    continueOnFail: jest.fn(),
    getNode: jest.fn(),
    getCredentials: jest.fn(),
    helpers: {
      request: jest.fn(),
      prepareBinaryData: jest.fn(),
    },
    ...overrides
  })
};

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});