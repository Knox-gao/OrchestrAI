import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPagePlan } from '../apps/server/generator/pageplan/render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const planPath = path.join(here, 'island-pageplan.json');
const outPath = path.join(here, 'island-rendered-preview.html');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const result = renderPagePlan(plan);
fs.writeFileSync(outPath, result.files['index.html'], 'utf8');
console.log(`Wrote ${path.relative(process.cwd(), outPath)} (${Buffer.byteLength(result.files['index.html'])} bytes)`);
console.log(JSON.stringify(result.report, null, 2));
