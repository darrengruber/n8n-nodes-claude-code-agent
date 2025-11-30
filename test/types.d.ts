/**
 * Type definitions for test setup
 */

declare global {
  var testUtils: {
    createMockContainer: (overrides?: any) => any;
    createMockExecuteFunctions: (overrides?: any) => any;
  };
}

export {};