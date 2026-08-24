module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [ 'ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+node_modules.+\\.m?js$': '@swc/jest',
  },
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!(@inrupt/solid-client-authn-core|@inrupt/solid-client-authn-node|oidc-provider|nanoid|quick-lru|jose|marked)/)',
  ],
  testMatch: [ '<rootDir>/test/**/*.test.ts' ],
  collectCoverageFrom: [ 'src/**/*.ts', '!src/index.ts' ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
