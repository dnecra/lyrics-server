const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m'
};

const LEVEL_COLORS = {
    info: COLORS.gray,
    success: COLORS.green,
    warn: COLORS.yellow,
    error: COLORS.red
};

const TAG_COLORS = {
    SERVER: COLORS.green,
    SMTC: COLORS.blue,
    WS: COLORS.brightBlue,
    'NOW-PLAYING': COLORS.brightMagenta,
    LYRICS: COLORS.white,
    MUSIXMATCH: COLORS.magenta,
    ROMANIZATION: COLORS.cyan,
    TRANSLATION: COLORS.brightCyan
};

const PROVIDER_COLORS = {
    MUSIXMATCH: COLORS.magenta,
    LRCLIB: COLORS.blue,
    CACHE: COLORS.gray
};

function colorizeProviders(message) {
    return String(message).replace(/\[(MUSIXMATCH|LRCLIB|CACHE)]/g, (match, provider) => {
        return `${PROVIDER_COLORS[provider] || COLORS.white}${match}${COLORS.reset}`;
    });
}

function timestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function logEvent(level, tag, message) {
    const levelColor = LEVEL_COLORS[level] || LEVEL_COLORS.info;
    const tagColor = TAG_COLORS[tag] || levelColor;
    const time = `${COLORS.dim}${timestamp()}${COLORS.reset}`;
    const tagText = `${tagColor}${COLORS.bold}[${tag}]${COLORS.reset}`;
    const levelText = `${levelColor}${level.toUpperCase().padEnd(7)}${COLORS.reset}`;
    console.log(`${time} ${levelText} ${tagText} ${colorizeProviders(message)}`);
}

module.exports = { logEvent };
