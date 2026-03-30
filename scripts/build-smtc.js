const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PKG_BIN = path.join(ROOT, 'node_modules', 'pkg', 'lib-es5', 'bin.js');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const TEMP_PKG_CONFIG_PREFIX = '.pkg-build-config';

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        cwd: ROOT,
        shell: false,
        ...options
    });

    if (result.error) {
        console.error(`[build-smtc] Failed to run ${command}: ${result.error.message}`);
        process.exit(result.status || 1);
    }

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function runNpm(args) {
    if (process.platform === 'win32') {
        run('cmd.exe', ['/d', '/s', '/c', 'npm', ...args]);
        return;
    }

    run('npm', args);
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const noConsole = args.includes('--no-console');
    return { noConsole };
}

function helperPublishArgs() {
    const helperOutputDir = path.join('smtc-helper', 'x64');
    return [
        'publish',
        'tools/smtc-bridge-cs/SmtcBridge.csproj',
        '-c', 'Release',
        '-r', 'win-x64',
        '-o', helperOutputDir
    ];
}

function removeFileIfExists(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
}

function cleanupHelperOutputs() {
    const canonical = path.join(ROOT, 'smtc-helper', 'lyrics-smtc-bridge.exe');
    removeFileIfExists(canonical);
    removeFileIfExists(path.join(ROOT, 'smtc-helper', 'x64', 'lyrics-smtc-bridge.exe'));
}

function createPkgConfig() {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const pkgConfig = JSON.parse(raw);
    pkgConfig.pkg = pkgConfig.pkg || {};
    pkgConfig.pkg.assets = [
        'public/**/*',
        'node_modules/kuromoji/dict/**/*',
        'smtc-helper/x64/lyrics-smtc-bridge.exe'
    ];

    const tempName = `${TEMP_PKG_CONFIG_PREFIX}-x64.json`;
    const tempPath = path.join(ROOT, tempName);
    fs.writeFileSync(tempPath, `${JSON.stringify(pkgConfig, null, 2)}\n`, 'utf8');
    return tempPath;
}

function pkgArgs(configPath, { noConsole = false } = {}) {
    const args = [
        '--no-deprecation',
        PKG_BIN,
        'bundle.js',
        '--config', configPath,
        '--public',
        '--no-bytecode',
        '--targets', 'node18-win-x64',
        '--output', path.join('dist', 'lyrics-smtc-x64.exe')
    ];

    if (noConsole) {
        args.push('--no-console');
    }

    return args;
}

function main() {
    const { noConsole } = parseArgs(process.argv);

    fs.mkdirSync(DIST_DIR, { recursive: true });
    cleanupHelperOutputs();

    runNpm(['run', 'build:bundle']);

    console.log('[build-smtc] Building SMTC helper for win-x64');
    run('dotnet', helperPublishArgs());

    console.log('[build-smtc] Packaging SMTC app for win-x64');
    const tempConfigPath = createPkgConfig();
    try {
        run(process.execPath, pkgArgs(tempConfigPath, { noConsole }));
    } finally {
        removeFileIfExists(tempConfigPath);
    }
}

main();
