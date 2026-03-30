// Text canonicalization and utilities
export function canonicalizeText(text = '') {
    return String(text)
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/([([]) ([^ ])/g, (_, symbol, a) => `${symbol}${a}`)
        .replaceAll(/([^ ]) ([)\]])/g, (_, a, symbol) => `${a}${symbol}`)
        .replaceAll(
            /([Ii]) (') ([^ ])|(n) (') (t)(?= |$)|(t) (') (s)|([^ ]) (') (re)|([^ ]) (') (ve)|([^ ]) (-) ([^ ])/g,
            (m, ...groups) => {
                for (let i = 0; i < groups.length; i += 3) {
                    if (groups[i]) {
                        return groups.slice(i, i + 3).join('');
                    }
                }
                return m;
            },
        )
        .replaceAll(/in ' ([^ ])/g, (_, char) => `in' ${char}`)
        .replaceAll("in ',", "in',")
        .replaceAll(", ' cause", ", 'cause")
        .replaceAll(/([^ ]) ([.,!?])/g, (_, a, symbol) => `${a}${symbol}`)
        .replaceAll(
            /"([^"]+)"/g,
            (_, content) =>
                `"${typeof content === 'string' ? content.trim() : content}"`,
        )
        .trim();
}

// HTML escaping
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function escapeHtmlAttribute(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Time formatting
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Logging
export function logMessage(message) {
    const logDiv = document.getElementById('log');
    if (!logDiv) return;
    const timestamp = new Date().toLocaleTimeString();
    logDiv.textContent = `[${timestamp}] ${message}`;
}
