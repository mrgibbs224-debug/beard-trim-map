const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const htmlPath = process.argv[2];
if (!htmlPath) {
    console.error('Usage: node JsSyntaxValidator.cjs <path-to-html>');
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gm;
let match;
let found = false;

const tempDir = path.join(__dirname, 'temp_syntax_check');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

try {
    while ((match = scriptRegex.exec(html)) !== null) {
        const attrs = match[1];
        const content = match[2];
        if (!content.trim()) continue;
        found = true;

        const isModule = attrs.includes('type="module"');
        const ext = isModule ? '.mjs' : '.js';
        const tempFile = path.join(tempDir, `test_${crypto.randomBytes(4).toString('hex')}${ext}`);

        fs.writeFileSync(tempFile, content);

        try {
            execSync(`node --check "${tempFile}"`, { stdio: 'pipe' });
        } catch (e) {
            console.error(`Syntax error in <script ${isModule ? 'type="module"' : ''}>:`);
            console.error(e.stderr.toString() || e.message);
            process.exit(1);
        } finally {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        }
    }

    if (!found) {
        console.error('No script blocks found in HTML');
        process.exit(1);
    }

    console.log('JavaScript syntax validation PASSED');
} finally {
    if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
    }
}
