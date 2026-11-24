module.exports = {
    testEnvironment: 'node',
    roots: ['src/', 'oput-common/'],
    testMatch: ['**/*.test.ts', '**/*.test.js'],
    moduleNameMapper: {
        '^obsidian$': '<rootDir>/scripts/node_modules-obsidian/index',
    },
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
};
  