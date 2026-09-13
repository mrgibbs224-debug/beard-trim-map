const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = process.argv[2];
if (!htmlPath) {
    console.error('Usage: node JsSyntaxValidator.js <path-to-html>');
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gm;
let match;
let found = false;

while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1];
    if (!scriptContent.trim()) continue;
    found = true;
    try {
        new vm.Script(scriptContent);
    } catch (e) {
        console.error('Syntax error in script block:');
        console.error(e.message);
        console.error('Line approx:', e.stack.split('\n')[0]);
        process.exit(1);
    }
}

if (!found) {
    console.error('No script blocks found in HTML');
    process.exit(1);
}

console.log('JavaScript syntax validation PASSED');
