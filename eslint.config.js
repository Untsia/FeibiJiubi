'use strict';
// ESLint 扁平配置（Flat Config，ESLint >= 9）。
// 脚本级门禁：通过 `npm run lint` / `npm run lint:fix` 手动触发，
// 不接入 build/prebuild，避免历史遗留代码拖慢或阻断发布构建。
const globals = require('globals');

// 各文件块共用的一组规则：只把真正的逻辑缺陷设为 error，
// 历史遗留风格（未用变量 / prefer-const）降为 warn，避免打断现有代码。
const commonRules = {
    // 明显缺陷——作为错误门禁
    'no-cond-assign': 'error',
    'no-constant-condition': 'error',
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-func-assign': 'error',
    'no-import-assign': 'error',
    'no-unreachable': 'error',
    'no-invalid-regexp': 'error',
    'no-self-assign': 'error',
    'no-unexpected-multiline': 'error',
    'use-isnan': 'error',
    'no-unsafe-finally': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    'no-constant-binary-expression': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'prefer-const': 'warn'
};

module.exports = [
    {
        ignores: [
            '.build/**',
            'dist/**',
            'node_modules/**',
            'tests/**',
            'native/**'
        ]
    },
    {
        // 构建脚本：Node + CommonJS
        files: ['scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: globals.node
        },
        rules: commonRules
    },
    {
        // 主进程 / 核心服务：Node + CommonJS
        files: ['src/main.js', 'src/preload.js', 'src/core/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: globals.node
        },
        rules: commonRules
    },
    {
        // 渲染进程：经 <script> 标签加载、共享全局作用域（非模块），
        // 必须用 sourceType: 'script'（不能用 commonjs），`/* exported */` 注释才能生效。
        // 跨文件共享的全局函数/变量用文件顶部 `/* exported ... */` 声明为“有意暴露”，
        // 否则 no-unused-vars / prefer-const 会把它们误报成未使用。
        files: ['src/renderer/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: globals.browser
        },
        rules: commonRules
    }
];